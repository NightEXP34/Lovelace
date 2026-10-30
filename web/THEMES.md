# THEMES — kontrak

Core (`web/core/core.js`) yang punya data: fetch `/api/snapshot` tiap detik,
ring buffer 60 sampel, format angka, **registry metrik** yang dibangun dari
snapshot nyata (key, label, satuan, skala asli `scaleKey`, sumber,
`available`/`reason`), status backend, pemilihan theme, dan **tab Log**.

Theme hanya membaca registry dan data lewat `ctx` — **tidak boleh fetch atau
parse sendiri**. Theme mengekspor `mount(root, ctx)` dan `update(ctx)`:

```js
window.Noterra.addTheme("mytheme", {
  mount(root, ctx){ /* bangun DOM sekali: panel, rail, chip */ },
  update(ctx){ /* refresh DOM dari ctx.data / ctx.registry / ctx.hist */ },
  chips(ctx){ /* opsional: core memanggil saat status recording berubah */ },
});
```

Isi `ctx`:
- `ctx.data` — nilai terkini semua kunci snapshot (scalar, array `pu/pf/pt/eu/ef/et`, per-drive `r0/w0/...`)
- `ctx.registry` — `Map` key → `{key, label, unit, digits, source, scaleKey, available, reason}`;
  entri `kind:"drive"` (`dev`, `name`, `link`, `mount`, …) — jumlah NVMe/GPU/core
  mengikuti registry; `gpuPresent` menandai GPU terdeteksi atau tidak.
- `ctx.hist(key)` — ring buffer metrik; `ctx.max(key)` — peak nyata dari buffer
- `ctx.reasons` — peta alasan unavailable mentah dari `/api/health`
- `ctx.fmt` — `fx/val/esc/mmss/clamp/avg`; `ctx.mk(html)`
- `ctx.online`, `ctx.recording`, `ctx.mock`, `ctx.snap`, `ctx.drives`

## id DOM wajib dari `index.html`

`web/index.html` harus menyediakan: `#nav` (nav + tombol view + select `#theme`
+ `#status`), `#root` (tempat view di-mount), `#theme` (select palette), dan
`#status` (teks status backend). Id tab Log (`#iv`, `#lb`, `#tg`, …) dibuat
oleh core saat tab Log dirender, bukan oleh `index.html`.

## core.css — kelas & variabel fallback

`web/core/core.css` dimuat **sebelum** `theme.css`. Isinya gaya netral untuk
kontrak tab Log/widget supaya theme baru tidak wajib menulis semuanya:

- kelas: `.btn` (`.btn.on`, `:disabled`), `.p`, `.tag`, `.bar-top`, `.stack`,
  `.ctl`, `.hint` (`.hint.warn`), `.empty`, `.grow`, `.sub`, `.fld`, `.timer`,
  `table/th/td`, `tr.grp`, `svg.sp`, `svg path.l`, dan kelas widget `.w-*`.
- variabel token: `--a`, `--b`, `--ok`, `--warn`, `--bad`, `--bg`, `--surface`,
  `--line`, `--ink`, `--mute` (masing-masing dipakai lewat `var(--x, fallback)`).

Theme cukup meng-override token di `theme.css`; selector yang sama di
`theme.css` menang karena dimuat belakangan.

## /api/schema

`GET /api/schema` (dan `GET /api/mock/schema`) mengembalikan
`noterra/metrics_meta.json`: peta `key → {label, unit, digits, source,
scaleKey?}`. Core mem-fetch sekali saat start; key yang tidak ada di schema
tetap masuk registry dengan `label = key`. Menambah metrik baru cukup menambah
key di adapter/snapshot + entri schema (tidak perlu mengubah daftar metrik di
core).

## theme.json (di `web/themes/<nama>/theme.json`)

```json
{"name":"mytheme","author":"...","version":"1.0","palettes":["light","dark"]}
```

Server `GET /api/themes` memindai `web/themes/*/theme.json`. `theme.css`
menyuntik stylesheet; block `[data-theme="light|dark"]` memilih palette
(core men-set `document.documentElement.dataset.theme`).

## pilihan theme

`?theme=<nama>` (URL) > `localStorage["nt.theme"]` > `default`.
Palette: `localStorage["nt.palette"]`, fallback `prefers-color-scheme`.

## test tanpa hardware

Buka `/index.html?mock=1` — core memakai `/api/mock/snapshot`
(`noterra/snapshot-sample.json`) dan `/api/mock/health`, tanpa menyentuh
hardware. Smoke test jsdom: `cd nttest && node test-web.mjs` (memuat
`web/index.html` lewat ResourceLoader, fetch di-stub).

## peringatan

**Pasang theme hanya dari sumber yang dipercaya.** Script theme dieksekusi
sepenuhnya di browser dan mendapat akses penuh ke DOM, localStorage, dan
seluruh data yang dikirim core. `/api/themes` hanya daftar — isi script tidak
diverifikasi oleh core.
