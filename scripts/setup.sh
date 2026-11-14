#!/usr/bin/env bash
# One-command local install for NEXUS FRAME.
#   ./scripts/setup.sh          core engine (ffmpeg via PyPI, OpenCV, PySceneDetect, yt-dlp)
#   ./scripts/setup.sh --ml     + Demucs 3-stem separation, librosa beat tracking, torch
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ML=0
for arg in "$@"; do
  case "$arg" in
    --ml) ML=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
command -v node >/dev/null || { echo "node 20+ is required" >&2; exit 1; }

echo "▸ backend environment"
if [ ! -d "$ROOT/backend/.venv" ]; then
  python3 -m venv "$ROOT/backend/.venv"
fi
"$ROOT/backend/.venv/bin/pip" install --quiet --upgrade pip
"$ROOT/backend/.venv/bin/pip" install --quiet -r "$ROOT/backend/requirements-dev.txt"
if [ "$ML" -eq 1 ]; then
  echo "▸ optional ML stack (torch + demucs + librosa + mediapipe) — this is a large download"
  "$ROOT/backend/.venv/bin/pip" install --quiet -r "$ROOT/backend/requirements-ml.txt"
fi

echo "▸ studio frontend"
(cd "$ROOT/frontend" && npm install --no-audit --no-fund)

echo
echo "✓ installed"
echo "  start both services:  ./scripts/dev.sh"
echo "  run the test suites:  ./scripts/test.sh"
echo "  studio:  http://localhost:3000   ·   production node: http://localhost:8000/docs"
