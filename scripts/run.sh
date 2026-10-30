#!/usr/bin/env bash
# Jalankan noterra TANPA sudo. RAPL package power tetap unavailable tanpa
# privilege (lihat docs/operations.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PY="${NOTERRA_PYTHON:-$ROOT/server/.venv/bin/python}"
if [ ! -x "$PY" ]; then
  echo "venv belum ada: $PY" >&2
  echo "jalankan: ./scripts/setup.sh" >&2
  exit 1
fi
exec "$PY" -m server.main "$@"
