#!/usr/bin/env bash
# Runs both test suites (plan parity is verified across the TS and Python scalers).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▸ studio engine tests (TypeScript)"
(cd "$ROOT/frontend" && npm test)

echo "▸ production node tests (Python)"
if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  echo "backend environment missing — run ./scripts/setup.sh first" >&2
  exit 1
fi
(cd "$ROOT/backend" && .venv/bin/python -m pytest)

echo "✓ all suites passed"
