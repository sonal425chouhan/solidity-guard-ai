import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { checkSourceText, packageSource } from '../../scripts/package-source.js';
import { runtimeWithRegistrar } from '../../scripts/doctor.js';

const run = promisify(execFile);

test('submission refuses key-shaped secrets, private keys and nonblank env credentials without printing values', () => {
  const secret = 'gsk_' + 'a'.repeat(40);
  for (const text of [secret, '-----BEGIN ' + 'PRIVATE KEY-----', 'GROQ_API_KEY=anything']) {
    assert.throws(() => checkSourceText(text, 'backend/.env.example'), error => !error.message.includes(text));
  }
  assert.throws(() => checkSourceText('embedded custom credential', 'file.js', ['custom credential']), /archive refused/);
  assert.doesNotThrow(() => checkSourceText('GROQ_API_KEY=\nGROQ_MODEL=openai/gpt-oss-20b\n', 'backend/.env.example'));
});

test('source archive contains required source but excludes local credentials and generated state', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sg-package-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'source.tar.gz');
  await packageSource(fileURLToPath(new URL('../../', import.meta.url)), archive);
  const { stdout } = await run('tar', ['-tzf', archive]);
  const entries = stdout.trim().split('\n');
  for (const name of ['backend/.env.example', 'package-lock.json', 'scripts/setup-local.sh', 'frontend/index.html']) {
    assert.ok(entries.includes(`SolidityGuard-AI/${name}`));
  }
  assert.ok(!entries.some(name => /(?:\/\.env$|\/node_modules\/|\/\.venv|\/\.tools\/|\/backend\/data\/|\/artifacts\/|\/cache\/|\/deployments\/)/.test(name)));
  await assert.rejects(packageSource(fileURLToPath(new URL('../../', import.meta.url)), archive), { code: 'ERR_FS_CP_EEXIST' });
});

test('runtime comparison substitutes the immutable registrar rather than hashing the artifact placeholder', () => {
  const object = '00'.repeat(40);
  const compiled = { object, immutableReferences: { '10': [{ start: 4, length: 32 }] } };
  const artifact = { deployedBytecode: `0x${object}` };
  const address = '0x' + '12'.repeat(20);
  const actual = runtimeWithRegistrar(artifact, compiled, address);
  assert.notEqual(actual, artifact.deployedBytecode);
  assert.equal(actual.slice(2 + 4 * 2, 2 + 36 * 2), '00'.repeat(12) + '12'.repeat(20));
  assert.throws(() => runtimeWithRegistrar({ deployedBytecode: '0x00' }, compiled, address), /mismatch/);
  assert.throws(() => runtimeWithRegistrar(artifact, { object, immutableReferences: {} }, address), /one registry immutable/);
});
