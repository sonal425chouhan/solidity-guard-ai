import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { deployRegistry } from '../../../blockchain/scripts/deploy.js';
import { localProvider } from '../../../blockchain/config.js';
import { createReportService } from '../../src/services/reports.js';
import { createRegistryService } from '../../src/services/registry.js';
import { createApp } from '../../src/app.js';
import { hashPayload } from '../../src/hashing.js';

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sg-registry-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const deploymentFile = path.join(directory, 'deployment.json');
  const deployment = await deployRegistry({ destination: deploymentFile });
  const options = { directory, deploymentFile };
  const reports = createReportService(options);
  const source = await readFile(new URL('../../../fixtures/minimal.sol', import.meta.url), 'utf8');
  const report = await reports.create({ filename: 'minimal.sol', source });
  return { directory, deployment, options, reports, report, registry: createRegistryService(options), source };
}

test('register/verify real reports, recover duplicates, reject edits and substitution', async t => {
  const { directory, registry, reports, report, source } = await setup(t);
  const reportId = report.payload.reportId;
  const originalBytes = await readFile(path.join(directory, `${reportId}.json`), 'utf8');
  assert.equal((await registry.verify(reportId, {})).status, 'unregistered');
  const registered = await registry.register(reportId, {});
  assert.equal(registered.status, 'confirmed');
  assert.equal(registered.alreadyRegistered, false);
  assert.equal(registered.registration.reportHash, hashPayload(report.payload));
  assert.equal((await reports.get(reportId)).registration.transactionHash, registered.registration.transactionHash);
  assert.equal(await readFile(path.join(directory, `${reportId}.json`), 'utf8'), originalBytes);
  assert.equal((await registry.verify(reportId, {})).status, 'verified');
  await writeFile(path.join(directory, 'registrations', `${reportId}.json`), '{broken');
  assert.match((await reports.get(reportId)).registrationWarning, /corrupt/);
  assert.equal((await registry.verify(reportId, {})).status, 'verified');
  assert.equal((await registry.register(reportId, {})).registration.transactionHash, registered.registration.transactionHash);
  assert.equal((await reports.get(reportId)).registrationWarning, undefined);
  // Saved metadata is merely a cached receipt; verification does not trust it.
  await writeFile(path.join(directory, 'registrations', `${reportId}.json`), JSON.stringify({ transactionHash: 'invented' }));
  assert.equal((await registry.verify(reportId, {})).status, 'verified');
  const duplicate = await registry.register(reportId, {});
  assert.equal(duplicate.alreadyRegistered, true);
  assert.equal(duplicate.registration.transactionHash, registered.registration.transactionHash);
  // Lost metadata is recovered from the actual event and receipt.
  await rm(path.join(directory, 'registrations', `${reportId}.json`));
  assert.equal((await registry.register(reportId, {})).registration.transactionHash, registered.registration.transactionHash);
  const changed = structuredClone(report);
  changed.payload.summary.overallRisk = 'Changed';
  assert.equal((await registry.verify(reportId, { reportPackage: changed })).status, 'mismatch');
  changed.integrity.hash = hashPayload(changed.payload);
  assert.equal((await registry.verify(reportId, { reportPackage: changed })).status, 'mismatch');
  const other = await reports.create({ filename: 'other.sol', source });
  await registry.register(other.payload.reportId, {});
  const substituted = await registry.verify(reportId, { reportPackage: other });
  assert.equal(substituted.registeredOnChain, true);
  assert.equal(substituted.matchesExpectedHash, false);
  assert.equal(substituted.status, 'mismatch');
});

