import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPayload, serializeDeterministically, sha256 } from '../src/hashing.js';

test('canonical JSON has stable nested key ordering and preserves arrays', () => {
  const first = { z: [3, { b: true, a: 'λ\n' }], a: null };
  const second = { a: null, z: [3, { a: 'λ\n', b: true }] };
  assert.equal(serializeDeterministically(first), '{"a":null,"z":[3,{"a":"λ\\n","b":true}]}');
  assert.equal(hashPayload(first), hashPayload(second));
  assert.equal(hashPayload(first), hashPayload(JSON.parse(JSON.stringify(first))));
  assert.notEqual(hashPayload([1, 2]), hashPayload([2, 1]));
  assert.notEqual(hashPayload({ description: 'original' }), hashPayload({ description: 'edited' }));
});

test('SHA-256 matches a known UTF-8 test vector', () => {
  assert.equal(sha256('abc'), '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('canonicalization rejects ambiguous or unsupported JSON values', () => {
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, { x: undefined }, NaN, Infinity, 1n, new Date(), new Array(2), cycle]) {
    assert.throws(() => serializeDeterministically(value), TypeError);
  }
});

test('integrity metadata is external to the payload digest', () => {
  const payload = { reportId: 'example', findings: [] };
  const report = { payload, integrity: { hash: hashPayload(payload) } };
  const original = report.integrity.hash;
  report.registration = { transactionHash: 'future-metadata' };
  assert.equal(hashPayload(report.payload), original);
  assert.notEqual(hashPayload(report), original);
});

test('generated nested payloads retain their digest across key permutations and detect edits', () => {
  function reverseKeys(value) {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverseKeys(value[key])]));
    }
    return value;
  }
  for (let seed = 0; seed < 100; seed++) {
    const payload = {
      reportId: `generated-${seed}`,
      findings: Array.from({ length: seed % 7 + 1 }, (_, index) => ({
        id: `finding-${index}`, description: `Unicode λ ${seed}:${index}\n`,
        locations: [{ lines: [index + 1, index + 2], column: seed + 1 }],
      })),
      ai: { status: 'disabled', explanations: [] },
    };
    const digest = hashPayload(payload);
    assert.equal(hashPayload(reverseKeys(payload)), digest);
    assert.equal(hashPayload(JSON.parse(JSON.stringify(payload, null, 2))), digest);
    const modified = structuredClone(payload);
    modified.findings[0].locations[0].lines[0] += 1;
    assert.notEqual(hashPayload(modified), digest);
  }
});
