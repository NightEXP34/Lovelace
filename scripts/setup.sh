#!/usr/bin/env bash
# Setup dependencies TANPA sudo (butuh jaringan untuk pip/npm).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/server"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -r requirements.txt
if [ ! -d "$ROOT/tests/node_modules" ]; then
  cd "$ROOT/tests"
  npm ci
fi
echo "setup selesai: ./scripts/run.sh"