test('API endpoints use live state and distinguish unavailable RPC from mismatch', async t => {
  const { options, report } = await setup(t);
  const server = createApp(options).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/reports/${report.payload.reportId}`;
  const post = (action, body) => fetch(`${base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('register', { hash: report.integrity.hash })).status, 400);
  assert.equal((await post('verify', { reportPackage: {} })).status, 400);
  assert.equal((await post('register', {})).status, 200);
  assert.equal((await (await post('verify', {})).json()).data.status, 'verified');
  const changed = structuredClone(report);
  changed.payload.contract.filename = 'edited.sol';
  assert.equal((await (await post('verify', { reportPackage: changed })).json()).data.status, 'mismatch');
  const unavailable = createRegistryService({ ...options, rpcUrl: 'http://127.0.0.1:1' });
  assert.equal((await unavailable.verify(report.payload.reportId, { reportPackage: changed })).status, 'unavailable');
  assert.equal((await unavailable.register(report.payload.reportId, {})).status, 'unavailable');
  const unavailableServer = createApp({ ...options, rpcUrl: 'http://127.0.0.1:1' }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => unavailableServer.close(resolve)));
  await once(unavailableServer, 'listening');
  const response = await fetch(`http://127.0.0.1:${unavailableServer.address().port}/api/reports/${report.payload.reportId}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportPackage: changed }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).data.status, 'unavailable');
});

test('stale deployment after chain-state loss is unavailable despite saved metadata', async t => {
  const { registry, report, deployment } = await setup(t);
  await registry.register(report.payload.reportId, {});
  const provider = localProvider();
  const snapshot = await provider.send('evm_snapshot', []);
  try {
    await provider.send('hardhat_setCode', [deployment.address, '0x']);
    assert.equal((await registry.verify(report.payload.reportId, {})).status, 'unavailable');
  } finally {
    await provider.send('evm_revert', [snapshot]);
    provider.destroy();
  }
});

test('wrong signer and tampered stored payload cannot register', async t => {
  const { options, directory, report, registry } = await setup(t);
  const wrongSigner = createRegistryService({ ...options, signerIndex: 1 });
  await assert.rejects(wrongSigner.register(report.payload.reportId, {}), { code: 'WRONG_REGISTRAR' });
  const tampered = structuredClone(report);
  tampered.payload.contract.filename = 'tampered.sol';
  await writeFile(path.join(directory, `${report.payload.reportId}.json`), JSON.stringify(tampered));
  await assert.rejects(registry.register(report.payload.reportId, {}), { code: 'REPORT_INTEGRITY_ERROR' });
});

test('registration metadata is not saved before mining confirms the transaction', async t => {
  const { registry, report, directory } = await setup(t);
  const provider = localProvider();
  await provider.send('evm_setAutomine', [false]);
  let pending;
  try {
    pending = registry.register(report.payload.reportId, {});
    let queued = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const block = await provider.send('eth_getBlockByNumber', ['pending', false]);
      if (block.transactions.length) { queued = true; break; }
      await delay(20);
    }
    assert.equal(queued, true);
    await assert.rejects(readFile(path.join(directory, 'registrations', `${report.payload.reportId}.json`)), { code: 'ENOENT' });
    await provider.send('evm_mine', []);
    assert.equal((await pending).status, 'confirmed');
  } finally {
    await provider.send('evm_setAutomine', [true]);
    await provider.send('evm_mine', []);
    await pending;
    provider.destroy();
  }
});


test('confirmed registration survives a local receipt write failure and recovers on retry', async t => {
  const { options, report, registry } = await setup(t);
  const failingCache = createRegistryService({ ...options, storeReceipt: async () => {
    throw new Error('Simulated disk full');
  } });
  const result = await failingCache.register(report.payload.reportId, {});
  assert.equal(result.status, 'confirmed');
  assert.match(result.registrationWarning, /local receipt could not be saved/);
  assert.equal((await registry.verify(report.payload.reportId, {})).status, 'verified');
  const recovered = await registry.register(report.payload.reportId, {});
  assert.equal(recovered.alreadyRegistered, true);
  assert.equal(recovered.registration.transactionHash, result.registration.transactionHash);
  assert.equal(recovered.registrationWarning, undefined);
});


test('unreadable receipt files do not block retrieval, registration, or live verification', async t => {
  const { directory, registry, report, options } = await setup(t);
  const id = report.payload.reportId;
  const registered = await registry.register(id, {});
  const receiptPath = path.join(directory, 'registrations', `${id}.json`);
  const server = createApp(options).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/reports/${id}`;
  for (const failure of ['directory', 'permission']) {
    await rm(receiptPath, { recursive: true, force: true });
    if (failure === 'directory') await mkdir(receiptPath);
    else {
      await writeFile(receiptPath, JSON.stringify(registered.registration));
      await chmod(receiptPath, 0o000);
    }
    try {
      // Permission denial requires an unprivileged process; directory errors work for root too.
      if (failure === 'permission' && process.getuid?.() === 0) continue;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      const loaded = (await response.json()).data;
      assert.deepEqual(loaded.payload, report.payload);
      assert.deepEqual(loaded.integrity, report.integrity);
      assert.equal(loaded.registration, undefined);
      assert.match(loaded.registrationWarning, /could not be read/);
      assert.equal((await registry.verify(id, {})).status, 'verified');
      const retry = await registry.register(id, {});
      assert.equal(retry.status, 'confirmed');
      assert.equal(retry.registration.transactionHash, registered.registration.transactionHash);
      if (failure === 'directory') assert.match(retry.registrationWarning, /could not be saved/);
    } finally {
      if (failure === 'permission') await chmod(receiptPath, 0o600);
    }
  }
  await rm(receiptPath, { recursive: true, force: true });
  assert.equal((await registry.register(id, {})).registrationWarning, undefined);
  // Only optional receipt reads degrade gracefully; damaged report payloads still fail.
  await writeFile(path.join(directory, `${id}.json`), '{broken');
  assert.equal((await fetch(url)).status, 500);
  await assert.rejects(registry.verify(id, {}), { code: 'REPORT_INTEGRITY_ERROR' });
});
