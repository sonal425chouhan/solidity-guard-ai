import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { explainFindings } from '../src/services/ai.js';
import { createReportService } from '../src/services/reports.js';
import { hashPayload } from '../src/hashing.js';

const source = '// private context\ncontract Vault {\n function withdraw() external {\n  // external call\n }\n}\n';
const finding = { id: 'finding-1', detector: 'reentrancy-eth', severity: 'High', confidence: 'Medium',
  description: 'Potential reentrancy in /tmp/solidityguard-private/Contract.sol\nExtra source detail',
  locations: [{ sourceMapping: { lines: [3, 4] } }] };
const input = { enabled: true, findings: [finding], source };
const explanation = (findingId = 'finding-1') => ({ findingId, explanation: 'The external call may re-enter this function.',
  whyItMatters: 'State may still reflect the previous balance.', potentialImpact: 'Repeated withdrawals may be possible.',
  remediation: 'Review checks-effects-interactions and a reentrancy guard.', exampleFix: null });
const response = entries => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ explanations: entries }) } }] });
const options = fetchImpl => ({ apiKey: 'test-key-not-a-real-secret', model: 'openai/gpt-oss-20b', timeoutMs: 1000, fetchImpl });

async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sg-ai-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('AI defaults to disabled and never calls the provider', async () => {
  let calls = 0;
  const result = await explainFindings({ findings: [finding], source }, options(async () => { calls += 1; }));
  assert.equal(result.status, 'disabled');
  assert.equal(calls, 0);
  assert.deepEqual(result.explanations, []);
});

test('missing credentials degrades gracefully and zero findings require no provider call', async () => {
  const fetchImpl = () => { throw new Error('Must not call'); };
  assert.equal((await explainFindings(input, { apiKey: '', fetchImpl })).reason, 'NOT_CONFIGURED');
  const empty = await explainFindings({ ...input, findings: [] }, { apiKey: '', fetchImpl });
  assert.equal(empty.status, 'completed');
  assert.equal(empty.reason, 'NO_FINDINGS');
});

test('successful explanation uses the fixed provider and bounded data without changing findings', async () => {
  const original = structuredClone(input);
  const result = await explainFindings(input, options(async (url, request) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer test-key-not-a-real-secret');
    assert.equal(request.redirect, 'error');
    const body = JSON.parse(request.body);
    assert.equal(body.store, undefined);
    assert.equal(body.model, 'openai/gpt-oss-20b');
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.include_reasoning, false);
    assert.equal(body.response_format.json_schema.strict, true);
    const sent = JSON.parse(body.messages[1].content).findings;
    assert.equal(sent[0].findingId, finding.id);
    assert.equal(sent[0].severity, 'High');
    assert.ok(sent[0].snippets.length > 0);
    assert.ok(!request.body.includes(JSON.stringify(source).slice(1, -1)));
    assert.ok(!request.body.includes('/tmp/solidityguard-private'));
    assert.ok(!request.body.includes('test-key-not-a-real-secret'));
    assert.ok(sent[0].snippets.reduce((n, item) => n + item.code.length, 0) <= source.length / 4);
    return response([explanation()]);
  }));
  assert.equal(result.status, 'completed');
  assert.equal(result.provider, 'groq');
  assert.match(result.notice, /to Groq/);
  assert.deepEqual(result.explanations, [explanation()]);
  assert.deepEqual(input, original);
});

test('provider timeout aborts the request and returns unavailable', async () => {
  const result = await explainFindings(input, { ...options((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })), timeoutMs: 10 });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'TIMEOUT');
});

