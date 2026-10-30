# Changelog — perbaikan tab Log

- Status backend tidak lagi jatuh ke "offline" saat tab Log aktif: shell hanya
  memanggil `theme.update()` untuk view Overview (rail/panel tidak ada di DOM
  Log).
- Layout Log ditulis ulang: header, toolbar rekaman, kartu Sessions, kartu
  Analysis, tabel yang bisa di-scroll, empty state.
- Chart Log baru: grid + label sumbu, penanganan nilai konstan (garis di
  tengah), pesan saat tidak ada sample, dan legend per sesi.
- `web/core/core.css` mendapat gaya Log netral (berlaku juga untuk theme lain).
- Test: status live di tab Log, path chart, dan grid chart ditambahkan.
- Setelah stop, cache CSV sementara dihapus dan sesi langsung di-select ulang;
  analysis membaca CSV final tanpa refresh browser. Backend `log_stop` juga
  membatalkan task recorder dan menunggu `finally` menulis status `saved`.

- Recording diperluas: CSV memuat timestamp + skalar penting + `puN/pfN/ptN`,
  `euN/efN/etN` per core, dan `rN/wN/iN/aN/uN/qN/tN` per drive. Header CSV
  sekarang eksplisit `timestamp_ms`.
- Parser Log memetakan kolom skalar, per-core, dan per-drive ke label/satuan;
  dropdown metrik ikut memuat metrik core/drive.

- Dua mode recording: `detailed` (default; skalar + per-core + per-drive) dan
  `minimal` (8 kolom lama). Pilihan ada di toolbar Log dan tersimpan di
  `meta.json` (`mode`); sesi lama tanpa mode dideteksi dari jumlah kolom.

- Backend `GET /api/log/<id>/data` mengembalikan semua kolom+baris CSV sebagai
  JSON; UI memakainya untuk matriks pembanding semua metrik (per core/drive),
  sparkline, filter, baseline, dan daftar metrik tanpa data.
