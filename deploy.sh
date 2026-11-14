#!/usr/bin/env bash
# infra-static-site-v1
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec node scripts/build.mjs "$@"
