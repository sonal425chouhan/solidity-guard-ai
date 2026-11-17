import { mkdir, mkdtemp, readdir, rm, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const scanDirectory = fileURLToPath(new URL('../../.tools/scans/', import.meta.url));
export const maxResultBytes = 4 * 1024 * 1024;

export async function cleanupStaleScans(base = scanDirectory) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(base, { withFileTypes: true })) {
    const match = /^scan-([1-9][0-9]*)-[A-Za-z0-9]{6}$/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid > 2147483647) continue;
    try { process.kill(pid, 0); }
    catch (error) {
      // Do not touch active/reused PIDs, other users' processes, or symlinks.
      if (error.code === 'ESRCH') await rm(path.join(base, entry.name), { recursive: true, force: true });
    }
  }
}

export async function prepareScanDirectory() {
  await cleanupStaleScans();
  return mkdtemp(path.join(scanDirectory, `scan-${process.pid}-`));
}

export async function readScanResult(filename) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > maxResultBytes) throw new Error('Scanner result exceeded 4 MiB or is not a regular file.');
    // Read no more than the limit even if the file changes after stat().
    const bytes = Buffer.alloc(maxResultBytes + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await file.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maxResultBytes) throw new Error('Scanner result exceeded 4 MiB.');
    return JSON.parse(bytes.subarray(0, total).toString('utf8'));
  } finally {
    await file.close();
  }
}
