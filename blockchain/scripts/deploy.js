import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ContractFactory, keccak256 } from 'ethers';
import { deploymentPath, localProvider, localChainId, readArtifact, registrarIndex } from '../config.js';

export async function deployRegistry({ rpcUrl, signerIndex, destination = deploymentPath } = {}) {
  const provider = localProvider(rpcUrl);
  try {
    if (Number(await provider.send('eth_chainId', [])) !== localChainId) throw new Error('Expected local chain 31337.');
    const signer = await provider.getSigner(registrarIndex(signerIndex));
    const registrar = await signer.getAddress();
    const artifact = await readArtifact();
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(registrar);
    const receipt = await contract.deploymentTransaction().wait(1, 30_000);
    if (!receipt || receipt.status !== 1) throw new Error('Deployment was not confirmed.');
    const address = await contract.getAddress();
    const deployment = {
      address, chainId: localChainId, registrar,
      transactionHash: receipt.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
      runtimeCodeHash: keccak256(await provider.getCode(address)),
    };
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(deployment, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    return deployment;
  } finally {
    provider.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await deployRegistry(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
