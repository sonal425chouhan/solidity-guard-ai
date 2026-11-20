import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createApp } from '../backend/src/app.js';

const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/reports`;
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result.data;
}
try {
  const source = await readFile(new URL('../fixtures/vulnerable.sol', import.meta.url), 'utf8');
  const report = await post(base, { filename: 'vulnerable.sol', source });
  const url = `${base}/${report.payload.reportId}`;
  const saved = (await (await fetch(url)).json()).data;
  assert.deepEqual(saved, report);
  const registration = await post(`${url}/register`, {});
  assert.equal(registration.status, 'confirmed');
  const original = await post(`${url}/verify`, { reportPackage: report });
  assert.equal(original.status, 'verified');
  const modified = structuredClone(report);
  modified.payload.findings[0].description += ' EDITED AFTER REGISTRATION';
  const changed = await post(`${url}/verify`, { reportPackage: modified });
  assert.equal(changed.status, 'mismatch');
  console.log(JSON.stringify({ reportId: report.payload.reportId, findings: report.payload.findings.length,
    reportHash: report.integrity.hash, transactionHash: registration.registration.transactionHash,
    registration: registration.status, original: original.status, modified: changed.status,
    modifiedMatchesExpectedHash: changed.matchesExpectedHash }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
}
