# AGENTS.md — Project UAS Sistem Operasi: Hardware-Specific Tuning + Monitoring App

Dokumen ini adalah konteks utama untuk agent lokal. Baca seluruhnya sebelum mengubah apa pun.

## 1. Tujuan

Tuning Ubuntu 26.04 LTS yang khusus untuk satu mesin (bukan distro umum) agar inference LLM lokal (Strata + Qwen3.8 Flash Next) berjalan semaksimal mungkin, dengan suhu dan daya terkendali. Hasil akhir **tidak harus berupa ISO**: dosen mengizinkan tuning pada hardware sendiri. Deliverable utama adalah:

1. **Webapp monitoring** (localhost) sebagai alat ukur dan fondasi keputusan tweak.
2. **Dokumentasi tweak level OS** (apa yang diubah, kenapa, bukti sebelum/sesudah).

Ini tugas UAS Sistem Operasi (solo), tugas terakhir semester.

## 2. Aturan keras

1. **Relevansi OS wajib.** Setiap tweak harus bisa dijelaskan dengan konsep OS (penjadwalan, manajemen memori/paging, I/O, power management/DVFS, interupsi, cgroup/isolasi). Dilarang sekadar mengganti config lalu mengklaim selesai.
2. **Bukti sebelum dan sesudah.** Tidak ada tweak tanpa log baseline dan log setelah tweak (A/B, minimal 3 run per kondisi).
3. **Setiap perubahan di-push ke GitHub** (dosen memantau progres lewat commit). Commit kecil, pesan jelas.
4. **Jangan mengarang data.** Metrik yang tidak tersedia ditampilkan sebagai `unavailable`, bukan angka tebakan.
5. **Jangan jalankan perintah yang mengubah sistem tanpa konfirmasi pengguna** (sysctl, governor, power limit, clock lock, kernel param, cgroup). Usulkan perintah dan rollback-nya, tunggu persetujuan.
6. **Setiap tweak yang diterapkan wajib dicatat** di repo dokumentasi (lihat bagian 8).

## 3. Pembagian kerja

- **Claude (chat):** prototype UI/UX webapp dan konsep.
- **Agent lokal (kamu):** logic, collector, penyimpanan log, API, integrasi Strata, perbandingan log, penerapan UI prototype ke data nyata.
- **Pengguna (Candra):** menjalankan tes di mesin, menyetujui tweak, push ke GitHub.

## 4. Mesin dan lingkungan (fakta dari pengguna)

- Laptop: Colorful EVOL P15 23 (Black), i7-13620H (Raptor Lake: P-core + E-core), RTX 4060 Mobile 8GB (Ada Lovelace)
- RAM 2x16GB DDR5 5200MHz
- Storage: WD PC SN540 512GB (root, ~94% penuh), ZHITAI TiPlus5000 1TB; swapfile 8GB
- OS: Ubuntu 26.04.1 LTS, kernel 7.0.0-38, NVIDIA driver 595.99.02
- Catatan termal: hanya 3 heatpipe, bottleneck ada di transport panas. Sebelumnya CPU turbo dimatikan dan GPU di-lock 2330MHz@850mV sebagai kompensasi
- PCIe GPU: 4.0 x8 (jadi faktor saat cold run)
- Engine: Strata 0.2.3.1 (build 0.1.48.1), mode low-RAM (mmap-experts)
- Model: Swift 1.5 IQ2_XS (Qwen3.8-Flash-Next GGUF)
- Perintah launch baseline:
  `strata launch --model iq2_xs --family swift --context 128k --vision cpu --parallel 1 --tune quick --access lan --port 5128`
- Folder kerja: `~/so-uas/logs/baseline`

## 5. Baseline lama (referensi, bukan hasil app)

- Prefill: cold ~50 tok/s, warm ~170 tok/s
- Decode: cold ~10 tok/s, warm 30–40 tok/s
- GPU 74–79°C, daya 50–60W, tidak pernah tembus 70W (diduga karena MoE)
- Cold run lambat karena page-in: VRAM (via PCIe) dan NVMe aktif >1 GB/s memindahkan expert; saat warm keduanya turun dan tok/s naik stabil
- Protokol tes: `drop_caches` → jalankan Strata → kirim prompt harness (cold) → kirim prompt sama dari workspace lain setelah read selesai (warm)
- Generate proyek voxel sederhana di harness memakan ~1,5 jam (effort low), jadi tidak praktis untuk benchmark berulang. Gunakan prompt/workload yang lebih pendek dan terstandar untuk A/B.

## 6. Webapp monitoring — spesifikasi

Berjalan di localhost. GUI minimalis, bersih, padat informasi. Referensi gaya: tab Monitor di engine Strata. Repo terpisah dan netral (teman akan fork untuk optimisasi game, jadi **jangan hardcode** Strata/LLM di core; buat sebagai plugin/adapter).

### 6.1 Metrik hardware (sampling ~1 detik, interval bisa diatur)

- **CPU:** frekuensi, suhu, utilisasi per core (kelompokkan P vs E), daya RAPL, C-state residency, alasan throttle
- **GPU:** suhu, daya, SM clock, mem clock, utilisasi, VRAM, throttle reasons (nvidia-smi / NVML), link PCIe gen/width
- **PCIe:** throughput rx/tx
- **NVMe:** MB/s baca/tulis, await, utilisasi, suhu, sisa kapasitas per disk
- **Memori:** RAM, page cache, swap, major/minor page fault
- **Kernel view:** context switch, migrasi thread, IRQ per core
- **Sistem:** governor/EPP aktif, status turbo, power limit, kernel version, driver version

### 6.2 Metrik engine (adapter Strata)

