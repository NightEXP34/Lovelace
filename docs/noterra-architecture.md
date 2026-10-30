# Arsitektur noterra

Monitor hardware Lovelace — webapp localhost yang membaca status mesin secara
nyata. Diatur sesuai rencana Repo A di `docs/agents.md`: **core generik**
(collector, penyimpanan, API tanpa asumsi LLM) + **adapter** yang pluggable
(adapter engine di kemudian hari, mis. game untuk fork teman). Scope
sekarang = monitoring hardware murni; adapter engine LLM dikecualikan sampai nanti.

## Komponen

```
server/
  server.py            # FastAPI: collector /proc, /sys, NVML + endpoint
  metrics_meta.json    # schema metrik (label, satuan, sumber, scaleKey)
  requirements.txt     # fastapi, uvicorn, psutil, nvidia-ml-py
  README.md            # cara menjalankan + tabel sumber metrik
  fixtures/snapshot-sample.json  # fixture snapshot nyata untuk test
  deploy/noterra.service         # contoh unit systemd (tidak dijalankan)
web/                   # UI yang diserve GET /
  index.html           # shell: nav, palette, status, #root
  core/client.js       # data client (fetch/registry/ctx), tanpa DOM
  core/widgets.js      # widget primitif + renderLayout
  core/shell.js        # nav/status/tab Log/view registry
  core/core.css        # fallback gaya (dimuat sebelum theme.css)
  themes/default/      # theme L3 (overview.js) + layout.json
  themes/minimal/      # contoh L2 tanpa JavaScript
  examples/headless.html
tests/
  test-web.mjs         # smoke test headless (jsdom) terhadap web/index.html
  check-layout.mjs     # cek cepat widget komposit
docs/prototype/overview_v6.html  # referensi desain
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
panggilan (state counter di server, waktu monotonic); collector mencatat
alasan unavailable ke _health → exposed via /api/health dan --check
        ↓
UI: fetch /api/snapshot tiap 1s + /api/health tiap 5s → S (snapshot terkini)
+ H (ring buffer 60 sampel untuk sparkline) + R (alasan untuk tooltip)
→ part.up() merender panel
        ↓
Tab Log (server-side): POST /api/log/start → loop server nulis
logs/<tanggal>_<label>/samples.csv tiap interval + meta.json (label, tag,
iv, marker, status); analisis UI fetch CSV dari server (mean/median/p95/sd/
min/max, overlay A/B); export CSV = file server
```

## Layout Overview (port dari prototype overview_v6.html)

Prototype punya data mock; porting ke `web/themes/default/overview.js` memakai
snapshot nyata:

- **Gauge**: skala penuh diambil dari ring buffer 60 sampel + nilai terkini
  (`dynMax`), bukan konstanta prototype; ring dalam CPU = daya vs PL1 nyata
  (warn 90% PL1, bad ≥ PL1); ring dalam GPU = draw vs limit NVML nyata
  (70 W default di mesin ini); ambang warna dari sinyal throttle nyata
  (bit NVML GPU / delta sysfs CPU), bukan ambang suhu karangan.
- **Chip throttle GPU**: 4 slot (Idle/Power cap/Thermal/HW slowdown) dari bit
  `nvmlDeviceGetCurrentClocksThrottleReasons` (di-decode di server), bukan
  dari perbandingan suhu; NVML gagal → chip "—" dengan tooltip alasan.
- **Cell core P/E**: jumlah dari array snapshot (dinamis; mesin ini 6 P + 4 E),
  GHz dari kHz/1e6, °C dari hwmon; tanpa sumber → "—" + tooltip.
- **Bar**: penyebut dari sumber nyata — PL1, limit NVML, theoretical PCIe dari
  link max, peak VRAM estimasi, vramTot/memTot/swapTot, kapasitas via mount;
  untuk laju fault/read tanpa spesifikasi hardware, penyebut = peak terukur di
  ring buffer (berlabel "peak terukur"). Tidak ada konstanta mock yang dibiarkan.
- **Rail kanan**: Timeline = sparkline 60 sampel ring buffer + nilai terkini;
  Events = transisi status nyata (throttle NVML lepas/aktif, burst NVMe > 600
  MB/s, throttle CPU sysfs, draw ≥ 95% limit NVML) — 6 slot; System = field
  konfigurasi dari snapshot.
- **Hint bottleneck**: aturan eksplisit ditampilkan — page-bound (NVMe read
  > 600 MB/s dan GPU util < 50%), thermal-bound (throttle NVML/sysfs aktif),
  power-bound (draw ≥ 95% limit NVML); input null → aturan tidak dievaluasi.

## Portabilitas (hardware lain)

Asumsi mesin lama sudah diganti discovery:

