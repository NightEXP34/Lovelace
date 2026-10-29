# Arsitektur noterra

Monitor hardware Lovelace — webapp localhost yang membaca status mesin secara
nyata. Diatur sesuai rencana Repo A di `docs/agents.md`: **core generik**
(collector, penyimpanan, API tanpa asumsi LLM) + **adapter** yang pluggable
(Strata untuk UAS, game untuk fork teman).

## Komponen

```
noterra/
  server.py            # FastAPI: collector /proc, /sys, NVML + endpoint
  index.html           # UI vanilla JS (part-based), polling /api/snapshot
  snapshot-sample.json # fixture snapshot nyata untuk test
  README.md            # cara menjalankan + tabel sumber metrik
  .venv/               # deps: fastapi, uvicorn, psutil, nvidia-ml-py
nttest/
  test.mjs             # smoke test headless (jsdom) terhadap index.html
```

## Alur data

```
/proc/stat  /proc/interrupts  /proc/schedstat  /proc/vmstat
/proc/meminfo  /proc/diskstats  /proc/cpuinfo        \
/sys/class/hwmon (coretemp, nvme)                    |  fungsi collector
/sys/class/powercap (RAPL)                           |  per sumber
/sys/devices/system/cpu/* (cpufreq, cpuidle)         |
/sys/block/nvme* + PCI sysfs (link, scheduler)       |
NVML (nvidia-ml-py)                                  /
        ↓
snapshot() — satu JSON utuh per panggilan; laju = delta counter antar
panggilan (state counter di server, waktu monotonic)
        ↓
UI: fetch /api/snapshot tiap 1s → S (snapshot terkini) + H (ring buffer
60 sampel untuk sparkline) → part.up() merender panel
        ↓
Tab Log: recording menarik snapshot tiap interval → session
{name, tag, iv, start, data[], markers, snap} → analisis (mean/median/
p95/sd/min/max, overlay A/B, diff konfigurasi) → export CSV
```

## Desain kunci

- **Nilai tanpa sumber nyata = `null`** → UI menampilkan `unavailable`.
  Tidak ada angka karangan (aturan keras #4 agents.md).
- **Laju dari delta**, bukan sampling instan: counter kumulatif
  (`energy_uj`, diskstats, vmstat, ctxt, interrupts) disimpan per key;
  delta dibagi dt sejak snapshot sebelumnya. Wrap counter ditangani (RAPL).
- **Topologi dinamis**: P vs E ditentukan dari `scaling_max_freq`
  (≥ 4 GHz = P); core fisik dikelompokkan dari `core id` di `/proc/cpuinfo`.
  UI merender bar sejumlah core yang dilaporkan kernel — tidak hardcode.
- **Fallback bertingkat**: link GPU via NVML → jika NVML gagal, sysfs PCI
  (`current_link_speed/width`); scheduler NVMe parsing nilai aktif `[x]`.
- **Sanitasi format kernel**: format `/proc/schedstat` bisa berubah antar
  kernel; counter hanya dipercaya bila nilainya seperti count (<1e9), kalau
  tidak metrik tetap `unavailable` alih-alih nonsense.
- **Overhead rendah**: hanya baca file kecil per snapshot, tanpa subprocess
  di hot path (NVML in-process), tanpa framework UI.
- **Core netral**: snapshot tidak menyebut Strata; adapter engine direncanakan
  sebagai plugin yang menambah key metrik sendiri.

## Endpoint

| Endpoint | Isi |
|---|---|
| `GET /` | index.html |
| `GET /api/snapshot` | JSON: metrik scalar (cpuT, cpuW, cpuU, pfa, ctx, migr, irq, idle, gT, gW, gClk, gU, gMU, vram, majF, minF, swp, r0..t1), array per-core (pu, pf, pt, eu, ef, et), `drives[]` (model, sizeGB, link, sched, capUsed), `snap` konfigurasi sistem (kernel, driver, governor, epp, turbo, pinning, thp, swappiness, gpuDriver, nvml flag). |

## Status saat ini

Backend + UI sudah terhubung penuh dan teruji headless (jsdom, ALL PASS).
Yang jujur unavailable: PCIe rx/tx, VRAM bandwidth, PL1/PL2 (tanpa root),
throttle CPU, readahead NVMe. Catatan: NVML butuh `/dev/nvidia*` (host),
RAPL butuh root, dan kernel saat ini melaporkan hanya 4 E-core online.

## Todolist

- [ ] **Penyimpanan sesi ke SQLite** di server — sesi saat ini hidup di
      memori browser dan hilang saat reload; log harus persisten di repo log.
- [ ] **Adapter Strata** (`adapters/strata/`): baca HTTP API Strata untuk
      tok/s prefill/decode, slot, model termuat; metrik tak tersedia →
      unavailable; jangan hardcode di core.
- [ ] **Verifikasi NVML di host** — jalankan server di terminal sendiri dan
      pastikan seluruh metrik GPU terisi; dokumentasikan hasil.
- [ ] **RAPL sebagai root**: daya package + sub-device (core vs die) dan
      baca constraint PL1/PL2 bila tersedia.
- [ ] **Throttle reason CPU** via `turbostat`/`perf` bila tersedia —
      sekarang unavailable permanen.
- [ ] **Thread migration**: verifikasi format schedstat di kernel 7.0 dengan
      beban nyata, atau ganti sumber (`perf sched`).
- [ ] **PCIe rx/tx GPU**: cari sumber nyata (mis. counter trace) atau tulis
      resmi sebagai tidak tersedia.
- [ ] **Deteksi bottleneck rule-based** di UI (page-bound: PCIe/NVMe jenuh +
      GPU idle; thermal-bound: suhu dekat batas + clock turun) — tampilkan
      aturan yang picu, bukan hanya kesimpulan.
- [ ] **Tab hipotesis** (hipotesis → tweak → A/B → hasil) sesuai spec 6.3.
- [ ] **Ekspor CSV/JSON ke folder log repo** (`os-tuning-docs/baseline/`,
      `results/`) untuk bahan laporan UAS.
- [ ] **Interval sampling configurable** untuk polling live (recording sudah
      bisa 0.5/1/5 s).
- [ ] **Marker sesi ikut di CSV export** (kolom timestamp marker).
- [ ] **Uji overhead** collector sambil inference berjalan (target: tidak
      mengganggu pengukuran).
- [ ] **Baseline resmi**: ≥3 run cold + warm saat Strata jalan, snapshot
      konfigurasi otomatis tersimpan.
- [ ] **Refactor core/adapter** sesuai struktur Repo A (`core/`,
      `adapters/`, `web/`) saat fork teman dibutuhkan.
