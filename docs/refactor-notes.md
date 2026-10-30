# Refactor notes — UI modular (branch `ui-modular`)

Catatan kerja untuk brief modularisasi frontend. Bahasa Indonesia mengikuti
`docs/agents.md` dan `docs/blackbox.md`.

## Phase 0 — orientasi (read-only)

### (a) index.html mana yang diserve server?

`web/index.html`. `noterra/server.py` baris `@app.get("/")` mengembalikan
`(WEB / "index.html")`, dengan `WEB = BASE.parent / "web"`. `noterra/index.html`
hanya diserve di `/legacy` sebagai pembanding UI lama.

### (b) header `samples.csv`

Dari CSV writer (`noterra/server.py`, `log_start` menulis header lewat
`LOG_COLS`, `_record` menulis baris data), baris pertama file adalah:

```
cpu_temp_c,cpu_power_w,gpu_temp_c,gpu_power_w,vram_bw_gbs,pcie_rx_gbs,mem_major_faults_s,drive0_read_mbps
```

Penting: header ini **tidak** memuat `timestamp_ms`, tetapi setiap baris data
diawali timestamp (`p[0]`). `meta.json` justru mendaftarkan `columns` dengan
`timestamp_ms` di depan — jadi parser baru harus memakai nama header dari file
CSV, bukan `meta.columns`, dan memakai offset `i+1` untuk nilai kolom.

### (c) baseline test (sebelum perubahan)

- `cd nttest && node test-web.mjs` → **ALL PASS** (capture 0–5 identik,
  assertion fungsional + simulasi hardware lain lolos).
- `cd nttest && node test.mjs` → **ALL PASS** (UI lama).
- `noterra/.venv/bin/python -m py_compile noterra/server.py` → belum dijalankan
  karena server belum diubah; akan dijalankan setiap kali server disentuh.

### Keputusan kecil (brief §2.7)

- Root `changelog` ternyata **folder kosong** yang tidak di-track git (lihat
  juga `docs/blackbox.md`). Brief meminta append satu baris per sub-task ke
  `changelog`. Untuk menghindari menghapus folder yang sudah ada, catatan
  changelog ditulis di `changelog/ui-modular.md` dengan format satu baris per
  sub-task: `- YYYY-MM-DD — <id> <ringkasan>`. Folder tetap dipertahankan.
- Theme default tetap memakai `overview.js` (`theme.mount`) supaya DOM default
  tidak berubah. `themes/default/layout.json` ditambahkan dan bisa dipilih
  lewat `?layout=layout.json`; ini memenuhi jalur layout tanpa memindahkan
  default ke renderer (precedence: `?layout` > `theme.json.layout` > mount).
  `theme.json.layout` sengaja menang atas `mount` sesuai precedence brief;
  theme default tidak mencantumkan field `layout`, jadi tetap memakai mount.
- `/api/themes` hanya meneruskan field `theme.json` yang relevan (`entry`,
  `css`, `layout`) tanpa menjalankan script theme.

## Status sub-task

(belum ada; diisi sambil jalan)
