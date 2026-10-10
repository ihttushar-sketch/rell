#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# rell — one command launcher.
#
#   ./run.sh                 start the web UI + API on http://localhost:8000
#   PORT=9000 ./run.sh       use another port
#   ./run.sh --dev           auto-reload on code changes
#   ./run.sh --no-install    skip dependency installation
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-${RELL_PORT:-8000}}"
HOST="${HOST:-${RELL_HOST:-0.0.0.0}}"
DEV=0
INSTALL=1

for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    --no-install) INSTALL=0 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# --- pick a python ----------------------------------------------------------
PY_BIN="${PYTHON:-}"
if [[ -z "$PY_BIN" ]]; then
  for candidate in python3.12 python3.11 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then PY_BIN="$candidate"; break; fi
  done
fi
if [[ -z "$PY_BIN" ]]; then
  echo "rell: no python3 found. Install Python 3.10+ and run again." >&2
  exit 1
fi

# --- virtualenv -------------------------------------------------------------
if [[ ! -x ".venv/bin/python" ]]; then
  echo "rell: creating .venv …"
  "$PY_BIN" -m venv .venv
fi
PY=".venv/bin/python"

if [[ "$INSTALL" == "1" ]]; then
  if ! "$PY" -c "import fastapi, yt_dlp, uvicorn" >/dev/null 2>&1; then
    echo "rell: installing dependencies (first run only) …"
    "$PY" -m pip install --quiet --upgrade pip
    "$PY" -m pip install --quiet -r requirements.txt
  fi
fi

mkdir -p downloads data

export RELL_HOST="$HOST"
export RELL_PORT="$PORT"
[[ "$DEV" == "1" ]] && export RELL_RELOAD=1

echo
echo "  rell is starting"
echo "  ────────────────────────────────────────────────"
echo "  UI    http://localhost:${PORT}"
echo "  API   http://localhost:${PORT}/docs"
echo "  Files $(pwd)/downloads"
echo "  ────────────────────────────────────────────────"
echo "  press Ctrl+C to stop"
echo

exec "$PY" -m app.main
