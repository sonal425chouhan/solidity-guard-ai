import { readFile } from 'node:fs/promises';
import { Contract, isAddress, keccak256 } from 'ethers';
import { deploymentPath, localChainId, localProvider, readArtifact, registrarIndex } from '../../../blockchain/config.js';
import { loadReport, saveRegistration, defaultReportDirectory } from '../storage.js';
import { hashPayload } from '../hashing.js';
import { AppError } from '../errors.js';

const hashPattern = /^0x[0-9a-f]{64}$/;

function verifyInput(body, saved) {
  if (body === undefined) return saved;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'reportPackage')) {
    throw new AppError(400, 'INVALID_INPUT', 'Provide an empty body or reportPackage.');
  }
  if (!Object.hasOwn(body, 'reportPackage')) return saved;
  const report = body.reportPackage;
  if (!report?.payload || typeof report.payload !== 'object' || Array.isArray(report.payload) ||
      report.payload.schemaVersion !== 1 || typeof report.payload.reportId !== 'string' ||
      !Array.isArray(report.payload.findings) || report.integrity?.algorithm !== 'SHA-256' ||
      report.integrity?.canonicalization !== 'sg-json-v1' || !hashPattern.test(report.integrity?.hash)) {
    throw new AppError(400, 'INVALID_REPORT', 'Provide a valid report package with payload and integrity metadata.');
  }
  return report;
}

export function createRegistryService({ directory = defaultReportDirectory, rpcUrl,
  deploymentFile = deploymentPath, signerIndex, storeReceipt = saveRegistration } = {}) {
  let registering = false;

  async function withRegistry(operation) {
    let provider;
    try {
      provider = localProvider(rpcUrl);
      const deployment = JSON.parse(await readFile(deploymentFile, 'utf8'));
      if (deployment.chainId !== localChainId || !isAddress(deployment.address) || !isAddress(deployment.registrar) ||
          !hashPattern.test(deployment.blockHash) || !hashPattern.test(deployment.transactionHash) ||
          !Number.isSafeInteger(deployment.blockNumber) || deployment.blockNumber < 0 ||
          !hashPattern.test(deployment.runtimeCodeHash)) throw new Error('Invalid deployment configuration.');
      if (Number(await provider.send('eth_chainId', [])) !== localChainId) throw new Error('Wrong chain.');
      const [code, deploymentReceipt] = await Promise.all([
        provider.getCode(deployment.address), provider.getTransactionReceipt(deployment.transactionHash),
      ]);
      if (code === '0x' || keccak256(code) !== deployment.runtimeCodeHash || !deploymentReceipt ||
          deploymentReceipt.status !== 1 || deploymentReceipt.blockHash !== deployment.blockHash ||
          deploymentReceipt.contractAddress?.toLowerCase() !== deployment.address.toLowerCase()) {
        throw new Error('Deployment is absent or stale.');
      }
      const contract = new Contract(deployment.address, (await readArtifact()).abi, provider);
      if ((await contract.authorizedRegistrar()).toLowerCase() !== deployment.registrar.toLowerCase()) {
        throw new Error('Unexpected registrar.');
      }
      return await operation({ provider, deployment, contract });
    } catch (error) {
      if (error instanceof AppError) throw error;
      return { status: 'unavailable', reason: 'BLOCKCHAIN_UNAVAILABLE',
        message: 'Could not confirm registry state. Check local RPC, deployment configuration, and whether Hardhat was reset. Retry to reconcile any submitted transaction.' };
    } finally {
      provider?.destroy();
    }
  }

  async function confirmedRegistration(provider, deployment, contract, hash) {
    const info = await contract.getRegistration(hash);
    if (!info.exists) return null;
    const events = await contract.queryFilter(contract.filters.ReportRegistered(hash), deployment.blockNumber, 'latest');
    const event = events[0];
    if (!event) throw new Error('Registration event is missing.');
    const receipt = await provider.getTransactionReceipt(event.transactionHash);
    if (!receipt || receipt.status !== 1 || receipt.blockHash !== event.blockHash) throw new Error('Registration is not confirmed.');
    return {
      reportHash: hash, chainId: deployment.chainId, registryAddress: deployment.address,
      registrar: info.registrar, registeredAt: Number(info.registeredAt),
      transactionHash: receipt.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
    };
  }

  return {
    async register(id, body) {
      if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) {
        throw new AppError(400, 'INVALID_INPUT', 'Registration accepts no client-supplied hash or metadata.');
      }
      if (registering) throw new AppError(429, 'REGISTRAR_BUSY', 'Another registration is in progress. Retry shortly.');
      registering = true;
      try {
        const saved = await loadReport(id, directory);
        const hash = hashPayload(saved.payload);
        const result = await withRegistry(async ({ provider, deployment, contract }) => {
          const existing = await confirmedRegistration(provider, deployment, contract, hash);
          if (existing) return { status: 'confirmed', alreadyRegistered: true, registration: existing };
          const signer = await provider.getSigner(registrarIndex(signerIndex));
          if ((await signer.getAddress()).toLowerCase() !== deployment.registrar.toLowerCase()) {
            throw new AppError(409, 'WRONG_REGISTRAR', 'Configured local signer is not the authorized registrar.');
          }
          let receipt;
          try {
            const transaction = await contract.connect(signer).registerReport(hash);
            receipt = await transaction.wait(1, 30_000);
          } catch (error) {
            // Another client may have registered after our initial read, or an RPC
            // response may have been lost. Only return success with chain evidence.
            const recovered = await confirmedRegistration(provider, deployment, contract, hash);
            if (recovered) return { status: 'confirmed', alreadyRegistered: true, registration: recovered };
            throw error;
          }
          if (!receipt || receipt.status !== 1) throw new Error('Registration not confirmed.');
          const registration = await confirmedRegistration(provider, deployment, contract, hash);
          if (!registration) throw new Error('Registration missing after receipt.');
          return { status: 'confirmed', alreadyRegistered: false, registration };
        });
        if (result.status === 'confirmed') {
          try { await storeReceipt(id, result.registration, directory); }
          catch {
            // Confirmation is chain evidence; a local cache failure cannot undo it.
            result.registrationWarning = 'Registration is confirmed on-chain, but the local receipt could not be saved. Check local storage and retry registration to recover the receipt.';
          }
        }
        return result;
      } finally {
        registering = false;
      }
    },

    async verify(id, body) {
      const saved = await loadReport(id, directory);
      const current = verifyInput(body, saved);
      let computedHash;
      try { computedHash = hashPayload(current.payload); }
      catch { throw new AppError(400, 'INVALID_REPORT', 'Report payload is not supported JSON.'); }
      const expectedHash = hashPayload(saved.payload);
      const matchesExpectedHash = computedHash === expectedHash;
      const matchesDeclaredHash = computedHash === current.integrity.hash;
      return withRegistry(async ({ contract, deployment }) => {
        const [registeredOnChain, expectedRegisteredOnChain] = await Promise.all([
          contract.verifyReport(computedHash), contract.verifyReport(expectedHash),
        ]);
        const status = !matchesExpectedHash || !matchesDeclaredHash ? 'mismatch' : registeredOnChain ? 'verified' : 'unregistered';
        return { status, computedHash, expectedHash, matchesExpectedHash, matchesDeclaredHash,
          registeredOnChain, expectedRegisteredOnChain, chainId: deployment.chainId, registryAddress: deployment.address };
      });
    },
  };
}
