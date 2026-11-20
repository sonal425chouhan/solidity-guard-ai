#!/usr/bin/env node
// crytic-compile adds --allow-paths automatically. Disable all import callbacks instead.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = [];
const input = process.argv.slice(2);
for (let index = 0; index < input.length; index += 1) {
  if (input[index] === '--allow-paths') {
    index += 1;
  } else if (!input[index].startsWith('--allow-paths=')) {
    args.push(input[index]);
  }
}
if (!args.includes('--version')) args.push('--no-import-callback');
const result = spawnSync(fileURLToPath(new URL('../.tools/solc-0.8.28', import.meta.url)), args, {
  stdio: 'inherit',
  shell: false,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
