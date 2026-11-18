import test from 'node:test';
import assert from 'node:assert/strict';
import { Contract, ContractFactory, ZeroAddress, ZeroHash, id } from 'ethers';
import { localProvider, readArtifact } from '../config.js';

async function setup(t) {
  const provider = localProvider();
  t.after(() => provider.destroy());
  const signer = await provider.getSigner(0);
  const artifact = await readArtifact();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(await signer.getAddress());
  await contract.waitForDeployment();
  return { provider, signer, factory, contract, artifact };
}

function revertNamed(contract, name) {
  return error => {
    const data = error.data ?? error.info?.error?.data?.data ?? error.info?.error?.data;
    assert.equal(contract.interface.parseError(typeof data === 'object' ? data.data : data).name, name);
    return true;
  };
}

test('authorized registration stores metadata and emits the correct event', async t => {
  const { contract, signer, provider } = await setup(t);
  const hash = id('contract registration fixture');
  const receipt = await (await contract.registerReport(hash)).wait();
  assert.equal(receipt.status, 1);
  const info = await contract.getRegistration(hash);
  assert.equal(info.exists, true);
  assert.equal(info.registrar, await signer.getAddress());
  assert.equal(info.registeredAt, BigInt((await provider.getBlock(receipt.blockNumber)).timestamp));
  const event = contract.interface.parseLog(receipt.logs[0]);
  assert.equal(event.name, 'ReportRegistered');
  assert.equal(event.args.reportHash, hash);
  assert.equal(event.args.registrar, info.registrar);
  assert.equal(event.args.registeredAt, info.registeredAt);
});

test('zero hashes, duplicates, and unauthorized registration revert', async t => {
  const { contract, provider } = await setup(t);
  await assert.rejects(contract.registerReport.staticCall(ZeroHash), revertNamed(contract, 'InvalidHash'));
  const hash = id('duplicate');
  await (await contract.registerReport(hash)).wait();
  await assert.rejects(contract.registerReport.staticCall(hash), revertNamed(contract, 'AlreadyRegistered'));
  const other = contract.connect(await provider.getSigner(1));
  await assert.rejects(other.registerReport.staticCall(id('unauthorized')), revertNamed(contract, 'Unauthorized'));
});

test('anyone can read registered and unknown hashes', async t => {
  const { contract, provider, artifact } = await setup(t);
  const hash = id('public verification');
  await (await contract.registerReport(hash)).wait();
  const reader = new Contract(await contract.getAddress(), artifact.abi, await provider.getSigner(1));
  assert.equal(await reader.verifyReport(hash), true);
  assert.equal(await reader.verifyReport(ZeroHash), false);
  const unknown = await reader.getRegistration(id('unknown'));
  assert.equal(unknown.exists, false);
  assert.equal(unknown.registrar, ZeroAddress);
  assert.equal(unknown.registeredAt, 0n);
});

test('deployment rejects a zero registrar', async t => {
  const { factory, contract } = await setup(t);
  await assert.rejects(factory.deploy(ZeroAddress), revertNamed(contract, 'InvalidRegistrar'));
});

test('registration sequence preserves prior records and rejects writes by other accounts', async t => {
  const { contract, provider, signer } = await setup(t);
  const registrar = await signer.getAddress();
  const records = [];
  for (let index = 0; index < 8; index++) {
    const hash = id(`invariant-report-${index}`);
    const outsider = contract.connect(await provider.getSigner(index % 3 + 1));
    await assert.rejects(outsider.registerReport.staticCall(hash), revertNamed(contract, 'Unauthorized'));
    assert.equal(await contract.verifyReport(hash), false);
    await (await contract.registerReport(hash)).wait();
    const registration = await contract.getRegistration(hash);
    assert.equal(registration.registrar, registrar);
    assert.ok(registration.registeredAt > 0n);
    records.push({ hash, registration });
    await assert.rejects(contract.registerReport.staticCall(hash), revertNamed(contract, 'AlreadyRegistered'));
    for (const previous of records) {
      assert.deepEqual(Array.from(await contract.getRegistration(previous.hash)), Array.from(previous.registration));
      assert.equal(await outsider.verifyReport(previous.hash), true);
    }
    assert.equal(await contract.authorizedRegistrar(), registrar);
    assert.equal(await contract.verifyReport(id(`unknown-${index}`)), false);
  }
});
