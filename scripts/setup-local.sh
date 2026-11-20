#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python_bin="${PYTHON_BIN:-python3.12}"
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'Use Linux x86_64 or WSL2 x86_64.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Node.js 24 is required")'
if ! command -v "$python_bin" >/dev/null; then
  echo 'Install Python 3.12 with venv support, or set PYTHON_BIN to its executable.' >&2
  exit 1
fi
"$python_bin" -c 'import sys; assert sys.version_info[:2] == (3,12), "Python 3.12 is required"'
# Do not reuse copied environments: console-script shebangs contain absolute paths.
if [[ -e .venv || -L .venv ]]; then
  backup=".venv.backup-$(date +%s)-$$"
  mv .venv "$backup"
  echo "Previous virtual environment preserved as $backup"
fi
"$python_bin" -m venv .venv
.venv/bin/python -m pip install -r requirements-slither.txt
npm ci
bash scripts/install-solc.sh
chmod +x scripts/solc.js
if [[ ! -e backend/.env ]]; then
  cp backend/.env.example backend/.env
  chmod 600 backend/.env
fi
.venv/bin/python -m pip check
node scripts/doctor.js --scanner-only
printf '%s\n' 'Setup complete. Start Hardhat, deploy locally, then run npm run doctor (see README).'
