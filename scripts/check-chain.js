import assert from 'node:assert/strict';
import { JsonRpcProvider } from 'ethers';

const provider = new JsonRpcProvider('http://127.0.0.1:8545');
try {
  const network = await provider.getNetwork();
  assert.equal(network.chainId, 31337n);
  const signer = await provider.getSigner(0);
  const address = await signer.getAddress();
  assert.ok(await provider.getBalance(address) > 0n);
  // A zero-value self-transfer checks signing, submission, and receipt compatibility.
  const receipt = await (await signer.sendTransaction({ to: address, value: 0n })).wait();
  assert.equal(receipt.status, 1);
  console.log(`PASS: Ethers connected to Hardhat chain ${network.chainId}; transaction confirmed.`);
} finally {
  provider.destroy();
}
