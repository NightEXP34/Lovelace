# blackbox.md — catatan kerja yang sudah dilakukan

Rekam jejak kerja agent di repo Lovelace (folder lokal `perSOna`).
Format: kronologis, apa yang dikerjakan + hasil nyata.

## 2026-10-29 — Pemahaman repository (sesi awal)

- Inspeksi penuh: `agents.md` (162 baris spesifikasi UAS), `noterra/index.html`
  (prototype UI "Monitor" dengan mock data), `changelog/` (kosong, tidak
  di-track), riwayat git (4 commit, semua hari itu), remote
  `NightEXP34/Lovelace`.
- Kesimpulan dilaporkan ke pengguna: proyek = tuning OS spesifik-hardware untuk
  inference LLM lokal di laptop RTX 4060 Mobile; repo berisi spesifikasi +
  prototype UI saja; backend belum ada.

## 2026-10-29 — Keputusan pengguna

- Nama repo resmi **Lovelace** (beda dari nama folder = sengaja, keputusan
  pengguna).
- Tugas: fokus di `noterra/`, tambahkan backend ke resource asli, install
  dependencies, sambungkan semua placeholder ke status hardware nyata.

## 2026-10-29 — Survei sumber data di mesin (sebelum ngoding)

- Konfirmasi mesin nyata: i7-13620H, RTX 4060 Laptop (AD107M), driver NVIDIA
  open 595.99.02 loaded, kernel 7.0.0-38-generic.
- Topologi nyata dari `/proc/cpuinfo`: 16 logical CPU = 12 thread P-core
  (6 fisik) + 4 E-core online (bukan 8 seperti spesifikasi — kernel
  melaporkan begitu; dipakai apa adanya).
- Klasifikasi P/E via `scaling_max_freq` (P ≥4.7GHz, E 3.6GHz).
- Sumber terkonfirmasi: hwmon `coretemp` (package + per core), hwmon `nvme`
  x2 dengan symlink ke nvme0/nvme1, RAPL `intel-rapl:0` (mode 0400, butuh
  root), cpuidle hanya POLL/C1/C2/C3_ACPI (tidak ada C6 sysfs),
  `/proc/schedstat` format baru (counter pertama, nilai ns di belakang),
  PCI sysfs punya `current_link_speed/max_link_speed/width`.
- Temuan penting: sandbox harness tidak melihat `/dev/nvidia*` → NVML gagal
  di sesi ini; di host normal NVML bekerja tanpa root.
- Fakta link nyata: GPU Gen4 x8; NVMe0 WD SN540 Gen3 x4; NVMe1 ZHITAI Gen3 x4.

## 2026-10-29 — Dependencies

- `noterra/.venv` dibuat (Python 3.14.4): fastapi 0.162, uvicorn, psutil 7.2.2,
  `pynvml` → diganti ke paket resmi `nvidia-ml-py` (pynvml deprecated).
- `nttest/`: jsdom untuk smoke test headless (di-gitignore untuk node_modules).

## 2026-10-29 — Backend `noterra/server.py`

- Ditulis: FastAPI, endpoint `GET /` (UI) + `GET /api/snapshot`.
- Collector: /proc/stat per-core busy, /proc/interrupts, /proc/schedstat
  (push+pull, dengan sanitasi format), /proc/vmstat (pgfault/pgmajfault/
  pswpin/pswpout), /proc/meminfo, diskstats per nvme (r/w/iops/await/util/
  queue), hwmon suhu per core fisik, RAPL daya package (delta µJ/s + wrap),
  cpuidle state terdalam (% + nama dinamis), cpufreq cur/max, PCI link
  (walk ke parent PCI), scheduler aktif `[x]`, mount→capacity via psutil,
  NVML GPU penuh (temp/power/clocks/util/VRAM/limit/P-state/throttle/fan/
  link) dengan fallback sysfs PCI, snapshot konfigurasi sistem lengkap.
- Bug yang ditemukan & diperbaiki selama iterasi uji nyata:
  1. `UnboundLocalError` `_last_t` (assign tanpa `global`).
  2. `IndexError` baris `/proc/stat` dengan jumlah field < 10 → guard steal.
  3. Baris agregat `cpu` menimpa cpu0 di dict per-core → agregat di-skip.
  4. `int()` gagal pada label non-numerik `/proc/interrupts` → filter digit.
  5. Ternary short-circuit membuat delta disk selalu `None` → rate dipanggil
     dulu baru dikonversi.
  6. Panggangan dua kali `rate(io_ms)` → util disk 0 terus → dipanggil sekali.
  7. Path PCI NVMe salah (`device` symlink → controller) → walk parent sampai
     nama alamat PCI.
  8. Scheduler `[none] mq-deadline` → parsing nilai aktif.
