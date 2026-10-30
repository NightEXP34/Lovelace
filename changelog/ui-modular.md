# Changelog — refactor UI modular

Satu baris per sub-task. Format: `- YYYY-MM-DD — <id> <ringkasan>`.

- 2026-10-30 — 0.0 Orientasi selesai: server menyerve `web/index.html`; header CSV `cpu_temp_c,...`; baseline `test-web.mjs` dan `test.mjs` ALL PASS.
- 2026-10-30 — 1.1 `Noterra.start()` idempoten; `addTheme` hanya registrasi lalu start (polling tidak lagi dimulai di dalam addTheme).