- **Drive**: dari listing `/sys/block` (disk penuh; loop/ram/zram dibuang),
  bukan nama `nvme{n}n1` hardcoded → SATA/USB/mmcblk/multi-NVMe terbaca;
  model via `/sys/block/<dev>/device/model`, suhu via hwmon NVMe kalau ada,
  PCI link via walk symlink device (generik), mount via `/proc/mounts`.
  Kunci laju (`r{i}/w{i}/i{i}/a{i}/u{i}/q{i}/t{i}`) dibuat dinamis per drive.
- **GPU**: NVML primary (`nvmlDeviceGetCount`, index 0 — bukan alamat PCI
  hardcoded); fallback sysfs scan `class` 0x03xx (display controller).
  `snap.gpuPresent` = NVML aktif ATAU ada display controller.
- **RAPL/power limit**: glob semua device `powercap` dengan `energy_uj`;
  domain MMIO (`*-mmio:*`) diprioritaskan belakangan karena di mesin ini MSR
  domain (`intel-rapl:0`) adalah sumber PL1/PL2 standar (mmio bisa memuat
  limit yang dikelola firmware/BTP dan nilainya berbeda — pernah terbaca 45 W
  saat seharusnya 200 W).
- **PMU RAM**: glob `uncore_imc_free_running_*` / `uncore_imc_*` / `imc_*`
  + filter punya event `data_read`; kalau tidak ada → unavailable dengan
  alasan generik.
- **UI mengikuti hardware**: panel GPU tidak dibangun kalau GPU tidak ada;
  panel Storage memakai bar/tabel/chart dinamis per drive; timeline rail
  membangun baris dari hardware (CPU + GPU kalau ada + majF + 1 baris per
  drive). Nilai tanpa sumber tetap unavailable + tooltip alasan.

Test jsdom sekarang punya dua mesin: fixture mesin ini dan simulasi mesin
lain (tanpa GPU, 3 drive SATA) — keduanya ALL PASS.

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
  (`current_link_speed/width`); scheduler NVMe parsing nilai aktif `[x]`;
  power limit GPU: limit aktif → default limit NVML (ditandai di UI).
- **Sumber yang mati ditolak, bukan dipakai**: `/proc/schedstat` nb_push+nb_pull
  terbaca tapi selalu 0 di kernel 7.0 ini → sumber migration diganti ke
  `se.nr_migrations` per thread (`/proc/<pid>/task/<tid>/sched`, ~15 ms/snapshot,
  terbukti merespons beban); perf system-wide diblokir `perf_event_paranoid=4`.
- **Health = alasan eksplisit**: tiap collector mencatat `avail(key, alasan)`;
  `/api/health` + `--check` exposes itu; UI menampilkan unavailable kecil/redup
  tanpa satuan + tooltip alasan. "idle" (nol I/O) bukan unavailable.
- **Overhead terukur**: snapshot penuh ~45 ms (dominus scan migration ~15 ms);
  NVML in-process; tidak ada subprocess di hot path untuk user biasa (jalur
  perf IMC hanya aktif kalau perf diizinkan).
- **Core netral**: snapshot tidak menyebut Strata; adapter engine direncanakan
  sebagai plugin yang menambah key metrik sendiri.

## Endpoint

| Endpoint | Isi |
|---|---|
| `GET /` | `web/index.html` |
| `GET /api/snapshot` | JSON: metrik scalar (cpuT, cpuW, cpuU, pfa, pl1, pl2, plPeak, cpuThr, ctx, migr, irq, idle, gT..pcu, gbw, gpeak, pctheory, vbw, majF, minF, swp, ramBW, r0..t1, a0Idle/a1Idle), array per-core (pu, pf, pt, eu, ef, et), `drives[]` (model, sizeGB, link, linkMax, sched, readahead, capUsed, mount), `snap` konfigurasi sistem (kernel, cpuModel, driver, gpuDriver, gpuName, governor, epp, turbo, pinning, thp, swappiness, nvml). |
| `GET /api/health` | `{ok, nvml, items:{key→alasan|null}}` — alasan tiap metrik yang unavailable; dipakai tooltip UI dan `server.py --check`. |
| `POST /api/log/start` `{label,tag,interval}` | buat sesi recording; folder `logs/<tanggal>_<label>/` (samples.csv + meta.json schema v1: label, tag, interval_s, snapshot konfigurasi, marker, status, kolom CSV); loop server nulis CSV tiap interval |
| `POST /api/log/stop` `{id}` | hentikan loop, meta status→"saved" |
| `POST /api/log/marker` `{id,note?}` | marker `{ts_ms, since_s, note}` masuk `meta.markers` |
| `GET /api/log/sessions` | daftar semua sesi (aktif + yang tersimpan di disk) dari meta.json |
| `GET /api/log/<id>/samples.csv` | CSV mentah untuk analisis UI |
| `DELETE /api/log/<id>` | hapus folder sesi (409 kalau masih recording) |

CLI: `server.py --check` = probe dua snapshot lalu cetak tabel available/unavailable + alasan.

