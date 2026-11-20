import { mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.tools/compile-check');
await mkdir(directory, { recursive: true });
const config = path.join(directory, 'hardhat.config.cjs');
await writeFile(config, `const base = require('../../blockchain/hardhat.config.cjs');
module.exports = { ...base, paths: ${JSON.stringify({
  root,
  sources: path.join(root, 'fixtures'),
  artifacts: path.join(directory, 'artifacts'),
  cache: path.join(directory, 'cache'),
})} };
`);
try {
  const result = spawnSync('bash', [path.join(root, 'scripts/hardhat.sh'), '--config', config, 'compile'], {
    stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
