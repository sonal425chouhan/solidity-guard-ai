import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { inspectToolchain } from '../src/scanner-toolchain.js';
import { createApp } from '../src/app.js';
import { hashPayload } from '../src/hashing.js';

async function api(t, scan, aiOptions) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sg-api-test-'));
  const server = createApp({ directory, aiOptions, ...(scan ? { scan } : {}) }).listen(0, '127.0.0.1');
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { directory, get: url => fetch(base + url), post: (body, headers = { 'Content-Type': 'application/json' }) => fetch(base + '/api/reports', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }) };
}

test('POST and GET round-trip a real Slither report with a correct digest', async t => {
  const client = await api(t);
  const source = await readFile(new URL('../../fixtures/vulnerable.sol', import.meta.url), 'utf8');
  const response = await client.post({ filename: 'Vault.sol', source });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.success, true);
  assert.equal(created.data.payload.ai.status, 'disabled');
  assert.equal(created.data.integrity.hash, hashPayload(created.data.payload));
  assert.ok(created.data.payload.findings.some(item => item.detector === 'reentrancy-eth'));
  const fetched = await client.get(response.headers.get('location'));
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), created);
});

test('API accepts opt-in AI and still returns a report when credentials are absent', async t => {
  const client = await api(t, undefined, { apiKey: '' });
  const source = await readFile(new URL('../../fixtures/vulnerable.sol', import.meta.url), 'utf8');
  const response = await client.post({ filename: 'Vault.sol', source, includeAi: true });
  assert.equal(response.status, 201);
  const report = (await response.json()).data;
  assert.equal(report.payload.ai.status, 'unavailable');
  assert.equal(report.payload.ai.reason, 'NOT_CONFIGURED');
  assert.ok(report.payload.findings.some(item => item.detector === 'reentrancy-eth'));
  assert.equal(report.integrity.hash, hashPayload(report.payload));
});

test('API rejects invalid inputs before scanning', async t => {
  const client = await api(t, async () => { throw new Error('should not scan'); });
  for (const input of [{}, { filename: '../file.sol', source: 'x' }, { filename: 'file.txt', source: 'x' }, { filename: 'Test.sol', source: ' ' }, { filename: 'Test.sol', source: 42 }, { filename: 'Test.sol', source: 'x', includeAi: 'true' }, { filename: 'Test.sol', source: 'x', apiKey: 'not-allowed' }]) {
    assert.equal((await client.post(input)).status, 400);
  }
  assert.equal((await client.post({ filename: 'Test.sol', source: 'x'.repeat(102401) })).status, 413);
  assert.equal((await client.post('{bad')).status, 400);
  assert.equal((await client.post(JSON.stringify({ source: 'x'.repeat(1024 * 1024) }))).status, 413);
  assert.equal((await client.post('hello', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await client.get('/api/reports/not-a-uuid')).status, 400);
  assert.equal((await client.get(`/api/reports/${randomUUID()}`)).status, 404);
  assert.deepEqual(await readdir(client.directory), []);
});

test('actual compilation failure returns 422 and creates no report', async t => {
  const client = await api(t);
  const response = await client.post({ filename: 'Broken.sol', source: 'pragma solidity 0.8.28; contract Broken {' });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'SCAN_FAILED');
  assert.equal(body.data, undefined);
  assert.deepEqual(await readdir(client.directory), []);
});

test('scanner availability and timeout have distinct API errors', async t => {
  for (const [error, status, code] of [
    [Object.assign(new Error('missing'), { code: 'ENOENT' }), 503, 'SCANNER_UNAVAILABLE'],
    [new Error('Scanner timed out'), 504, 'SCANNER_TIMEOUT'],
  ]) {
    const client = await api(t, async () => { throw error; });
    const response = await client.post({ filename: 'Test.sol', source: 'contract Test {}' });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
});


test('toolchain mismatch and check failures return actionable 503 responses without saving reports', async t => {
  for (const [run, code] of [
    [async () => ({ stdout: 'wrong version' }), 'SCANNER_TOOLCHAIN_MISMATCH'],
    [async () => { throw new Error('private path or process output'); }, 'SCANNER_TOOLCHAIN_UNAVAILABLE'],
  ]) {
    const client = await api(t, () => inspectToolchain(run));
    const response = await client.post({ filename: 'Valid.sol', source: 'contract Valid {}' });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.match(body.error.message, /Reinstall/);
    assert.ok(!JSON.stringify(body).includes('private path'));
    assert.equal(body.data, undefined);
    assert.deepEqual(await readdir(client.directory), []);
  }
});