## Status saat ini (hasil nyata, bukan klaim)

Terisi di mesin ini: suhu/power GPU, clock SM+mem, util, VRAM GiB, throttle reason,
P-state, PCIe link now/max, rx/tx NVML, bus width 128-bit, peak VRAM (estimasi DDR),
pctheory dari link max, PL1/PL2/peak power (constraint, terbaca tanpa root),
throttle CPU sysfs (delta), migration thread, ctx/IRQ/idle residency (C3_ACPI),
readahead 128 KB, kapasitas drive (nvme0: "not mounted"; nvme1: 91%), clock GHz
(kHz/1e6), IOPS/await ("idle" saat nol I/O), recording persisten logs/,
throttle bits NVML (chip UI), layout Overview v6. `--check` terakhir: 76 key,
72 available, 4 unavailable, 1 state "idle".

Unavailable dengan alasan (via /api/health):
- daya package CPU: `energy_uj` mode 0400 — butuh root/CAP_DAC_READ_SEARCH
  (unit `server/deploy/noterra.service` disiapkan; energy_uj TIDAK di-chmod);
- fan GPU: NVML NotSupported (EC-controlled);
- bandwidth RAM terukur: PMU `uncore_imc_free_running_{0,1}` ada tapi perf
  diblokir `kernel.perf_event_paranoid=4` tanpa root (ubah sysctl = tuning →
  butuh konfirmasi pengguna, tidak dilakukan);
- NVML power limit aktif: NotSupported → dipakai default limit NVML.

## Todolist

Scope saat ini (keputusan pengguna 2026-10-30): **monitoring hardware murni
dulu saja** — metrik engine LLM (Strata), adapter engine, dan tab hipotesis
yang bergantung engine dikecualikan dari scope sampai nanti. Arsitektur tetap
netral (collector/API tidak menyebut engine) supaya adapter bisa ditambahkan
di kemudian hari tanpa mengubah core.

- [x] **Persistensi sesi** di server — folder `logs/<tanggal>_<label>/` dengan
      samples.csv + meta.json v1 (marker, interval, snapshot konfigurasi);
      UI Log tab baca dari API.
- [x] **Verifikasi NVML** — NVML bekerja saat device node terlihat; seluruh
      metrik GPU terisi (termasuk decode bit throttle reasons + chip UI).
- [x] **Throttle reason CPU** — sysfs thermal_throttle (delta), pembanding
      `turbostat --no-msr --no-perf` bekerja tanpa root.
- [x] **Thread migration** — sumber `/proc/*/task/*/sched` nr_migrations
      (schedstat mati di kernel ini); overhead diukur ~15 ms/snapshot.
- [x] **PCIe rx/tx GPU** — NVML `GetPcieThroughput` terisi; persen link dari
      throughput ÷ theoretical(link max).
- [x] **Layout Overview v6** — port prototype ke UI dengan data nyata
      (gauge skala dinamis dari ring buffer, penyebut bar dari sumber nyata).
- [ ] **Marker ikut CSV export** — kolom timestamp marker di CSV (marker
      sudah ada di meta.json).
- [ ] **Events persisten** — transisi status (throttle, burst NVMe) ditulis ke
      folder sesi (mis. events.json) supaya bertahan lewat reload.
- [ ] **Interval polling live configurable** — recording sudah 0.5/1/5 s;
      polling live masih hard 1 s.
- [ ] **Export JSON** — spec menyebut CSV/JSON; baru CSV.
- [ ] **Aturan thermal-bound + clock turun** — tambahkan sinyal "SM clock
      turun saat bit thermal aktif" ke aturan bottleneck (dari data NVML).
- [~] **RAPL package power** — butuh root/CAP_DAC_READ_SEARCH; unit
      `server/deploy/noterra.service` disiapkan, belum dijalankan (butuh aksi root di
      host; energy_uj tidak di-chmod).
- [ ] **Bandwidth RAM terukur** — PMU IMC ada; butuh perf diizinkan
      (menurunkan perf_event_paranoid = parameter tuning → butuh konfirmasi
      pengguna). Tanpa itu tetap unavailable dengan alasan.
- [ ] **Baseline A/B tuning OS** — ≥3 run cold/warm untuk eksperimen
      governor/EPP/pinning/readahead (protokol drop_caches), sebagai alat
      verifikasi tweak hardware — bukan metrik engine.
- [~] **Refactor core/adapter** — folder sudah dirapikan: backend di `server/`,
      test di `tests/`, UI di `web/`; frontend modular L1–L4. Yang tersisa:
      memecah `server/server.py` menjadi modul collector dan menyiapkan
      `server/adapters/` (engine/game) sesuai Repo A.

Dikecualikan dari scope sekarang (bukan hilang permanen, hanya tidak dikerjakan):
adapter Strata / metrik engine (tok/s, joule per token, waktu hingga warm) dan
tab hipotesis yang memakai engine.
