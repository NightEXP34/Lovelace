# Changelog — gauge Overview

- Gauge besar CPU/GPU sekarang **utilization** (0–100%), ring kecil = **watt**
  (CPU vs PL1, GPU vs power limit); nilai watt tampil sebagai teks kecil di
  dalam ring.
- Gauge besar Memory = RAM usage, ring kecil = swap; label `RAM usage`.
- Storage: dua gauge sejajar — kiri **write**, kanan **read** — memakai peak
  terukur; blok stats Write/IOPS/Await/Util di kanan gauge dihapus.
- Semua gauge memakai gradient hijau → kuning → merah; nilai rendah/kiri hijau,
  tinggi/kanan merah. Teks ring diturunkan agar tidak terlalu ke atas.
- Stats CPU/GPU disesuaikan: suhu tetap tampil di kartu stat.

## 2026-10-30 — teks gauge disederhanakan (meng-override bullet di atas)

- Ring dalam CPU/GPU: teks hanya `power` (sebelumnya `power <n> W`); nilai +
  satuan pindah ke `title` (tooltip) — saat unavailable, tooltip berisi alasan.
- Ring dalam Memory: teks hanya `swap` (sebelumnya `swap <n> GiB`); nilai +
  satuan di tooltip. Label `utilization` dan `RAM usage` tidak berubah.
- Gauge Storage: label hanya `write` / `read` (sebelumnya `nvme0n1 write`);
  nama drive terpilih lewat tooltip label gauge (`nvme0n1 · <model>`).
- Ring tetap memakai skala nyata nilai tersebut, jadi proporsi visual tidak
  berubah; test `tests/test-web.mjs` mengikuti teks baru.
