import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { scanSource } from '../src/services/scan.js';
import { scanDirectory, cleanupStaleScans } from '../src/scanner-files.js';

const fixture = name => readFile(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');

test('actual Slither detects reentrancy and preserves severity and locations', async () => {
  const result = await scanSource(await fixture('vulnerable.sol'));
  const finding = result.findings.find(item => item.check === 'reentrancy-eth');
  assert.ok(finding);
  assert.equal(finding.impact, 'High');
  assert.ok(finding.description.length > 0);
  assert.ok(finding.elements.some(item => item.source_mapping.lines.includes(12)));
});

test('minimal fixture succeeds with no findings', async () => {
  const result = await scanSource(await fixture('minimal.sol'));
  assert.deepEqual(result.findings, []);
});

test('rejects empty and oversized input before starting Slither', async () => {
  await assert.rejects(scanSource('  '), /required/);
  await assert.rejects(scanSource('a'.repeat(100 * 1024 + 1)), /100 KiB/);
});

test('invalid Solidity is a failure, not an empty successful scan', async () => {
  await assert.rejects(scanSource('pragma solidity 0.8.28; contract Broken {'), /analysis failed/);
});

test('unsupported compiler pragma fails clearly', async () => {
  await assert.rejects(scanSource('pragma solidity 0.7.6; contract Old {}'), /compiler version/i);
});

test('filesystem imports are blocked even for an existing readable Solidity file', async () => {
  const filename = new URL('../../fixtures/minimal.sol', import.meta.url).pathname;
  await assert.rejects(scanSource(`pragma solidity 0.8.28; import "${filename}"; contract Importer {}`), /callback|not found/i);
});

test('temporary directory is removed after a compiler failure', async () => {
  await cleanupStaleScans();
  const before = (await readdir(scanDirectory)).sort();
  await assert.rejects(scanSource('invalid solidity'));
  const after = (await readdir(scanDirectory)).sort();
  assert.deepEqual(after, before);
});
