# Changelog — refactor UI modular

Satu baris per sub-task. Format: `- YYYY-MM-DD — <id> <ringkasan>`.

- 2026-10-30 — 0.0 Orientasi selesai: server menyerve `web/index.html`; header CSV `cpu_temp_c,...`; baseline `test-web.mjs` dan `test.mjs` ALL PASS.
- 2026-10-30 — 1.1 `Noterra.start()` idempoten; `addTheme` hanya registrasi lalu start (polling tidak lagi dimulai di dalam addTheme).
- 2026-10-30 — 1.2 `theme.json` boleh punya `entry`/`css`; `/api/themes` meneruskan `entry`, `css`, `layout` (default `overview.js`/`theme.css`).
- 2026-10-30 — 1.3 registry view `Noterra.addView(id,{label,mount,update?})`; nav dibangun dari view (Overview order 0, Log order 10); theme boleh override `log`.
- 2026-10-30 — 1.4 semua id core dikumpulkan di objek `DOM`; id wajib `index.html` didokumentasikan di THEMES.md.
- 2026-10-30 — 1.5 `web/core/core.css` fallback netral (kelas Log + token warna) dimuat sebelum theme.css; daftar kelas didokumentasikan.
- 2026-10-30 — 1.6 `META` pindah ke `noterra/metrics_meta.json`; route `/api/schema` + `/api/mock/schema`; core fetch schema sebelum theme; stub test diperbarui.
- 2026-10-30 — 1.7 parser CSV tab Log memakai nama header (`HEADER_TO_KEY`/key registry, offset timestamp), daftar metrik fallback lama dipertahankan.
- 2026-10-30 — 2.1–2.4 registry widget `addWidget`, 4 widget primitif (value/bar/sparkline/gauge), `renderLayout` grid + placeholder/error, pemilihan `?layout` > theme.json.layout (tanpa mount) > mount; theme tanpa script memakai layout.json.
- 2026-10-30 — 2.5a `cpu-panel` jadi widget komposit; cek layout lolos, test default tetap identik.
- 2026-10-30 — 2.5b `memory-panel` jadi widget komposit; cek layout + test hijau.
- 2026-10-30 — 2.5c `storage-panel` jadi widget komposit; cek layout + test hijau.
