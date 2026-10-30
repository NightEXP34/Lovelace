# Changelog — restructure (brief #2)

Satu baris per langkah. Format: `- YYYY-MM-DD — <id> <ringkasan>`.

- 2026-10-30 — A1–A2 Storage panel: tab dibangun dengan `prepend` (urutan terbalik) dan `aria-pressed` memakai posisi DOM, bukan index drive; gauge/stats tetap hardcode ke `r0`.
- 2026-10-30 — A3 regresi ditambahkan di `test-web.mjs`; gagal sebelum fix (`storage: urutan tab sesuai index drive`).
- 2026-10-30 — A4 fix: `storageSel` satu sumber kebenaran, tab urut index (`insertBefore`), gauge/stats/chart mengikuti drive terpilih; normalisasi tab khusus di komparator legacy.
- 2026-10-30 — A5 tests hijau (`test-web.mjs` dan `test.mjs` ALL PASS); tabel Storage & timeline sudah urut index.
- 2026-10-30 — B1 inventory path lama, path constants server.py, `ls logs | wc -l` = 0.
- 2026-10-30 — B2 backend pindah ke `server/` (`server.py`, `metrics_meta.json`, `fixtures/snapshot-sample.json`, `deploy/noterra.service`, README); `/legacy` dihapus; route in-process OK.
- 2026-10-30 — B3 `nttest/` → `tests/` (git mv package*.json, test-web.mjs, check-layout.mjs; `mv node_modules`); path fixture/schema diperbarui; `npm test` hijau.
- 2026-10-30 — B4 assertion `test.mjs` dipetakan/diport ke `tests/test-web.mjs`; `git rm nttest/test.mjs` + `git rm noterra/index.html`; komparator lama dihapus; test hijau.
- 2026-10-30 — B5 prototype `overview_v6.html` pindah ke `docs/prototype/`.
- 2026-10-30 — B6 `.gitignore` hanya menambah `.venv/`, `**/.venv/`, `**/node_modules/` (baris lama tidak dihapus).
- 2026-10-30 — B7 `server/requirements.txt` dari pin venv nyata: fastapi 0.162.0, uvicorn 0.54.0, psutil 7.2.2, nvidia-ml-py 13.615.71.
- 2026-10-30 — B8a `README.md` root: ringkasan, peta folder, cara run (`server/.venv`), test (`tests/npm test`), link fork.
- 2026-10-30 — B8b `docs/noterra-architecture.md`: tree server/tests/docs-prototype, service path, todo refactor (folder selesai; modul/adapters terbuka).
- 2026-10-30 — B8c `docs/FORKING.md`: run dari `server/`, fixture/schema baru, tes `cd tests && npm test`.
- 2026-10-30 — B8d `web/THEMES.md`: schema `server/metrics_meta.json`, fixture server, test `tests/`.
- 2026-10-30 — B8e `docs/agents.md` §8 (bukan §2): struktur perSOna/server/web/tests + catatan deviasi dari monitor/core.
- 2026-10-30 — B9a package test dinamai `tests` (package.json + lock) agar tidak ada referensi `nttest`.
- 2026-10-30 — B8f docs lain (arsitektur, FORKING, THEMES, agents §8) selesai; B9 grep bersih, package `tests`, blackbox diberi preface path historis.
- 2026-10-30 — verifikasi akhir: `npm test` ALL PASS, py_compile OK, 7 route in-process OK, logs 0, tidak ada path tracked `noterra/`/`nttest/`.
- 2026-10-30 — catatan root cause Part A (a+c, b sebagian) dan detail fix di `docs/refactor-notes.md`.
