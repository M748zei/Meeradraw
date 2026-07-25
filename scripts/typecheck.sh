#!/usr/bin/env bash
# Stable typecheck — excludes .next generated noise when tsconfig is healthy.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npx tsc --noEmit --pretty false
