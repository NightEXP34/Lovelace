# Operations — run, test, dan akses hardware

## Setup sekali (tanpa sudo)

```bash
./scripts/setup.sh
```

Membuat `server/.venv`, memasang `server/requirements.txt`, dan `npm ci` di
`tests/` bila `tests/node_modules` belum ada. Butuh jaringan.

## Menjalankan (tanpa sudo)

```bash
./scripts/run.sh
# http://127.0.0.1:5130
```

Mode mock tanpa hardware:

```
http://127.0.0.1:5130/?mock=1
```

Cek sumber metrik tanpa menyalakan server/port:

```bash
./scripts/check.sh
```

Setara `python -m server.main --check`; mencetak status tiap key beserta alasan
unavailable.

## Test

```bash
./scripts/test.sh
```

Isinya: `py_compile` (`server/main.py`, `server/collectors.py`), backend
`unittest` (`tests/backend`), lalu `npm test` (jsdom, `tests/test-web.mjs`).
Tidak menyalakan server dan tidak menyentuh hardware.

## Akses hardware tanpa sudo — batas nyata

Yang **bisa** dibaca sebagai user biasa (selama permission device normal):
CPU temp/freq/util, memory, storage, NVMe, dan GPU lewat NVML.

Yang **tidak bisa** tanpa privilege: daya package CPU via RAPL
(`/sys/class/powercap/intel-rapl:0/energy_uj`, mode `0400` root-only). Ini
pembatasan kernel sejak PLATYPUS. `cpuW` akan tetap `unavailable` dengan alasan
di `/api/health`; itu bukan bug UI.

**Tidak ada trik aman untuk mendapatkannya tanpa sudo sama sekali.** Pilihan:

1. Biarkan `cpuW` unavailable (default `scripts/run.sh`; tidak ada sudo).
2. Jalankan server sebagai root (`sudo`) — tidak disarankan, hak terlalu luas.
3. Satu kali pasang service system dengan capability minimal:
   `server/deploy/noterra.service` memakai `AmbientCapabilities=CAP_DAC_READ_SEARCH`
   dan `CapabilityBoundingSet` hanya capability itu. Ini butuh sudo **sekali**
   untuk instal/enable; setelah itu server berjalan sebagai service.
   Unit ini tidak dijalankan/di-enable otomatis oleh repo.
4. Jangan `chmod` `energy_uj` menjadi world-readable; itu memperluas paparan
   telemetry daya ke semua user dan sudah ditolak di catatan desain.

Catatan: systemd **user** service tidak bisa memberi capability yang tidak
dimiliki user manager. Jadi opsi 3 memakai system service, bukan `--user`.

## Log dan proses

- Recording ditulis ke `logs/<tanggal>_<label>/` (samples.csv + meta.json).
  Jangan hapus folder ini saat investigasi.
- Hentikan server dengan Ctrl+C di terminal yang menjalankannya.
- Jangan memakai `pkill -f`, `killall`, atau kill berbasis pola nama: bisa
  membunuh proses lain (kejadian nyata di proyek ini).