- Uji nyata: dua snapshot dengan jeda + beban I/O nyata (`find ... -exec cat`):
  major fault naik ~326/s, NVMe0 read ~22.4 MB/s, util 19%, ctx naik —
  respons metrik benar terhadap beban.

## 2026-10-29 — Frontend `noterra/index.html` disambungkan ke API

- Sampler mock dihapus; fetch `/api/snapshot` tiap 1s; status backend
  live/offline di footer; ring buffer 60 sampel untuk sparkline.
- Bar P/E dinamis dari array snapshot (6 P + 4 E sesuai kernel).
- Semua placeholder diganti nilai nyata: governor/EPP/turbo/driver/pinning,
  idle residency dengan nama state asli (C3_ACPI), link GPU/NVMe dari sysfs,
  VRAM/NVMe model, kapasitas via mount, scheduler per drive.
- Metrik tanpa sumber → `unavailable` (PL1/PL2, PCIe rx/tx, VRAM bandwidth,
  throttle CPU, fan, readahead, measured bandwidth).
- Tab Log: sesi seed palsu dihapus; recording menarik snapshot asli tiap
  interval; statistik/overlay/diff konfigurasi/CSV filter null.
- Bug yang ditemukan & diperbaiki: handler delete pakai var salah (`c`→`b`),
  `overlay` index interval salah, sisa ekspresi di `st()`, markup header tabel
  diff, deklarasi `cur` duplikat, array PANELS CPU kurang penutup, subtitle
  di-refresh via `refreshSubs()`, `arrs` block-scope di renderLog → hoist.
- JS lolos `node --check` dan smoke test jsdom: **ALL PASS** (11 assertion:
  live, bar dinamis, nilai snap nyata, sparkline, unavailable jujur, subtitle
  nyata, log kosong, sesi tersimpan, statistik, CSV trigger).

## 2026-10-29 — Rapikan + commit + push

- `.gitignore` (.venv, node_modules, server.log, __pycache__), README noterra
  (tabel sumber metrik + daftar unavailable + catatan mesin), fixture
  `noterra/snapshot-sample.json` dari snapshot nyata.
- Commit `691b106` "noterra: wire monitor UI to real hardware backend"
  (7 file, +782/−77) → **push ke origin/main berhasil**.

## 2026-10-29 — Dokumentasi (tugas terakhir ini)

- Folder `docs/` dibuat; `agents.md` dipindah ke `docs/agents.md`
  (murni dokumentasi, isi tidak diubah).
- `docs/noterra-architecture.md`: arsitektur backend/UI + alur data +
  desain kunci + endpoint + todolist.
- `docs/blackbox.md`: file ini.

## 2026-10-30 — Bug fix A (satu commit per langkah, semua di-push)

- `ea5a7bb` cpufreq: sumber kHz, selama ini dilabel MHz → dikonversi ke GHz
  (`kHz/1e6`); assertion smoke test: semua clock 0.39–5.5 GHz (nilai nyata
  terendah 0.3998 GHz dari scaling_min_freq, bukan angka karangan).
- `c24a1c6` satuan: VRAM NVML bytes → GiB (label GiB), RAM kB → GiB, disk tetap
  GB desimal; nilai nyata VRAM 7.92/7.996 GiB.
- `3a8f3df` IOPS: `<small>undefined</small>` → label "IOPS"; await nol I/O →
  "idle" (bukan unavailable).