test('provider HTTP and network failures do not leak raw errors', async () => {
  for (const fetchImpl of [async () => new Response('provider secret details', { status: 429 }), async () => { throw new Error('secret network details'); }]) {
    const result = await explainFindings(input, options(fetchImpl));
    assert.equal(result.status, 'unavailable');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('malformed, refused, truncated, and oversized responses are rejected', async () => {
  const fixtures = [
    () => new Response('not JSON'),
    () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '```json {} ```' } }] }),
    () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
    () => Response.json({ choices: [{ finish_reason: 'stop', message: { refusal: 'No', content: '{}' } }] }),
    () => response([{ ...explanation(), severity: 'Critical' }]),
    () => response([{ ...explanation(), explanation: '' }]),
    () => new Response('x'.repeat(128 * 1024 + 1)),
  ];
  for (const fixture of fixtures) {
    const result = await explainFindings(input, options(async () => fixture()));
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.explanations, []);
  }
});

test('unknown finding IDs are rejected; valid entries survive as partial coverage', async () => {
  const unknown = await explainFindings(input, options(async () => response([explanation('invented')])));
  assert.equal(unknown.status, 'unavailable');
  assert.deepEqual(unknown.explanations, []);
  const partial = await explainFindings(input, options(async () => response([explanation(), explanation('invented')])));
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.explanations, [explanation()]);
});

test('duplicates are not appended and omitted explanations yield partial status', async () => {
  const result = await explainFindings({ ...input, findings: [finding, { ...finding, id: 'finding-2' }] },
    options(async () => response([explanation(), explanation()])));
  assert.equal(result.status, 'partial');
  assert.equal(result.explanations.length, 1);
});

test('large finding lists are bounded and report partial coverage', async () => {
  const findings = Array.from({ length: 10 }, (_, i) => ({ ...finding, id: `finding-${i + 1}` }));
  const result = await explainFindings({ ...input, findings }, options(async (_url, request) => {
    const sent = JSON.parse(JSON.parse(request.body).messages[1].content).findings;
    assert.equal(sent.length, 8);
    assert.ok(Buffer.byteLength(request.body) <= 32 * 1024);
    assert.ok(sent.flatMap(item => item.snippets).reduce((n, snippet) => n + snippet.code.length, 0) <= source.length / 4);
    return response(sent.map(item => explanation(item.findingId)));
  }));
  assert.equal(result.status, 'partial');
  assert.equal(result.requestedFindings, 10);
  assert.equal(result.explanations.length, 8);
});

test('full source accidentally appearing in a scanner description is omitted', async () => {
  const tiny = 'contract Tiny {}';
  await explainFindings({ ...input, source: tiny, findings: [{ ...finding, description: tiny }] }, options(async (_url, request) => {
    assert.ok(!request.body.includes(tiny));
    return response([explanation()]);
  }));
});

test('real scanner report survives AI failure with findings and risk summary preserved', async t => {
  const service = createReportService({ directory: await directory(t), aiOptions: options(async () => new Response('', { status: 500 })) });
  const source = await readFile(new URL('../../fixtures/vulnerable.sol', import.meta.url), 'utf8');
  const disabled = await service.create({ filename: 'vulnerable.sol', source });
  const failed = await service.create({ filename: 'vulnerable.sol', source, includeAi: true });
  assert.equal(disabled.payload.ai.status, 'disabled');
  assert.equal(failed.payload.ai.status, 'unavailable');
  // Slither source mappings contain per-scan temporary paths; compare original
  // metadata and source coordinates rather than expecting identical temp names.
  const evidence = report => report.payload.findings.map(({ detector, severity, confidence, description, locations }) => ({
    detector, severity, confidence, description,
    lines: locations.map(item => item.sourceMapping.lines),
  }));
  assert.deepEqual(evidence(failed), evidence(disabled));
  assert.deepEqual(failed.payload.summary, disabled.payload.summary);
  assert.equal(failed.integrity.hash, hashPayload(failed.payload));
  assert.deepEqual(await service.get(failed.payload.reportId), failed);
});

