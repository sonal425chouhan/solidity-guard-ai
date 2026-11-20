import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Contract, keccak256, zeroPadValue, isAddress } from 'ethers';
import { inspectToolchain } from '../backend/src/scanner-toolchain.js';
import { artifactPath, deploymentPath, localProvider, localChainId, readArtifact } from '../blockchain/config.js';

// This registry has one immutable: authorizedRegistrar. solc's artifact contains
// zero placeholders at these offsets; deployed code contains the constructor value.
export function runtimeWithRegistrar(artifact, compiled, registrar) {
  if (!isAddress(registrar) || `0x${compiled.object}` !== artifact.deployedBytecode) {
    throw new Error('Artifact/build-info mismatch; run npm run compile:registry.');
  }
  const groups = Object.values(compiled.immutableReferences ?? {});
  if (groups.length !== 1 || !groups[0].length) throw new Error('Expected one registry immutable in build-info.');
  const code = Buffer.from(compiled.object, 'hex');
  for (const { start, length } of groups[0]) {
    if (!Number.isSafeInteger(start) || start < 0 || length !== 32 || start + length > code.length) {
      throw new Error('Invalid immutable bytecode offsets.');
    }
    Buffer.from(zeroPadValue(registrar, length).slice(2), 'hex').copy(code, start);
  }
  return `0x${code.toString('hex')}`;
}

export async function checkRegistry() {
  const artifact = await readArtifact();
  const debug = JSON.parse(await readFile(artifactPath.replace(/\.json$/, '.dbg.json'), 'utf8'));
  const build = JSON.parse(await readFile(path.resolve(path.dirname(artifactPath), debug.buildInfo), 'utf8'));
  const source = await readFile(fileURLToPath(new URL('../blockchain/contracts/AuditRegistry.sol', import.meta.url)), 'utf8');
  if (build.input.sources[artifact.sourceName]?.content !== source) throw new Error('Contract source changed since compilation. Recompile and redeploy.');
  const compiled = build.output.contracts[artifact.sourceName][artifact.contractName].evm.deployedBytecode;
  const deployment = JSON.parse(await readFile(deploymentPath, 'utf8'));
  const expected = runtimeWithRegistrar(artifact, compiled, deployment.registrar);
  if (deployment.chainId !== localChainId || !isAddress(deployment.address) || keccak256(expected) !== deployment.runtimeCodeHash) {
    throw new Error('Deployment does not match this compiled contract and registrar. Redeploy locally.');
  }
  const provider = localProvider();
  try {
    if (Number(await provider.send('eth_chainId', [])) !== localChainId) throw new Error('Unexpected local chain ID.');
    const [code, receipt] = await Promise.all([
      provider.getCode(deployment.address), provider.getTransactionReceipt(deployment.transactionHash),
    ]);
    if (code !== expected || !receipt || receipt.status !== 1 || receipt.blockHash !== deployment.blockHash ||
        receipt.blockNumber !== deployment.blockNumber || receipt.contractAddress?.toLowerCase() !== deployment.address.toLowerCase()) {
      throw new Error('Local deployment is absent or stale. Run npm run deploy:local for this chain session.');
    }
    const contract = new Contract(deployment.address, artifact.abi, provider);
    if ((await contract.authorizedRegistrar()).toLowerCase() !== deployment.registrar.toLowerCase()) throw new Error('Registrar mismatch.');
    console.log('PASS: current source, compiled artifact (with immutable registrar), deployment receipt and live runtime agree.');
    console.log(`Registry: chain ${localChainId}, ${deployment.address}`);
  } finally { provider.destroy(); }
}

async function doctor() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24.');
  await inspectToolchain();
  console.log('PASS: Node.js 24, Slither 0.11.6 and Solidity 0.8.28 are available at this installation path.');
  if (!process.argv.includes('--scanner-only')) await checkRegistry();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  doctor().catch(error => {
    // RPC errors may contain configuration details; provide bounded setup guidance.
    console.error(`Preflight failed: ${error.code === 'ECONNREFUSED' ? 'Local Hardhat node is not running.' : error.code === 'ENOENT' ? 'Generated tools/artifacts/deployment are missing.' : error.message.split('\n')[0].slice(0, 250)}`);
    console.error('Use npm run setup:local to rebuild copied/missing tools. Start npm run chain, then npm run deploy:local and rerun npm run doctor.');
    process.exitCode = 1;
  });
}
