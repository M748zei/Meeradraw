#!/usr/bin/env bash
# Validate generation reliability + credit ledger against a local Firestore emulator.
#
# Usage (from repo root on your Mac):
#   chmod +x scripts/run-generation-reliability-emulator.sh
#   ./scripts/run-generation-reliability-emulator.sh
#
# Requirements:
#   - Node.js 20+
#   - Java 11+ (firebase-tools emulator)
#   - Network once to download firebase-tools / emulator binaries
#
# This script does NOT touch production Firestore.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8080}"
export FIREBASE_AUTH_EMULATOR_HOST="${FIREBASE_AUTH_EMULATOR_HOST:-127.0.0.1:9099}"
export NEXT_PUBLIC_FIREBASE_PROJECT_ID="${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-demo-meeradraw}"
export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-demo-meeradraw}"
# Admin SDK against emulator must not use real service-account credentials.
unset FIREBASE_CLIENT_EMAIL || true
unset FIREBASE_PRIVATE_KEY || true
unset GOOGLE_APPLICATION_CREDENTIALS || true

echo "==> Starting Firestore emulator (project=$FIREBASE_PROJECT_ID)"
echo "    FIRESTORE_EMULATOR_HOST=$FIRESTORE_EMULATOR_HOST"

npx -y firebase-tools@latest emulators:exec \
  --only firestore \
  --project "$FIREBASE_PROJECT_ID" \
  "npm run test:generation-reliability"
