# Changelog — restructure (brief #2)

Satu baris per langkah. Format: `- YYYY-MM-DD — <id> <ringkasan>`.

- 2026-10-30 — A1–A2 Storage panel: tab dibangun dengan `prepend` (urutan terbalik) dan `aria-pressed` memakai posisi DOM, bukan index drive; gauge/stats tetap hardcode ke `r0`.
- 2026-10-30 — A3 regresi ditambahkan di `test-web.mjs`; gagal sebelum fix (`storage: urutan tab sesuai index drive`).
- 2026-10-30 — A4 fix: `storageSel` satu sumber kebenaran, tab urut index (`insertBefore`), gauge/stats/chart mengikuti drive terpilih; normalisasi tab khusus di komparator legacy.
- 2026-10-30 — A5 tests hijau (`test-web.mjs` dan `test.mjs` ALL PASS); tabel Storage & timeline sudah urut index.
- 2026-10-30 — B1 inventory path lama, path constants server.py, `ls logs | wc -l` = 0.
- 2026-10-30 — B2 backend pindah ke `server/` (`server.py`, `metrics_meta.json`, `fixtures/snapshot-sample.json`, `deploy/noterra.service`, README); `/legacy` dihapus; route in-process OK.
