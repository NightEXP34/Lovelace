#!/usr/bin/env bash
# Test frontend jsdom + backend unittest + py_compile.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${NOTERRA_PYTHON:-$ROOT/server/.venv/bin/python}"
cd "$ROOT"
"$PY" -m py_compile server/main.py server/collectors.py
"$PY" -m unittest discover -s tests/backend -v
cd "$ROOT/tests"
if [ ! -d node_modules ]; then
  echo "tests/node_modules belum ada; jalankan ./scripts/setup.sh" >&2
  exit 1
fi
npm test
