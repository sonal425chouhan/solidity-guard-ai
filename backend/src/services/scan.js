import { validateToolchain } from '../scanner-toolchain.js';
import { spawn } from 'node:child_process';
import { writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareScanDirectory, readScanResult, maxResultBytes } from '../scanner-files.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const timeoutMs = 30_000;
const maxOutputBytes = 4 * 1024 * 1024;

export function runSlither(directory, { executable = path.join(root, '.venv/bin/slither'), timeout = timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      'Contract.sol', '--compile-force-framework', 'solc',
      '--solc', path.join(root, 'scripts/solc.js'), '--json', 'result.json',
    ], {
      cwd: directory,
      shell: false,
      detached: true,
      env: {
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
        VIRTUAL_ENV: path.join(root, '.venv'),
        LANG: 'C.UTF-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    let size = 0;
    let failure;
    function stop(message) {
      failure ??= new Error(message);
      // Linux/WSL process group includes the compiler launcher and native compiler.
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
      }
    }
    const timer = setTimeout(() => stop('Scanner timed out.'), timeout);
    let checking = false;
    let closed = false;
    const sizeMonitor = setInterval(async () => {
      if (checking || closed) return;
      checking = true;
      try {
        const result = await stat(path.join(directory, 'result.json'));
        if (!closed && result.size > maxResultBytes) stop('Scanner result exceeded 4 MiB.');
      } catch (error) {
        if (!closed && error.code !== 'ENOENT') stop('Unable to monitor scanner result.');
      } finally { checking = false; }
    }, 100);
    for (const [stream, chunks] of [[child.stdout, null], [child.stderr, stderr]]) {
      stream.on('data', chunk => {
        size += chunk.length;
        if (size > maxOutputBytes) stop('Scanner output exceeded 4 MiB.');
        else chunks?.push(chunk);
      });
    }
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      closed = true;
      clearTimeout(timer);
      clearInterval(sizeMonitor);
      if (failure) return reject(failure);
      resolve({ code, stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

// Return scanner evidence only; report assembly stays in its own service.
export async function scanSource(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Solidity source is required.');
  if (Buffer.byteLength(source, 'utf8') > 100 * 1024) throw new Error('Source exceeds 100 KiB.');
  if (source.includes('\0')) throw new Error('Source must be text without null bytes.');
  const versions = await validateToolchain();
  const directory = await prepareScanDirectory();
  try {
    await writeFile(path.join(directory, 'Contract.sol'), source, { mode: 0o600 });
    const output = await runSlither(directory);
    let result;
    const resultPath = path.join(directory, 'result.json');
    try {
      result = await readScanResult(resultPath);
    } catch {
      // This Slither release can fail before writing JSON on compilation errors.
      throw new Error(`Solidity analysis failed (exit ${output.code}). ${output.stderr.slice(-2500)}`);
    }
    if (result.success !== true) throw new Error(`Solidity analysis failed: ${String(result.error ?? 'Unknown scanner error').slice(0, 2000)}`);
    if (!result.results || (result.results.detectors !== undefined && !Array.isArray(result.results.detectors))) {
      throw new Error('Unexpected scanner result structure.');
    }
    // Slither can exit nonzero when it finds issues; successful JSON is authoritative.
    return {
      scanner: 'slither',
      ...versions,
      exitCode: output.code,
      findings: result.results.detectors ?? [],
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
