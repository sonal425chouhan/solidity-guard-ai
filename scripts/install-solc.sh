#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'This setup supports Linux x86_64 or WSL2 x86_64.' >&2
  exit 1
fi
mkdir -p .tools
# Official Solidity release manifest supplies the SHA-256 checksum.
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/linux-amd64/list.json \
  -o .tools/solc-list.json
node --input-type=module <<'NODE'
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync('.tools/solc-list.json', 'utf8'));
const filename = manifest.releases['0.8.28'];
const build = manifest.builds.find(item => item.path === filename);
const expectedHash = '9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25';
if (!build || filename !== 'solc-linux-amd64-v0.8.28+commit.7893614a' || build.sha256.replace(/^0x/, '') !== expectedHash) {
  throw new Error('Unexpected compiler manifest');
}
fs.writeFileSync('.tools/solc-download-path', filename);
fs.writeFileSync('.tools/solc-checksum', `${build.sha256.replace(/^0x/, '')}  .tools/solc-0.8.28\n`);
NODE
curl --fail --silent --show-error --location \
  "https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/linux-amd64/$(cat .tools/solc-download-path)" \
  -o .tools/solc-0.8.28
sha256sum --check .tools/solc-checksum
chmod 755 .tools/solc-0.8.28
.tools/solc-0.8.28 --version
