#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../blockchain"
export XDG_CONFIG_HOME="$PWD/../.tools/config"
export XDG_CACHE_HOME="$PWD/../.tools/cache"
export XDG_DATA_HOME="$PWD/../.tools/data"
export HARDHAT_DISABLE_TELEMETRY_PROMPT=true
exec npx --no-install hardhat "$@"
