# noterra — Monitor backend (Lovelace)

Webapp monitoring localhost untuk proyek UAS Sistem Operasi. Backend membaca
status hardware nyata; tidak ada angka tebakan — metrik yang tidak punya
sumber data dikembalikan `null` dan UI menampilkan **unavailable**.

## Jalankan

```bash
cd noterra
.venv/bin/python server.py        # http://127.0.0.1:5130
.venv/bin/python server.py --check  # diagnosis sumber per metrik (available/unavailable + alasan)
```

Daya CPU via RAPL butuh akses baca `energy_uj` (mode 0400 — kernel membatasinya
sejak PLATYPUS; **jangan** chmod world-readable). Dua cara yang dipakai:

```bash
sudo .venv/bin/python server.py                # root penuh (paling sederhana)
systemctl --user enable --now noterra          # unit noterra/noterra.service:
                                               # AmbientCapabilities=CAP_DAC_READ_SEARCH,
                                               # tanpa root penuh, server tetap bind 127.0.0.1
```

Server melayani frontend di `/`, polled endpoint `GET /api/snapshot`
(JSON, satu snapshot penuh; laju counter dihitung dari delta antar panggilan),
`GET /api/health` (alasan tiap metrik yang unavailable), dan endpoint recording
`POST /api/log/start|stop|marker`, `GET /api/log/sessions`,
`GET /api/log/<id>/samples.csv`, `DELETE /api/log/<id>`. Recording persisten di
repo: `logs/<tanggal>_<label>/samples.csv` + `meta.json` (label, tag, interval,
marker, status).

## Sumber metrik

| Metrik | Sumber |
|---|---|
| CPU temp (package & per core) | hwmon `coretemp` |
| CPU power (package) | RAPL `/sys/class/powercap/intel-rapl:0/energy_uj` (delta µJ/s; butuh root/CAP_DAC_READ_SEARCH) |
| PL1 / PL2 / peak power | `constraint_*_power_limit_uw` di powercap intel-rapl (terbaca tanpa root di kernel ini; server hanya membaca, tidak menulis) |
| Utilisasi per core, clock | `/proc/stat` (delta), `/sys/.../cpufreq/scaling_cur_freq`; P vs E dari `scaling_max_freq` (≥4 GHz = P) |
| Governor, EPP, turbo, driver | sysfs `cpufreq` + `intel_pstate` |
| Throttle CPU | sysfs `thermal_throttle/{core,package}_throttle_count` (delta antar snapshot; pembanding: `turbostat --no-msr --no-perf`) |
| Context switch, IRQ | `/proc/stat` ctxt, `/proc/interrupts` (delta) |
| Thread migration | `/proc/<pid>/task/<tid>/sched` `se.nr_migrations` (delta per thread; ~1273 thread, ~15 ms/snapshot; thread short-lived yang mati sebelum terobservasi tidak terhitung). `/proc/schedstat` nb_push+nb_pull = 0 terus di kernel ini (mati); perf system-wide diblokir `perf_event_paranoid=4` tanpa root |
| Idle residency | cpuidle sysfs state terdalam (mesin ini: **C3_ACPI**, bukan C6) |
| GPU: suhu, daya, clock, util, VRAM, throttle, P-state, fan, bus width | NVML (`nvidia-ml-py`) — butuh `/dev/nvidia*` |
| GPU power limit | NVML `nvmlDeviceGetPowerManagementLimit`; di mesin ini NotSupported → pakai default limit NVML (ditandai "(default)" di UI) |
| GPU PCIe link max + rx/tx | NVML `GetMaxPcieLinkGeneration/Width` + `GetPcieThroughput(RX/TX)` (KB/s → GB/s) |
| GPU VRAM peak bandwidth | estimasi: bus width NVML × memory clock × 2 (DDR); bandwidth terpakai = util controller × peak (label "estimasi") |
| GPU PCIe link | sysfs PCI device (`current_link_speed/width`) — bekerja tanpa NVML |
| Memori, swap | `/proc/meminfo` |
| Major/minor fault, swap I/O | `/proc/vmstat` (delta) |
| NVMe read/write/IOPS/await/util/queue | `/proc/diskstats` (delta) |
| NVMe suhu | hwmon `nvme` per drive |
| NVMe scheduler, ukuran, link, kapasitas | sysfs block/PCI + `/proc/mounts`; drive tanpa mount → UI "not mounted" |
| NVMe readahead | sysfs `queue/read_ahead_kb` (kernel ini ada; dulu path `readahead_kb` salah) |
| Bandwidth RAM terukur | PMU `uncore_imc_free_running_{0,1}` via perf (butuh root/CAP_PERFMON; di sini diblokir `perf_event_paranoid=4` → unavailable dengan alasan) |
| Kernel, driver NVIDIA, THP, swappiness, pinning | `uname`, `/proc/driver/nvidia`, sysfs, cgroup v2 |

## Yang jujur unavailable (tidak ada sumber nyata di mesin ini)

- Fan GPU — NVML NotSupported di laptop ini (kipas diatur Embedded Controller, tidak lewat NVML).
- VRAM bandwidth terpakai bukan pengukuran langsung: estimasi util controller × peak (berlabel "estimasi").
- Bandwidth RAM terukur — PMU IMC ada tapi perf diblokir `kernel.perf_event_paranoid=4` tanpa root.
- Daya CPU tanpa root (RAPL `energy_uj` mode 0400).

## Catatan mesin ini (hasil pembacaan nyata, bukan asumsi)

- Kernel melaporkan **16 logical CPU**: 12 thread P-core (6 physical) + **4 E-core** — bukan 8 E-core seperti spesifikasi i7-13620H; UI menampilkan apa yang dilaporkan kernel.
- NVMe 0 (WD SN540) link nyata **Gen3 x4**; NVMe 1 (ZHITAI) link nyata; GPU link nyata **Gen4 x8**.
- NVML gagal di dalam sandbox harness (`/dev/nvidia*` tidak terlihat) — jalankan server di terminal host sendiri agar metrik GPU terisi.

## Test frontend

`nttest/test.mjs` (jsdom) menjalankan UI headless dengan fixture
`noterra/snapshot-sample.json`: rendering panel, dynamic core rows,
unavailable handling, sesi recording, statistik, CSV export.

```bash
cd nttest && npm install jsdom && node test.mjs
```
