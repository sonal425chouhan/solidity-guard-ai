import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/app.js';
import { createReportService } from '../src/services/reports.js';
import { cleanupStaleScans, readScanResult, maxResultBytes } from '../src/scanner-files.js';
import { runSlither } from '../src/services/scan.js';
import { request as frontendRequest } from '../../frontend/src/api.js';

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sg-hardening-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('local API rejects foreign hosts/origins before scanning and accepts Vite origin', async t => {
  let scans = 0;
  const server = createApp({ directory: await temporary(t), scan: async () => {
    scans += 1;
    return { scanner: 'slither', scannerVersion: '0.11.6', compilerVersion: '0.8.28', findings: [] };
  } }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/api/reports`;
  // Native HTTP preserves explicit Host headers; fetch may replace them.
  const post = (headers, body = JSON.stringify({ filename: 'Test.sol', source: 'contract Test {}' })) =>
    new Promise((resolve, reject) => {
      const request = httpRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      request.on('error', reject);
      request.end(body);
    });
  for (const headers of [
    { Host: 'evil.example' }, { Host: '127.0.0.1.evil.example' },
    { Origin: 'http://evil.example' }, { Origin: 'null' },
    { Origin: 'http://localhost:9999' }, { Origin: 'http://127.0.0.1:5173/extra' },
    { Host: 'evil.example', 'X-Forwarded-Host': '127.0.0.1:5173' },
  ]) assert.equal((await post(headers)).status, 403);
  assert.equal(scans, 0);
  assert.equal((await post({ Host: '127.0.0.1:5173', Origin: 'http://127.0.0.1:5173' })).status, 201);
  assert.equal((await post({ Origin: 'http://localhost:5173' })).status, 201);
  assert.equal((await post({})).status, 201);
  const charset = await post({ 'Content-Type': 'application/json; charset=iso-8859-1' }, '{}');
  assert.equal(charset.status, 415);
  assert.equal((await charset.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('corrupt receipt JSON/shape does not prevent intact report retrieval', async t => {
  const directory = await temporary(t);
  const service = createReportService({ directory, scan: async () => ({ scanner: 'slither', scannerVersion: '0.11.6', compilerVersion: '0.8.28', findings: [] }) });
  const report = await service.create({ filename: 'Test.sol', source: 'contract Test {}' });
  await mkdir(path.join(directory, 'registrations'));
  const filename = path.join(directory, 'registrations', `${report.payload.reportId}.json`);
  for (const content of ['{broken', 'null', '{}', '{"transactionHash":"invented"}']) {
    await writeFile(filename, content);
    const loaded = await service.get(report.payload.reportId);
    assert.deepEqual(loaded.payload, report.payload);
    assert.deepEqual(loaded.integrity, report.integrity);
    assert.equal(loaded.registration, undefined);
    assert.match(loaded.registrationWarning, /corrupt/);
  }
});

test('scanner result reader rejects oversized files and symlinks', async t => {
  const directory = await temporary(t);
  const filename = path.join(directory, 'result.json');
  await writeFile(filename, JSON.stringify({ success: true }));
  assert.deepEqual(await readScanResult(filename), { success: true });
  const alias = path.join(directory, 'alias.json');
  await symlink(filename, alias);
  await assert.rejects(readScanResult(alias), { code: 'ELOOP' });
  await writeFile(filename, Buffer.alloc(maxResultBytes + 1));
  await assert.rejects(readScanResult(filename), /exceeded/);
});

test('stale scan cleanup preserves active process directories, unrelated files, and symlinks', async t => {
  const directory = await temporary(t);
  // Linux cannot allocate this PID in the supported environment; confirm before use.
  assert.throws(() => process.kill(2147483647, 0), { code: 'ESRCH' });
  const stale = path.join(directory, 'scan-2147483647-AbCd12');
  const active = `scan-${process.pid}-AbCd12`;
  await mkdir(stale);
  await writeFile(path.join(stale, 'Contract.sol'), 'private source');
  await mkdir(path.join(directory, active));
  await mkdir(path.join(directory, 'unrelated'));
  await symlink(path.join(directory, 'unrelated'), path.join(directory, 'scan-2147483647-XyZa12'));
  await cleanupStaleScans(directory);
  assert.deepEqual((await readdir(directory)).sort(), [active, 'unrelated', 'scan-2147483647-XyZa12'].sort());
});

test('scanner monitor terminates a process writing an oversized result', async t => {
  const directory = await temporary(t);
  const executable = path.join(directory, 'fake-scanner');
  await writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync('result.json', Buffer.alloc(${maxResultBytes + 1})); setInterval(() => {}, 1000);\n`);
  await chmod(executable, 0o700);
  await assert.rejects(runSlither(directory, { executable }), /result exceeded/);
});

test('scanner timeout terminates a stalled subprocess', async t => {
  const directory = await temporary(t);
  const executable = path.join(directory, 'fake-scanner');
  await writeFile(executable, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`);
  await chmod(executable, 0o700);
  await assert.rejects(runSlither(directory, { executable, timeout: 50 }), /timed out/);
});

test('frontend timeout covers request and response body, with honest registration wording', async () => {
  const waitForAbort = signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  await assert.rejects(frontendRequest('', {}, { timeoutMs: 10, fetchImpl: (_url, { signal }) => waitForAbort(signal) }), /backend request timed out/);
  await assert.rejects(frontendRequest('/id/register', {}, { timeoutMs: 10, fetchImpl: async (_url, { signal }) => ({ json: () => waitForAbort(signal) }) }), /transaction may still confirm/);
  assert.deepEqual(await frontendRequest('/id', undefined, { timeoutMs: 100, fetchImpl: async () => Response.json({ success: true, data: { value: 'ok' } }) }), { value: 'ok' });
});
