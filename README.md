# Lovelace — noterra

Monitor hardware lokal (localhost): backend FastAPI membaca `/proc`, `/sys`,
dan NVML; frontend vanilla-JS menampilkan Overview + tab Log. Data yang tidak
tersedia tetap `null` dan ditampilkan `unavailable` dengan alasan — tidak ada
angka karangan.

## Peta folder

```
perSOna/
├── README.md
├── Makefile
├── scripts/                 # run/check/test/setup (tanpa sudo)
├── server/
│   ├── main.py              # FastAPI app, route API, recording
│   ├── collectors.py        # collector /proc, /sys, NVML + build_snapshot
│   ├── metrics_meta.json    # schema metrik (label/satuan/sumber)
│   ├── requirements.txt
│   ├── fixtures/snapshot-sample.json
│   └── deploy/noterra.service   # contoh unit systemd (tidak dijalankan otomatis)
├── web/
│   ├── index.html           # shell UI
│   ├── core/                # client.js, widgets.js, shell.js, core.css
│   ├── themes/              # default (L3), minimal (L2 tanpa JS)
│   └── examples/headless.html   # contoh L4
├── tests/
│   ├── test-web.mjs         # jsdom frontend
│   ├── check-layout.mjs     # cek cepat widget komposit
│   └── backend/             # unittest route API
├── docs/
│   ├── architecture.md
│   ├── theming.md           # kontrak L1–L4
│   ├── forking.md
│   ├── operations.md        # run, test, batas privilege
│   ├── metrics.md           # sumber tiap metrik
│   ├── agents.md
│   └── history/             # arsip catatan/changelog/prototype lama
└── logs/                    # sesi rekaman (runtime)
```

## Menjalankan (tanpa sudo)

```bash
./scripts/setup.sh      # sekali: venv server/.venv + dependency
./scripts/run.sh        # http://127.0.0.1:5130
```

Mode mock tanpa hardware: `http://127.0.0.1:5130/?mock=1`.
Diagnosis sumber metrik tanpa server/port: `./scripts/check.sh`.
Hentikan dengan Ctrl+C di terminal yang menjalankan.

### Akses hardware tanpa sudo

Berjalan tanpa sudo untuk semua metrik yang bisa dibaca user: CPU
temp/freq/util, memory, storage, NVMe, dan GPU (NVML). **Daya package CPU
(RAPL `energy_uj`) tidak bisa dibaca tanpa privilege**; `cpuW` akan
`unavailable`. Itu batas kernel, bukan bug. Untuk akses penuh perlu satu kali
setup service system dengan `CAP_DAC_READ_SEARCH` (unit disediakan, tidak
di-enable otomatis). Detail dan trade-off: [docs/operations.md](docs/operations.md).

## Test

```bash
./scripts/test.sh       # py_compile + backend unittest + frontend jsdom
```

Atau manual:

```bash
cd tests
npm test
node check-layout.mjs cpu-panel memory-panel storage-panel gpu-panel rail
```

Test tidak menyalakan server dan tidak menyentuh hardware.

## Fork UI

Mulai dari `web/themes/minimal/` (L2, tanpa JavaScript), edit `layout.json`.
Untuk Overview benar-benar baru, buat `overview.js` (L3). Kontrak lengkap:
[docs/theming.md](docs/theming.md); panduan langkah demi langkah:
[docs/forking.md](docs/forking.md).

## Dokumentasi

- [Arsitektur](docs/architecture.md)
- [Theming L1–L4](docs/theming.md)
- [Forking](docs/forking.md)
- [Operations & privilege](docs/operations.md)
- [Sumber metrik](docs/metrics.md)
- [Catatan historis](docs/history/)
