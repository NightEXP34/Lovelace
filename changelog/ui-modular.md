# Changelog — refactor UI modular

Satu baris per sub-task. Format: `- YYYY-MM-DD — <id> <ringkasan>`.

- 2026-10-30 — 0.0 Orientasi selesai: server menyerve `web/index.html`; header CSV `cpu_temp_c,...`; baseline `test-web.mjs` dan `test.mjs` ALL PASS.
- 2026-10-30 — 1.1 `Noterra.start()` idempoten; `addTheme` hanya registrasi lalu start (polling tidak lagi dimulai di dalam addTheme).
- 2026-10-30 — 1.2 `theme.json` boleh punya `entry`/`css`; `/api/themes` meneruskan `entry`, `css`, `layout` (default `overview.js`/`theme.css`).
- 2026-10-30 — 1.3 registry view `Noterra.addView(id,{label,mount,update?})`; nav dibangun dari view (Overview order 0, Log order 10); theme boleh override `log`.
- 2026-10-30 — 1.4 semua id core dikumpulkan di objek `DOM`; id wajib `index.html` didokumentasikan di THEMES.md.