test('AI explanations enter the immutable payload before hashing and survive storage', async t => {
  const service = createReportService({ directory: await directory(t), aiOptions: options(async (_url, request) => {
    const entries = JSON.parse(JSON.parse(request.body).messages[1].content).findings;
    return response(entries.map(item => explanation(item.findingId)));
  }) });
  const report = await service.create({ filename: 'vulnerable.sol',
    source: await readFile(new URL('../../fixtures/vulnerable.sol', import.meta.url), 'utf8'), includeAi: true });
  assert.equal(report.payload.ai.status, 'completed');
  assert.equal(report.payload.ai.explanations.length, report.payload.findings.length);
  assert.equal(report.payload.findings[0].explanation, undefined);
  assert.equal(report.integrity.hash, hashPayload(report.payload));
  assert.deepEqual(await service.get(report.payload.reportId), report);
  assert.throws(() => { report.payload.ai.explanations[0].explanation = 'changed'; }, TypeError);
  const changed = structuredClone(report.payload);
  changed.ai.explanations[0].explanation = 'changed';
  assert.notEqual(hashPayload(changed), report.integrity.hash);
});


test('Groq errors yield safe actionable reasons without storing provider messages', async () => {
  const cases = [
    [401, 'invalid_api_key', 'INVALID_API_KEY'],
    [403, 'permission_denied', 'PROVIDER_ACCESS_DENIED'],
    [404, 'model_not_found', 'MODEL_UNAVAILABLE'],
    [400, 'invalid_request_error', 'PROVIDER_REQUEST_REJECTED'],
    [429, 'rate_limit_exceeded', 'RATE_LIMITED'],
    [429, 'insufficient_quota', 'QUOTA_EXCEEDED'],
    [500, 'unknown_error', 'PROVIDER_ERROR'],
  ];
  for (const [status, code, reason] of cases) {
    const result = await explainFindings(input, options(async () => Response.json({ error: { code, message: 'secret provider details' } }, { status })));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, reason);
    assert.deepEqual(result.explanations, []);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  const malformed = await explainFindings(input, options(async () => new Response('not-json', { status: 429 })));
  assert.equal(malformed.reason, 'RATE_LIMITED');
});

test('default configuration uses Groq credentials only and rejects blank keys', async t => {
  const previous = { groq: process.env.GROQ_API_KEY, openai: process.env.OPENAI_API_KEY, model: process.env.GROQ_MODEL };
  t.after(() => {
    for (const [name, value] of Object.entries({ GROQ_API_KEY: previous.groq, OPENAI_API_KEY: previous.openai, GROQ_MODEL: previous.model })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
  process.env.OPENAI_API_KEY = 'old-test-key';
  assert.equal((await explainFindings(input, { fetchImpl: () => { throw new Error('Must not call'); } })).reason, 'NOT_CONFIGURED');
  process.env.GROQ_API_KEY = 'groq-test-key';
  const result = await explainFindings(input, { fetchImpl: async (_url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer groq-test-key');
    assert.equal(JSON.parse(request.body).model, 'openai/gpt-oss-20b');
    return response([explanation()]);
  } });
  assert.equal(result.status, 'completed');
  assert.equal((await explainFindings(input, { apiKey: '   ' })).reason, 'NOT_CONFIGURED');
});


test('real scanner AI context includes call success checks and shared line references', async t => {
  const service = createReportService({ directory: await directory(t), aiOptions: options(async (_url, request) => {
    const sent = JSON.parse(JSON.parse(request.body).messages[1].content).findings;
    const snippets = new Map(sent.flatMap(item => item.snippets).map(item => [item.line, item.code]));
    const lowLevel = sent.find(item => item.detector === 'low-level-calls');
    const context = lowLevel.snippetLines.map(line => snippets.get(line)).join('\n');
    assert.match(context, /require\(success,/);
    assert.match(context, /call\{value: amount\}/);
    assert.ok(sent.every(item => item.contextIncomplete));
    assert.ok(sent.every(item => item.snippetLines.every(line => snippets.has(line))));
    assert.ok([...snippets.values()].reduce((n, code) => n + code.length, 0) <= sourceText.length / 4);
    return response(sent.map(item => explanation(item.findingId)));
  }) });
  const sourceText = await readFile(new URL('../../fixtures/vulnerable.sol', import.meta.url), 'utf8');
  assert.equal((await service.create({ filename: 'vulnerable.sol', source: sourceText, includeAi: true })).payload.ai.status, 'completed');
});
