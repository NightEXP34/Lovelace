# noterra — Monitor backend (Lovelace)

Webapp monitoring localhost untuk proyek UAS Sistem Operasi. Backend membaca
status hardware nyata; tidak ada angka tebakan — metrik yang tidak punya
sumber data dikembalikan `null` dan UI menampilkan **unavailable**.

## Jalankan

```bash
cd noterra
.venv/bin/python server.py        # http://127.0.0.1:5130
sudo .venv/bin/python server.py   # hanya untuk daya CPU via RAPL (energy_uj mode 0400)
```

Server melayani frontend di `/` dan polled endpoint `GET /api/snapshot`
(JSON, satu snapshot penuh; laju counter dihitung dari delta antar panggilan).

## Sumber metrik

| Metrik | Sumber |
|---|---|
| CPU temp (package & per core) | hwmon `coretemp` |
| CPU power (package) | RAPL `/sys/class/powercap/intel-rapl:0` (butuh root) |
| Utilisasi per core, clock | `/proc/stat` (delta), `/sys/.../cpufreq/scaling_cur_freq`; P vs E dari `scaling_max_freq` (≥4 GHz = P) |
| Governor, EPP, turbo, driver | sysfs `cpufreq` + `intel_pstate` |
| Context switch, IRQ | `/proc/stat` ctxt, `/proc/interrupts` (delta) |
| Thread migration | `/proc/schedstat` nb_push+nb_pull (delta; format diverifikasi, kalau tidak dikenali → unavailable) |
| Idle residency | cpuidle sysfs state terdalam (mesin ini: **C3_ACPI**, bukan C6) |
| GPU: suhu, daya, clock, util, VRAM, throttle, P-state, fan | NVML (`nvidia-ml-py`) — butuh `/dev/nvidia*` |
| GPU PCIe link | sysfs PCI device (`current_link_speed/width`) — bekerja tanpa NVML |
| Memori, swap | `/proc/meminfo` |
| Major/minor fault, swap I/O | `/proc/vmstat` (delta) |
| NVMe read/write/IOPS/await/util/queue | `/proc/diskstats` (delta) |
| NVMe suhu | hwmon `nvme` per drive |
| NVMe scheduler, ukuran, link, kapasitas | sysfs block/PCI + `/proc/mounts` |
| Kernel, driver NVIDIA, THP, swappiness, pinning | `uname`, `/proc/driver/nvidia`, sysfs, cgroup v2 |

## Yang jujur unavailable (tidak ada sumber nyata di mesin ini)

- PCIe rx/tx GPU dan VRAM bandwidth — tidak diekspos NVML/sysfs.
- PL1/PL2 — tidak diekspos sysfs powercap (constraint RAPL tidak terbaca tanpa root).
- CPU throttle reason — tidak ada sumber tanpa turbostat/perf.
- NVMe readahead — path sysfs tidak ada di kernel ini.
- Daya CPU tanpa root (RAPL).

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