- `dbf3dda` subtitle GPU dari `nvmlDeviceGetName` ("NVIDIA GeForce RTX 4060
  Laptop GPU"); versi driver NVIDIA pindah ke panel GPU, subtitle Memory hanya
  kernel.
- `49a5969` `/api/health` (alasan per key) + `server.py --check`; unavailable di
  kartu besar tampil kecil/redup tanpa satuan + tooltip alasan dari health.

## 2026-10-30 — Insiden proses + aturan baru

- Insiden: perintah `pgrep -f "[s]erver\.py" | while read p; do kill $p; done`
  ikut membunuh proses Strata (pattern cocok ke command line-nya). Strata
  kemudian dijalankan ulang oleh pengguna. `pkill -f "noterra/server.py"` juga
  pernah mematikan shell harness (SIGTERM).
- Aturan proses yang berlaku sekarang (disepakati pengguna):
  DILARANG `pkill -f`, `pgrep -f | kill`, `killall`, kill berbasis pola nama.
  Server noterra dijalankan dengan PID file `noterra/.pid`; berhenti hanya via
  `kill "$(cat .pid)"` setelah `ps -o pid,args -p <pid>` membuktikan itu proses
  yang saya start. Proses strata/llama/nvidia tidak pernah disentuh.
  Kalau koneksi model/harness putus: berhenti dan tunggu, tidak menebak.
- Catatan pemutusan: sesi harness keluar di tengah langkah C; server mati
  (listener 5130 kosong), verifikasi dulu kondisi sebelum lanjut.

## 2026-10-30 — Isi metrik B (hasil nyata)

- `dfd7851` PL1/PL2/peak dari `constraint_*_power_limit_uw` (terbaca tanpa
  root): nyata 200 / 115 / 230 W. Daya package (`energy_uj` mode 0400) tetap
  unavailable; keputusan OS: **tidak chmod world-readable** (kernel menolak
  sejak PLATYPUS; expose energy_uj ke user = bocor informasi power telemetry);
  jalur yang diusulkan = systemd `AmbientCapabilities=CAP_DAC_READ_SEARCH`
  (`noterra/noterra.service` disiapkan, belum dijalankan — sudo diblokir di
  sesi harness). Server tetap bind 127.0.0.1.
- `ff8f072` throttle CPU dari sysfs `thermal_throttle/*_throttle_count`
  (delta/s, sibling dedup); nilai awal nyata: core 1155, package 40240 count
  kumulatif; pembanding `turbostat --quiet --no-msr --no-perf sleep 1`
  bekerja tanpa root (kolom CoreThr).
- `03a0925` migration thread: `/proc/schedstat` selalu 0 di kernel ini (sumber
  mati) → diganti `/proc/<pid>/task/<tid>/sched` `se.nr_migrations`; overhead
  terukur ~15 ms/snapshot (1273 thread file); terbukti naik saat beban
  (4 thread × ganti affinity → delta 1116). `perf -a cpu-migrations` diblokir
  `kernel.perf_event_paranoid=4` (tidak diubah; itu parameter tuning).
- `8310d79` GPU NVML penuh: power limit aktif NotSupported → default limit
  NVML 70 W (ditandai "(default)" di UI); P-state nyata (P0/P4 berubah saat
  beban); throttle reasons NVML nyata (bits 0 saat idle, mask 511); fan
  NotSupported (kipas laptop diatur EC); PCIe link now/max nyata Gen4 x8;
  rx/tx dari `nvmlDeviceGetPcieThroughput` (KB/s → GB/s); bus width 128 bit;
  peak VRAM = estimasi berlabel: 128/8 × 8001 MHz × 2 (DDR) ≈ 256 GB/s;
  theoretical PCIe dari link max ≈ 15.75 GB/s (link sekarang Gen2 saat idle
  itu normal, ditampilkan terpisah).
- `458cbf7` readahead NVMe: path benar `queue/read_ahead_kb` (nyata 128 KB;
  kode lama memakai `queue/readahead_kb` yang tidak ada); drive tanpa mount →
  "not mounted" (nvme0 belum di-mount); bandwidth RAM terukur: PMU
  `uncore_imc_free_running_{0,1}` ADA (unit MiB, scale 6.1035e-5 MiB = 64 B
  per count) tapi perf diblokir paranoid=4 tanpa root → unavailable dengan
  alasan; jalur pengukuran hanya aktif kalau perf diizinkan (belum bisa
  diverifikasi di sesi ini). Tidak ada tool baru yang diinstall (perf,
  turbostat sudah ada; disk root 91% penuh jadi tidak menambah paket).
- `50ba5ea` persistensi log server-side: `logs/<tanggal>_<label>/samples.csv`
  + `meta.json`; endpoint start/stop/marker/sessions/csv/delete; UI Log tab
  baca dari API (bukan memori browser). Nilai unavailable ditulis kosong di
  CSV (tidak dikarang angka), bukan 0.
- `d1e8f2c` meta.json schema v1: `schema_version`, `interval_s`, snapshot
  konfigurasi saat sesi mulai (governor/EPP/turbo/power limits/sysctl/
  kernel cmdline/driver/`gpuClockLock:null`/`strata:null`), marker dengan
  note, kolom CSV. Diff konfigurasi sesi di UI memakai meta.config.

## 2026-10-30 — Verifikasi langkah C (setelah harness mati, kondisi dicek ulang)

- `git status` bersih setelah commit; server restart via PID protocol
  (PID lama 14833 sudah mati saat harness exit, tidak di-kill).
- Endpoint log diuji nyata: start → 19 samples → marker ber-note → stop →
  meta.json schema v1 terbaca → **restart server** → sesi tetap terdaftar dari
  disk + CSV terbaca → DELETE menghapus folder. `logs/` kini kosong (sesi uji
  dihapus).
- `server.py --check`: 71 key metrik; terakhir 60 available, 11 unavailable
  (sebelum langkah GPU; setelah GPU + PL1 tersisa: cpuW (RAPL root), fan,
  ramBW).
- Smoke test jsdom: ALL PASS (termasuk render "not mounted", readahead KB,
  tooltip RAPL, session persisted dari server, mean dari CSV server).

## 2026-10-30 — Langkah 3 belum dikerjakan

- `noterra/prototype/overview_v6.html` belum ada di repo → sesuai aturan,
  berhenti dan minta pengguna menaruh file prototype sebelum porting layout.
