import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectToolchain } from '../src/scanner-toolchain.js';

test('toolchain check accepts pinned tools and rejects mismatched versions', async () => {
  const run = async executable => ({ stdout: executable.endsWith('slither')
    ? '0.11.6\n' : 'Version: 0.8.28+commit.7893614a.Linux.g++\n' });
  assert.deepEqual(await inspectToolchain(run), { scannerVersion: '0.11.6', compilerVersion: '0.8.28' });
  await assert.rejects(inspectToolchain(async () => ({ stdout: 'unexpected version' })), /differs from the pinned/);
  await assert.rejects(inspectToolchain(async () => { throw new Error('missing executable'); }), { status: 503, code: 'SCANNER_TOOLCHAIN_UNAVAILABLE' });
});
