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
