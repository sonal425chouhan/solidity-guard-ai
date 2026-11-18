import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FetchRequest, JsonRpcProvider } from 'ethers';

export const deploymentPath = fileURLToPath(new URL('./deployments/localhost.json', import.meta.url));
export const artifactPath = fileURLToPath(new URL('./artifacts/contracts/AuditRegistry.sol/AuditRegistry.json', import.meta.url));
export const localChainId = 31337;

export async function readArtifact() {
  return JSON.parse(await readFile(artifactPath, 'utf8'));
}

export function localProvider(rpcUrl = process.env.BLOCKCHAIN_RPC_URL ?? 'http://127.0.0.1:8545') {
  const url = new URL(rpcUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Only a local HTTP blockchain RPC is supported.');
  }
  const request = new FetchRequest(url.href);
  request.timeout = 5000;
  // Explicit eth_chainId checks are made by callers; avoid background detection retries.
  return new JsonRpcProvider(request, localChainId, { staticNetwork: true, cacheTimeout: -1 });
}

export function registrarIndex(value = process.env.BLOCKCHAIN_SIGNER_INDEX ?? '0') {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > 19) throw new Error('Invalid local signer index.');
  return index;
}
