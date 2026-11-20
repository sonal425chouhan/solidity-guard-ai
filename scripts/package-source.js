import { readFile, readdir, lstat, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const files = ['README.md', 'package.json', 'package-lock.json', '.gitignore', '.nvmrc',
  'requirements-slither.txt', 'backend/package.json', 'backend/.env.example',
  'frontend/package.json', 'frontend/index.html', 'frontend/vite.config.js',
  'frontend/playwright.config.js', 'blockchain/package.json', 'blockchain/config.js',
  'blockchain/hardhat.config.cjs'];
const directories = { 'backend/src': ['.js'], 'backend/tests': ['.js'],
  'frontend/src': ['.js', '.jsx', '.css'], 'frontend/tests': ['.js'],
  'blockchain/contracts': ['.sol'], 'blockchain/scripts': ['.js'], 'blockchain/test': ['.js'],
  scripts: ['.js', '.sh'], fixtures: ['.sol'], docs: ['.md', '.png'] };

export function checkSourceText(text, name, privateValues = []) {
  if (/(?:gsk_[A-Za-z0-9]{25,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text) ||
      privateValues.some(value => text.includes(value))) {
    throw new Error(`Possible credential in ${name}; archive refused. No values are printed.`);
  }
  if (name.endsWith('.env.example') && /^[ \t]*[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)[ \t]*=[ \t]*\S+/m.test(text)) {
    throw new Error('Environment template must have blank credential values.');
  }
}

export async function packageSource(source = root, destination = path.join(root, 'dist/SolidityGuard-AI-source.tar.gz')) {
  const selected = [...files];
  async function walk(directory, extensions) {
    for (const entry of await readdir(path.join(source, directory), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${directory}/${entry.name}`);
      if (entry.name.startsWith('.')) continue;
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(name, extensions);
      else if (entry.isFile() && extensions.includes(path.extname(entry.name))) selected.push(name);
    }
  }
  for (const [directory, extensions] of Object.entries(directories)) await walk(directory, extensions);
  // Also detect copies of local key values, without displaying or packaging .env.
  let privateValues = [];
  try {
    privateValues = (await readFile(path.join(source, 'backend/.env'), 'utf8')).split(/\r?\n/)
      .filter(line => /^[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=/.test(line))
      .map(line => line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, ''))
      .filter(value => value.length >= 16);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = await mkdtemp(path.join(tmpdir(), 'sg-source-'));
  try {
    for (const name of selected.sort()) {
      const input = path.join(source, name);
      if (!(await lstat(input)).isFile()) throw new Error(`Regular file required: ${name}`);
      if (!name.endsWith('.png')) checkSourceText(await readFile(input, 'utf8'), name, privateValues);
      const output = path.join(stage, 'SolidityGuard-AI', name);
      await mkdir(path.dirname(output), { recursive: true });
      await cp(input, output, { dereference: false });
    }
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = path.join(stage, 'source.tar.gz');
    await run('tar', ['-czf', temporary, '-C', stage, 'SolidityGuard-AI']);
    await cp(temporary, destination, { errorOnExist: true, force: false });
    console.log(`Source package created: ${destination} (${selected.length} files; source allowlist and credential checks passed)`);
    return selected;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageSource(root, process.argv[2] ? path.resolve(process.argv[2]) : undefined)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
