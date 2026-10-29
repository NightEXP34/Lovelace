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