- Baca API Strata (tok/s prefill dan decode, slot, model termuat). Strata menyediakan HTTP API dan tab Monitor sendiri; **periksa dokumentasi Strata untuk endpoint yang benar**, jangan menebak.
- Jika API tidak menyediakan sebuah metrik, tandai `unavailable`.

### 6.3 Log dan analisis

- **Rekam sesi** dengan label: nama konfigurasi, cold/warm, catatan bebas.
- **Snapshot konfigurasi** otomatis saat sesi mulai: governor, EPP, turbo, power limit, clock lock GPU, sysctl terkait, kernel param, versi kernel/driver/Strata, argumen launch.
- **Bandingkan sesi:** overlay grafik A/B, selisih konfigurasi (diff snapshot).
- **Statistik:** rata-rata, median, p95, standar deviasi, agregasi dari beberapa run.
- **Metrik turunan:** tok/s per watt, joule per token, waktu hingga warm, waktu di atas batas suhu.
- **Deteksi bottleneck (rule-based, transparan):** misalnya PCIe/NVMe jenuh dengan GPU idle → page-bound; suhu mendekati batas dengan clock turun → thermal-bound. Tampilkan aturan yang terpicu, bukan hanya kesimpulan.
- **Tab hipotesis:** tulis hipotesis → pilih tweak → jalankan A/B → tampilkan hasil. Ekspor sebagai bahan laporan.
- **Ekspor:** CSV/JSON ke folder log di repo.

### 6.4 Usulan teknis (terbuka, boleh diubah dengan alasan)

- Backend Python (FastAPI), `psutil`, `pynvml`, pembacaan `/proc` dan `/sys`, `turbostat`/`perf` bila tersedia
- Penyimpanan SQLite
- Frontend ringan (grafik time-series seperti uPlot), tanpa framework berat
- Dependensi minimal; tujuan utama: overhead monitoring rendah, karena app berjalan bersamaan dengan inference

### 6.5 Prinsip desain

- Overhead rendah (jangan mengganggu pengukuran)
- Data nyata saja; `unavailable` untuk yang tidak ada
- UI mengikuti prototype dari Claude; tanyakan pengguna jika ada konflik dengan data nyata

## 7. Area tweak yang direncanakan (semua wajib punya relevansi OS)

- **Penjadwalan CPU:** EEVDF di kernel 7.0, P/E core pinning (cpuset/cgroup v2), `SCHED_FIFO/RR` untuk thread decode, ukur migrasi thread dan latency (`perf sched`)
- **Memori:** page cache, major fault, readahead, THP, `swappiness`, `vm.dirty_*`, `madvise`
- **I/O:** I/O scheduler NVMe (`none` vs `mq-deadline`), queue depth, pola baca ke dua NVMe, layout file model
- **Power management:** governor, EPP, `intel_pstate`, batas PL1/PL2 (RAPL), `thermald`, C/P-state
- **Interupsi/driver:** IRQ affinity, interaksi nvidia-powerd/Dynamic Boost
- **Isolasi:** Strata dalam cgroup v2 (`cpu.max`, `memory.high`, `io.max`)
- **GPU:** kontrol terbatas (power limit, clock lock, mem clock, PCIe gen) lewat nvidia-smi; kontrol dikuasai driver NVIDIA

Fokus UAS: P/E core pinning, titik ekuilibrium clock/power GPU, dan power governor sebagai batas akhir hardware.

## 8. Struktur repo

Dua repo terpisah:

**Repo A — `perSOna` / Lovelace (webapp)**
```
perSOna/
  README.md
  server/        # collector, API, adapter (generik, tanpa asumsi LLM)
    server.py
    metrics_meta.json
    requirements.txt
    fixtures/
    deploy/      # contoh unit systemd
  web/           # frontend (client/widgets/shell + themes)
  tests/         # smoke test jsdom
  docs/          # arsitektur, fork, catatan
  logs/          # sesi rekaman
  changelog/
```

Catatan: struktur lama `monitor/core/` + `monitor/adapters/` diganti menjadi
`server/` (backend) dan `web/` (frontend) supaya tidak ada dua folder `core/`.
Adapter engine/game nanti masuk `server/adapters/`.

**Repo B — `os-tuning-docs` (dokumentasi perubahan OS)**
```
os-tuning-docs/
  README.md
  baseline/      # log dan snapshot baseline
  tweaks/        # satu file per tweak
  results/       # log A/B, ringkasan
  report/        # bahan laporan UAS
```

Template satu file tweak (`tweaks/NNN-nama.md`):

```
# NNN — Nama tweak
- Tanggal:
- Konsep OS terkait:
- Hipotesis:
- Perubahan (perintah persis):
- Rollback (perintah persis):
- Kondisi tes (cold/warm, prompt, jumlah run):
- Hasil sebelum:
- Hasil sesudah:
- Kesimpulan (diterima / ditolak / perlu lanjut):
- Link log:
```

Tweak yang ditolak tetap dicatat; itu juga bukti kerja.

## 9. Alur kerja

1. Bangun collector + log dulu (fondasi), lalu terapkan prototype UI ke data nyata.
2. Ambil baseline lengkap (cold dan warm, ≥3 run) saat model berjalan.
3. Dari data baseline, pilih tweak berdasarkan bottleneck yang terdeteksi.
4. Satu tweak per iterasi: hipotesis → konfirmasi pengguna → terapkan → A/B → catat → commit/push → ulangi.
5. Rangkum hasil untuk laporan.

## 10. Hal yang belum diputuskan (tanyakan pengguna, jangan diasumsikan)

- Nama repo dan lisensi
- Stack final (usulan di 6.4 belum disetujui)
- Workload standar untuk benchmark A/B (prompt pendek terstandar)
- Apakah root disk (94% penuh) dibersihkan/dipindah sebelum baseline
