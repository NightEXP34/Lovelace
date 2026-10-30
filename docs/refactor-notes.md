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



### B2 — backend pindah ke `server/`

- `git mv`: `noterra/server.py` → `server/server.py`,
  `noterra/metrics_meta.json` → `server/metrics_meta.json`,
  `noterra/snapshot-sample.json` → `server/fixtures/snapshot-sample.json`,
  `noterra/noterra.service` → `server/deploy/noterra.service`,
  `noterra/README.md` → `server/README.md` (lihat catatan B1).
- `server.py`: `SAMPLE = BASE / "fixtures" / "snapshot-sample.json"`;
  `WEB`/`LOGS` tetap `BASE.parent / ...` (repo root). Route `/legacy` dihapus.
- `server/deploy/noterra.service`: `WorkingDirectory` + `ExecStart` ke
  `server/` dan `server/.venv/bin/python`; tidak dijalankan/di-enable.
- Verifikasi in-process: `/` 609 byte, `/api/snapshot` 75 key/2 drive,
  `/api/mock/snapshot` 75 key, `/api/mock/health` 4 alasan,
  `/api/schema` 57 key, `/api/themes` default+minimal,
  `/api/log/sessions` **0** (sama dengan `ls logs | wc -l`).
- `py_compile server/server.py` OK. TestClient tidak tersedia (httpx tidak
  terpasang), jadi route dipanggil langsung sebagai fungsi Python.

### B3 — test pindah ke `tests/`

- `git mv nttest/package.json tests/`, `package-lock.json`, `test-web.mjs`,
  `check-layout.mjs` (file tambahan, lihat B1); `node_modules` dipindah dengan
  satu `mv nttest/node_modules tests/node_modules` (untracked, tidak dihapus).
- Path di test: fixture `../server/fixtures/snapshot-sample.json`, schema
  `../server/metrics_meta.json`; `../web` tetap (kedalaman sama).
- `tests/package.json` scripts test = `node test-web.mjs`; `npm test` ALL PASS.
- `nttest/test.mjs` masih ada (belum dihapus; B4) tetapi `node_modules` sudah
  pindah, jadi jalankan dari `tests/` mulai sekarang.

### B4 — legacy comparator dihapus

`nttest/test.mjs` dihapus setelah semua assertion-nya dipetakan/diport ke
`tests/test-web.mjs`. Assertion lama → cakupan baru:

1. backend live → `backend live setelah fetch pertama`.
2. core cell dinamis → `core cell dinamis dari registry`.
3. P/E dua baris → port `P dan E dipisah dua baris`.
4. stat cards tanpa undefined → assertion sama.
5. core cell GHz 2 desimal → port `core cell render GHz dengan 2 desimal`.
6. clock 0.39–5.5 GHz → port `semua clock di rentang ...`.
7. gauge CPU ring luar+dalam → port `gauge CPU punya ring luar + ring dalam`.
8. tooltip RAPL → `tooltip gauge dari alasan health`.
9. chip throttle 4 slot → assertion sama.
10. chip NVML tidak "—"/tampil "—" → port `chip NVML throttle bits ...`.
11. timeline rail jumlah baris → assertion sama.
12. timeline tanpa undefined → assertion sama.
13. events 6 slot → port `events rail 6 slot`.
14. System rail kernel → assertion sama.
15. hint bottleneck → assertion sama.
16. subtitle GPU RTX → assertion sama.
17. subtitle Memory kernel → port `subtitle Memory = kernel saja`.
18. driver NVIDIA → port `versi NVIDIA driver tampil di panel GPU`.
19. Throttle row nyata → port `Throttle CPU row = nilai sysfs nyata`.
20. PL1/PL2 → port `PL1/PL2 nyata tampil`.
21. readahead KB → port `readahead nyata KB`.
22. not mounted → assertion sama.
23. mounted % → port `drive mounted tampil persen kapasitas nyata`.
24. RAM bandwidth tooltip perf → port `measured RAM bandwidth unavailable + tooltip perf`.
25. alt: tanpa GPU, 3 panel → assertion sama.
26. alt: timeline 5 baris → assertion sama.
27. alt: tabel drive 3 kolom → port `tabel drive dinamis: 3 kolom`.
28. alt: bar Storage 6 → assertion sama.
29. alt: model drive nyata → port `model drive nyata per kolom`.
30. alt: not mounted → assertion sama.
31. alt: tanpa undefined → port `hardware lain: tidak ada 'undefined'`.
32. alt: dd-na → assertion sama.
33. log controls → port `log controls rendered`.
34. empty log → port `empty log state`.
35. recording listed → port `recording session listed`.
36. session persisted → port `session persisted on server`.
37. statistics table → port `statistics table shown`.
38. mean CPU 65.5 → port `mean CPU temp dari CSV server`.
39. CSV export → port `CSV export triggered`.

