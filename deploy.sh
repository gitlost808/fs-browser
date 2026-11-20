#!/usr/bin/env bash
# infra-static-site-v1
set -euo pipefail
cd -- "$(dirname -- "$0")"
npm ci --include=dev --ignore-scripts --no-audit --no-fund
exec npm run build -- "$@"
