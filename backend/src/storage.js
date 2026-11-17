import { mkdir, open, link, unlink, readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { hashPayload, freezeJson } from './hashing.js';

export const defaultReportDirectory = fileURLToPath(new URL('../data/reports/', import.meta.url));
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateReportId(id) {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new AppError(400, 'INVALID_REPORT_ID', 'Expected a report UUID.');
}

function validatePackage(report, id) {
  if (report?.payload?.reportId !== id || report.payload.schemaVersion !== 1 ||
      report.integrity?.algorithm !== 'SHA-256' || report.integrity?.canonicalization !== 'sg-json-v1' ||
      report.integrity.hash !== hashPayload(report.payload)) {
    throw new AppError(500, 'REPORT_INTEGRITY_ERROR', 'Stored report failed its integrity check.');
  }
}

function validRegistration(value, hash) {
  const digest = /^0x[0-9a-fA-F]{64}$/;
  const address = /^0x[0-9a-fA-F]{40}$/;
  return value?.reportHash === hash && value.chainId === 31337 &&
    address.test(value.registryAddress) && address.test(value.registrar) &&
    digest.test(value.transactionHash) && digest.test(value.blockHash) &&
    Number.isSafeInteger(value.blockNumber) && value.blockNumber >= 0 &&
    Number.isSafeInteger(value.registeredAt) && value.registeredAt > 0;
}

export async function saveReport(report, directory = defaultReportDirectory) {
  const id = report?.payload?.reportId;
  validateReportId(id);
  validatePackage(report, id);
  // Serialize before touching disk. The final filename never contains partial JSON.
  const json = JSON.stringify(report, null, 2) + '\n';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${id}.${randomUUID()}.tmp`);
  const destination = path.join(directory, `${id}.json`);
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(json, 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
    // Same-directory hard link atomically publishes a complete file and, unlike
    // rename, refuses to overwrite an existing immutable report.
    await link(temporary, destination);
  } catch (error) {
    if (error.code === 'EEXIST') throw new AppError(409, 'REPORT_EXISTS', 'This report already exists.');
    throw error;
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function loadReport(id, directory = defaultReportDirectory) {
  validateReportId(id);
  let report;
  try {
    report = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found.');
    if (error instanceof SyntaxError) throw new AppError(500, 'REPORT_INTEGRITY_ERROR', 'Stored report is not valid JSON.');
    throw error;
  }
  validatePackage(report, id);
  try {
    const registration = JSON.parse(await readFile(path.join(directory, 'registrations', `${id}.json`), 'utf8'));
    if (!validRegistration(registration, report.integrity.hash)) throw new SyntaxError('Invalid cached receipt.');
    report = { ...report, registration };
  } catch (error) {
    if (error instanceof SyntaxError) {
      report = { ...report, registrationWarning: 'Cached receipt metadata is corrupt. Verify or register again to recover live chain information.' };
    } else if (error.code !== 'ENOENT') {
      report = { ...report, registrationWarning: 'Cached receipt metadata could not be read. Check local storage permissions or repair the receipt path. Live blockchain verification remains available.' };
    }
  }
  return freezeJson(report);
}

// Mutable receipt metadata is kept separate from the immutable report file.
export async function saveRegistration(id, registration, directory = defaultReportDirectory) {
  await loadReport(id, directory);
  const targetDirectory = path.join(directory, 'registrations');
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const temporary = path.join(targetDirectory, `.${id}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(registration, null, 2) + '\n');
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, path.join(targetDirectory, `${id}.json`));
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
