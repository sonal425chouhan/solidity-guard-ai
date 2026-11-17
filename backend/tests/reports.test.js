import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createReportService, normalizeFindings } from '../src/services/reports.js';
import { hashPayload, sha256 } from '../src/hashing.js';
import { saveReport, loadReport } from '../src/storage.js';

async function storage(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sg-reports-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const fixture = name => readFile(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');
const scannerResult = { scanner: 'slither', scannerVersion: '0.11.6', compilerVersion: '0.8.28', findings: [] };

test('real Slither report preserves evidence, excludes full source, and round-trips', async t => {
  const directory = await storage(t);
  const service = createReportService({ directory });
  const source = await fixture('vulnerable.sol');
  const report = await service.create({ filename: 'vulnerable.sol', source });
  const finding = report.payload.findings.find(item => item.detector === 'reentrancy-eth');
  assert.equal(finding.severity, 'High');
  assert.equal(finding.confidence, 'Medium');
  assert.match(finding.description, /Reentrancy/);
  assert.ok(finding.locations.some(item => item.sourceMapping.lines.includes(12)));
  assert.equal(report.payload.summary.counts.High, 1);
  assert.equal(report.payload.summary.counts.Informational, 1);
  assert.equal(report.payload.contract.sourceHash, sha256(source));
  assert.equal(report.integrity.hash, hashPayload(report.payload));
  assert.equal(report.payload.integrity, undefined);
  assert.throws(() => { finding.description = 'edited'; }, TypeError);
  const saved = await service.get(report.payload.reportId);
  assert.deepEqual(saved, report);
  const text = await readFile(path.join(directory, `${report.payload.reportId}.json`), 'utf8');
  assert.ok(!text.includes(JSON.stringify(source).slice(1, -1)));
  assert.equal(saved.payload.contract.source, undefined);
  assert.equal((await stat(path.join(directory, `${report.payload.reportId}.json`))).mode & 0o777, 0o600);
});

test('zero-findings reports use neutral wording and unique UUIDs', async t => {
  const service = createReportService({ directory: await storage(t) });
  const input = { filename: 'minimal.sol', source: await fixture('minimal.sol') };
  const first = await service.create(input);
  const second = await service.create(input);
  assert.notEqual(first.payload.reportId, second.payload.reportId);
  assert.match(first.payload.reportId, /^[a-f0-9-]{36}$/);
  assert.equal(first.payload.summary.overallRisk, 'No findings detected');
  assert.equal(first.payload.summary.totalFindings, 0);
  assert.ok(first.payload.limitations[0].includes('does not establish contract security'));
});

test('normalization retains original fields and complete mappings without mutating scanner evidence', () => {
  const raw = { id: 'scanner-id', check: 'example', impact: 'Optimization', confidence: 'High', description: 'Original text',
    elements: [{ type: 'function', name: 'example()', source_mapping: { filename_relative: 'Contract.sol', start: 1, length: 8, lines: [2, 3], starting_column: 1, ending_column: 9 } }] };
  const [finding] = normalizeFindings([raw]);
  assert.equal(finding.severity, 'Optimization');
  assert.equal(finding.displaySeverity, 'Informational');
  assert.equal(finding.scannerId, raw.id);
  assert.equal(finding.description, raw.description);
  assert.deepEqual(finding.locations[0].sourceMapping, raw.elements[0].source_mapping);
  finding.locations[0].sourceMapping.lines.push(4);
  assert.deepEqual(raw.elements[0].source_mapping.lines, [2, 3]);
  assert.deepEqual(normalizeFindings([{ ...raw, elements: undefined }])[0].locations, []);
  assert.throws(() => normalizeFindings([{}]), /Invalid scanner/);
});

test('scan failure persists no report and releases the busy state', async t => {
  const directory = await storage(t);
  let calls = 0;
  const service = createReportService({ directory, scan: async () => {
    if (calls++ === 0) throw new Error('compiler failed');
    return scannerResult;
  } });
  const input = { filename: 'Test.sol', source: 'contract Test {}' };
  await assert.rejects(service.create(input), { code: 'SCAN_FAILED' });
  assert.deepEqual(await readdir(directory), []);
  await service.create(input);
});

test('concurrent scans receive a busy response', async t => {
  let release;
  const service = createReportService({ directory: await storage(t), scan: () => new Promise(resolve => { release = resolve; }) });
  const input = { filename: 'Test.sol', source: 'contract Test {}' };
  const pending = service.create(input);
  await assert.rejects(service.create(input), { code: 'SCANNER_BUSY' });
  release(scannerResult);
  await pending;
});

test('malformed scanner findings fail without persisting an empty report', async t => {
  const directory = await storage(t);
  const service = createReportService({ directory, scan: async () => ({ ...scannerResult, findings: [{}] }) });
  await assert.rejects(service.create({ filename: 'Test.sol', source: 'contract Test {}' }), { code: 'INVALID_SCANNER_OUTPUT' });
  assert.deepEqual(await readdir(directory), []);
});

test('unknown scanner severities remain visible and are not arbitrarily classified', async t => {
  const directory = await storage(t);
  const service = createReportService({ directory, scan: async () => ({ ...scannerResult,
    findings: [{ check: 'future-detector', impact: 'Unknown', confidence: 'Low', description: 'Evidence' }],
  }) });
  const report = await service.create({ filename: 'Test.sol', source: 'contract Test {}' });
  assert.equal(report.payload.findings[0].severity, 'Unknown');
  assert.equal(report.payload.findings[0].displaySeverity, null);
  assert.equal(report.payload.summary.unclassified, 1);
  assert.equal(report.payload.summary.overallRisk, 'Unclassified findings require review');
});

test('atomic publication refuses overwrites and removes temporary files', async t => {
  const directory = await storage(t);
  const payload = { reportId: randomUUID(), schemaVersion: 1, findings: [] };
  const report = { payload, integrity: { algorithm: 'SHA-256', canonicalization: 'sg-json-v1', hash: hashPayload(payload) } };
  const attempts = await Promise.allSettled([saveReport(report, directory), saveReport(report, directory)]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(item => item.status === 'rejected').reason.code, 'REPORT_EXISTS');
  assert.deepEqual(await readdir(directory), [`${payload.reportId}.json`]);
  const changedPayload = { ...payload, findings: ['changed'] };
  await assert.rejects(saveReport({ payload: changedPayload, integrity: { ...report.integrity, hash: hashPayload(changedPayload) } }, directory), { code: 'REPORT_EXISTS' });
  assert.deepEqual(await loadReport(payload.reportId, directory), report);
});

test('storage rejects traversal, unknown IDs, corruption, and changed content', async t => {
  const directory = await storage(t);
  await assert.rejects(loadReport('../private', directory), { code: 'INVALID_REPORT_ID' });
  await assert.rejects(loadReport(randomUUID(), directory), { code: 'REPORT_NOT_FOUND' });
  const service = createReportService({ directory, scan: async () => scannerResult });
  const report = await service.create({ filename: 'Test.sol', source: 'contract Test {}' });
  const filename = path.join(directory, `${report.payload.reportId}.json`);
  const edited = structuredClone(report);
  edited.payload.summary.overallRisk = 'changed';
  await writeFile(filename, JSON.stringify(edited));
  await assert.rejects(service.get(report.payload.reportId), { code: 'REPORT_INTEGRITY_ERROR' });
  await writeFile(filename, '{broken');
  await assert.rejects(service.get(report.payload.reportId), { code: 'REPORT_INTEGRITY_ERROR' });
});
