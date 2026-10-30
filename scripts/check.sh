#!/usr/bin/env bash
# Diagnosis sumber metrik tanpa menjalankan server/port.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/scripts/run.sh" --check
