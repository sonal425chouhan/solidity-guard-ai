import { readFile } from 'node:fs/promises';
import { scanSource } from '../backend/src/services/scan.js';

const filename = process.argv[2];
if (!filename || !filename.endsWith('.sol')) {
  console.error('Usage: npm run scan -- fixtures/vulnerable.sol');
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await scanSource(await readFile(filename, 'utf8')), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