`noterra/index.html` dan `nttest/test.mjs` dihapus dengan `git rm` (path
eksplisit). Comparator DOM lama-vs-baru (termasuk normalisasi tab Storage)
dihapus dari `tests/test-web.mjs`; tidak ada assertion fungsional yang hilang.

### B5–B9 — prototype, ignore, requirements, docs, sapu akhir

- B5: `noterra/prototype/overview_v6.html` → `docs/prototype/overview_v6.html`.
- B6: `.gitignore` hanya ditambah `.venv/`, `**/.venv/`, `**/node_modules/`;
  baris lama (`noterra/.venv/`, `noterra/.server.log`) tidak dihapus.
- B7: `server/requirements.txt` dari pin venv nyata (fastapi 0.162.0,
  uvicorn 0.54.0, psutil 7.2.2, nvidia-ml-py 13.615.71).
- B8: README root baru; `docs/noterra-architecture.md`, `docs/FORKING.md`,
  `web/THEMES.md`, `docs/agents.md` §8 diperbarui ke `server/`/`tests/`.
  §2 hard rules tidak disentuh. Deviasi §8 dicatat: `server/` dipakai, bukan
  `core/`, karena `web/core/` sudah ada.
- B9: grep akhir tidak menemukan `noterra/`, `nttest`, atau `/legacy` di luar
  catatan historis (`docs/refactor-notes.md`, `changelog/`). Package test
  dinamai `tests`. `docs/blackbox.md` diberi preface bahwa path historis
  disesuaikan ke layout sekarang; isi keputusan tidak diubah.
- File ekstra yang tidak ada di target tree tetapi tidak boleh dihapus:
  `server/README.md` (dari `noterra/README.md`) dan `tests/check-layout.mjs`
  (dari `nttest/check-layout.mjs`). Keduanya ikut dipindah, bukan dihapus.
- `server/README.md` juga diperbaiki `cd server` (sebelumnya `cd noterra`).

### Verifikasi akhir

- `cd tests && npm test` → **ALL PASS**.
- `cd server && ../noterra/.venv/bin/python -m py_compile server.py` → OK.
- In-process: `/` 609 byte, `/api/snapshot` 75 key, `/api/mock/snapshot`
  75 key, `/api/mock/health` 4 alasan, `/api/schema` 57 key, `/api/themes`
  2 theme, `/api/log/sessions` 0 (sama dengan `ls logs | wc -l` = 0).
- `git ls-files` tidak memuat `noterra/` atau `nttest/`; hanya
  `web/index.html` yang tersisa.
- `noterra/` di disk hanya berisi `.venv/` dan `__pycache__/` (tidak
  dipindah/dihapus sesuai aturan); user menghapusnya manual setelah venv baru
  dibuat.

### Follow-up manual untuk pengguna

1. `cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
2. Setelah server baru terverifikasi, hapus sisa `noterra/` (hanya `.venv/`
   dan `__pycache__/`).
3. Review branch `restructure`, lalu push manual.

### Part A — root cause & fix Storage tab

Tiga kandidat dicek:

- (a) **terkonfirmasi** — `dynChart` membangun tombol dengan `tb.prepend(btn)`.
  `C.drives` berurutan `[nvme0n1, nvme1n1]`, tetapi prepend membuat DOM
  `[nvme1n1, nvme0n1]`; handler menyimpan `ti=j` (index drive), sedangkan
  `aria-pressed` dihitung dari posisi DOM `j===ti`.
- (b) sebagian — `ti` lokal tidak di-reset tiap tick, tetapi gauge/stats Storage
  memang hardcode `r0`, jadi panel selalu menampilkan drive 0 walau chart
  memilih drive lain.
- (c) **terkonfirmasi** — active state memakai posisi DOM, click memakai index
  drive; dua kunci berbeda.

Fix: `storageSel` (satu sumber kebenaran), `storageIndex()` (clamp saat jumlah
drive berubah), tab dibangun urut index dengan `insertBefore(btn, legend)`,
`aria-pressed` memakai `data-key` seri, `dynChart` punya `sel`/`onSelect`, dan
gauge/stats/chart membaca `r{k}`/`w{k}`/`i{k}`/`a{k}`/`u{k}` sesuai
`storageIndex()`. Selection bertahan karena variabel modul, termasuk saat
Overview di-remount. Tabel Storage + timeline sudah urut index (tidak diubah).
Regresi `storage: ...` gagal sebelum fix dan lolos sesudahnya.
