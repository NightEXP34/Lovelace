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

Selesai (satu commit per langkah, branch `ui-modular`):

- 1.1 `Noterra.start()` idempoten; `addTheme` registrasi lalu start.
- 1.2 `theme.json` `entry`/`css`; `/api/themes` meneruskan `entry`/`css`/`layout`.
- 1.3 view registry `addView`, nav dinamis, `log` bawaan + bisa dioverride.
- 1.4 objek `DOM` untuk semua id; id wajib didokumentasikan.
- 1.5 `core.css` fallback, dimuat sebelum `theme.css`.
- 1.6 `metrics_meta.json` + `/api/schema` + `/api/mock/schema`.
- 1.7 parser CSV berdasarkan nama header (`HEADER_TO_KEY`, offset timestamp).
- 2.1–2.4 `addWidget`, 4 widget primitif, `renderLayout`, pemilihan layout.
- 2.5 `cpu-panel`, `memory-panel`, `storage-panel`, `gpu-panel`, `rail` +
  `themes/default/layout.json`.
- 3.1 `client.js` (tanpa DOM) + `shell.js` (DOM); `core.js` jadi shim loader;
  `index.html` memuat `core.css` → `client.js` → `widgets.js` → `shell.js`.
- 3.2 `web/examples/headless.html` (tiga nilai live, hanya `client.js`).
- 4.1 `web/themes/minimal/` tanpa JavaScript.
- 4.2 test-web diperluas (widget, layout valid/unknown/JSON invalid, minimal,
  override `log`).
- 4.3 `web/THEMES.md` ditulis ulang untuk L1–L4.
- 4.4 `docs/FORKING.md`.
- 4.5 path basi `docs/noterra-architecture.md` + todo refactor ditandai `[~]`.

### Test

Baseline dan akhir sama: `test-web.mjs` **ALL PASS**, `test.mjs`
**ALL PASS**, `py_compile server.py` OK. `check-layout.mjs` (dev tool) lolos
5 komposit. Route server diverifikasi in-process (`api_schema`, `api_themes`,
`mock_schema`), tanpa menjalankan server/port apa pun.

### Open items / catatan

- `themes/default/layout.json` mereproduksi 4 panel + rail (bukan top chip
  status/hint bottleneck; keduanya masih bagian chrome `overview.js`).
  `?layout=layout.json` sengaja dipakai sebagai jalur demonstrasi, default
  tetap `overview.js` agar DOM default identik.
- Refactor backend `core/` + `adapters/` (collector vs adapter engine/game)
  belum dikerjakan; frontend sudah siap menerima key baru lewat registry/schema.
- `nttest/check-layout.mjs` adalah alat cek cepat tambahan; cakupan utama tetap
  di `test-web.mjs`.
- Root `changelog/` kosong tidak dihapus; entri ada di
  `changelog/ui-modular.md` (keputusan §2.7).
- `noterra/index.html` masih diserve di `/legacy` dan dipakai `test.mjs`
  sebagai pembanding; belum dihapus (menunggu keputusan pengguna).
- Tidak ada server yang dijalankan/dihentikan di sesi ini; tidak ada push.

## Brief #2 — baseline (branch `restructure`)

- `git status` sebelum mulai: bersih, branch `ui-modular`, HEAD `4f55c27`.
- Baseline `cd nttest && node test-web.mjs` → **ALL PASS**.
- Baseline `cd nttest && node test.mjs` → **ALL PASS**.
- Tujuan brief: (A) Storage tab memilih drive yang salah; (B) hapus UI legacy
  dan rapikan folder (`server/`, `tests/`, `docs/prototype/`).

### B1 — inventory sebelum pindah

`git ls-files` (ringkas): `.gitignore`, `changelog/*`, `docs/*`,
`noterra/{README.md,index.html,metrics_meta.json,noterra.service,prototype/overview_v6.html,server.py,snapshot-sample.json}`,
`nttest/{check-layout.mjs,package*.json,test-web.mjs,test.mjs}`, `web/**`.

Referensi path lama yang ditemukan (ringkas): `noterra/server.py` (SAMPLE,
/legacy), `noterra/noterra.service` (ExecStart/WorkingDirectory),
`nttest/*` (fixture, old index, metrics_meta), `docs/FORKING.md`,
`docs/noterra-architecture.md`, `web/THEMES.md`, `noterra/README.md`.
`docs/blackbox.md` dan changelog adalah catatan historis.

Path di `server.py` saat ini:

- `BASE = Path(__file__).resolve().parent` → `noterra/`
- `WEB = BASE.parent / "web"` → repo/web
- `LOGS = BASE.parent / "logs"` → repo/logs
- `SAMPLE = BASE / "snapshot-sample.json"` → akan jadi `BASE / "fixtures" / ...`
- `SCHEMA = BASE / "metrics_meta.json"` → tetap di root `server/`
- `GET /` membaca `WEB/index.html`; `/legacy` membaca `BASE/index.html`.

Karena `server/` berada di kedalaman yang sama dengan `noterra/`,
`BASE.parent` tetap repo root — dikonfirmasi dari kode, bukan asumsi.

`ls logs | wc -l` = **0** (tidak ada sesi terekam). Jadi cek sesi setelah
pindah harus mengembalikan 0 (selain entri non-sesi kalau ada).

Catatan keputusan: `noterra/README.md` dan `nttest/check-layout.mjs` tidak
disebut di target layout dan tidak boleh dihapus, jadi ikut dipindah ke
`server/README.md` dan `tests/check-layout.mjs` (bukan penghapusan).


