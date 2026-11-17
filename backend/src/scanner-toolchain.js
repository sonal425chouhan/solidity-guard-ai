import { AppError } from './errors.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
let validated;

export async function inspectToolchain(run = execute) {
  const options = { timeout: 5000, maxBuffer: 4096, encoding: 'utf8' };
  let slither, compiler;
  try {
    [slither, compiler] = await Promise.all([
      run(fileURLToPath(new URL('../../.venv/bin/slither', import.meta.url)), ['--version'], options),
      run(fileURLToPath(new URL('../../.tools/solc-0.8.28', import.meta.url)), ['--version'], options),
    ]);
  } catch {
    throw new AppError(503, 'SCANNER_TOOLCHAIN_UNAVAILABLE', 'Scanner tools could not be checked. Reinstall the tools using README instructions and restart the backend.');
  }
  if (slither.stdout.trim() !== '0.11.6' || !/Version: 0\.8\.28\+commit\.7893614a(?:\.|\s|$)/.test(compiler.stdout)) {
    throw new AppError(503, 'SCANNER_TOOLCHAIN_MISMATCH', 'Scanner toolchain differs from the pinned Slither/Solidity versions. Reinstall the documented tools and restart the backend.');
  }
  return { scannerVersion: '0.11.6', compilerVersion: '0.8.28' };
}

// Validate once per process; failed checks may be retried after repairing tools.
export function validateToolchain() {
  validated ??= inspectToolchain().catch(error => {
    validated = undefined;
    throw error;
  });
  return validated;
}
