# Changelog — overhaul arsitektur 2026-10-30

- `server/server.py` dipecah menjadi `server/main.py` (FastAPI + route +
  recording) dan `server/collectors.py` (collector /proc, /sys, NVML +
  `build_snapshot`); `server` menjadi package dengan `__init__.py`.
- `tests/backend/test_api.py` ditambahkan (unittest, tanpa server/port).
- `scripts/{run,setup,check,test}.sh` + `Makefile`; run script tidak memakai
  sudo.
- Dokumentasi dikonsolidasikan ke `docs/`; dokumen lama diarsipkan ke
  `docs/history/`; `web/THEMES.md` → `docs/theming.md`;
  `server/README.md` → `docs/metrics.md`; `docs/prototype` → `docs/history/`.
- `web/core/core.js` (shim tidak terpakai) dihapus; contoh L4 tetap di
  `web/examples/headless.html` agar diserve static mount `web/`.
- README baru, `.gitignore` dirapikan, service unit memakai
  `python -m server.main`.
- Batas akses hardware tanpa sudo didokumentasikan di
  `docs/operations.md`: RAPL `energy_uj` tetap root-only; opsi service dengan
  `CAP_DAC_READ_SEARCH` hanya sebagai setup sekali (tidak dijalankan otomatis).
