# Lovelace — noterra

Monitor hardware lokal (localhost) untuk mesin ini: backend FastAPI membaca
`/proc`, `/sys`, dan NVML; frontend vanilla-JS menampilkan Overview + tab Log.
Data yang tidak tersedia tetap `null` dan ditampilkan `unavailable` dengan
alasan — tidak ada angka karangan.

## Peta folder

```
perSOna/
├── README.md
├── .gitignore
├── server/
│   ├── server.py              # FastAPI + collector (port 5130)
│   ├── metrics_meta.json      # schema metrik (label/satuan/sumber)
│   ├── requirements.txt
│   ├── README.md              # catatan backend (sumber metrik, unavailable)
│   ├── fixtures/
│   │   └── snapshot-sample.json
│   └── deploy/
│       └── noterra.service    # contoh unit systemd (tidak dijalankan di sini)
├── web/
│   ├── index.html             # shell UI
│   ├── core/                  # client.js, widgets.js, shell.js, core.css
│   ├── themes/                # default (L3) + minimal (L2, tanpa JS)
│   ├── examples/headless.html # contoh L4
│   └── THEMES.md
├── tests/
│   ├── package.json
│   ├── test-web.mjs
│   └── check-layout.mjs       # cek cepat widget komposit
├── docs/
│   ├── agents.md
│   ├── blackbox.md
│   ├── noterra-architecture.md
│   ├── FORKING.md
│   ├── refactor-notes.md
│   └── prototype/overview_v6.html
├── logs/                      # sesi rekaman (tidak diubah)
└── changelog/
```

`noterra/` sudah dihapus; nama produk "Noterra" tetap dipakai di UI/namespace
(`window.Noterra`), hanya folder lama yang hilang.

## Menjalankan

Venv harus dibuat di `server/.venv` (lihat `server/requirements.txt`):

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py          # http://127.0.0.1:5130
```

Mode mock (tanpa hardware): buka `http://127.0.0.1:5130/?mock=1`.
Diagnosis sumber metrik: `.venv/bin/python server.py --check`.

## Test

```bash
cd tests
npm test                 # node test-web.mjs (jsdom, fetch di-stub)
node check-layout.mjs cpu-panel memory-panel storage-panel gpu-panel rail
```

Tidak perlu `npm install` lagi jika `tests/node_modules` ada. Test tidak
menjalankan server dan tidak menyentuh hardware.

## Fork UI

Mulai dari `web/themes/minimal/` (L2, tanpa JavaScript), edit `layout.json`.
Panduan lengkap: [docs/FORKING.md](docs/FORKING.md); kontrak L1–L4:
[web/THEMES.md](web/THEMES.md).
