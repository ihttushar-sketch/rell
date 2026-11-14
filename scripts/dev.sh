#!/usr/bin/env bash
# Runs the production node (FastAPI) and the studio (Next.js) together.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${NEXUS_API_PORT:-8000}"
STUDIO_PORT="${NEXUS_STUDIO_PORT:-3000}"

if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  echo "backend environment missing — run ./scripts/setup.sh first" >&2
  exit 1
fi
if ! "$ROOT/backend/.venv/bin/python" -c "import fastapi" >/dev/null 2>&1; then
  echo "▸ installing backend dependencies"
  "$ROOT/backend/.venv/bin/pip" install --quiet -r "$ROOT/backend/requirements.txt"
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "▸ installing studio dependencies"
  (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
fi

cleanup() {
  if [ -n "${API_PID:-}" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "▸ production node  http://localhost:${API_PORT}  (docs at /docs)"
(cd "$ROOT/backend" && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT") &
API_PID=$!

sleep 1
echo "▸ studio           http://localhost:${STUDIO_PORT}"
cd "$ROOT/frontend"
NEXUS_BACKEND_URL="http://127.0.0.1:${API_PORT}" npm run dev -- -p "$STUDIO_PORT"
