# THEMES — kontrak UI noterra

Frontend sekarang dibagi empat lapis. Pilih tingkat kustomisasi yang paling
nyaman; lapis atas tetap kompatibel dengan lapis bawah.

| Lapis | Yang diubah | Perlu JavaScript? |
|---|---|---|
| **L1** | `theme.css` + token palette | tidak |
| **L2** | `layout.json` berisi widget siap pakai | tidak |
| **L3** | `overview.js` dengan `mount`/`update`/`chips` | ya |
| **L4** | hanya `client.js` (headless) | ya |

## Arsitektur file

```
web/
  index.html            # shell: #nav, #theme, #status, #root
  core/
    client.js           # data (fetch/registry/ctx), TANPA DOM
    widgets.js          # widget primitif + Noterra.renderLayout
    shell.js            # nav, status, palette, view registry, tab Log
    core.css            # fallback kelas/variabel (dimuat sebelum theme.css)
  themes/<nama>/
    theme.json
    theme.css
    layout.json         # opsional (L2)
    overview.js         # opsional (L3)
  examples/headless.html # contoh L4
```

`web/index.html` memuat `core.css`, lalu `client.js`, `widgets.js`, `shell.js`.
Theme script (kalau ada) dimuat setelah itu; theme tidak boleh fetch/parse
data sendiri — cukup baca `ctx`.

## L1 — CSS saja

Salin `theme.css`, ubah token di `:root` dan `[data-theme="dark"]`:

```css
:root{
  --bg; --surface; --line; --ink; --mute;
  --a; --b; --ok; --warn; --bad;
  --r-panel; --r-ctl; --sans; --mono;
}
```

`core.css` menyediakan fallback netral, jadi theme tidak wajib menulis gaya
tab Log/widget. Selector yang sama di `theme.css` menang karena dimuat setelah
`core.css`. Ganti palette lewat `[data-theme="nama"]`.

## L2 — `layout.json` tanpa JavaScript

Buat `theme.json` dengan `"layout": "layout.json"` dan **tanpa** `entry`/script:

```json
{"name":"minimal","palettes":["light","dark"],"layout":"layout.json"}
```

Core otomatis mendaftarkan view Overview dan merender `layout.json` memakai
widget primitif. Contoh lengkap: `web/themes/minimal/` (tanpa JS).

### Skema layout

```json
{"cols":12,"gap":12,"items":[
  {"widget":"value","bind":"cpuT","x":0,"y":0,"w":3,"h":1},
  {"widget":"sparkline","bind":"gW","x":3,"y":0,"w":3,"h":2}
]}
```

- `cols` jumlah kolom grid (default 12), `gap` jarak px.
- `x`,`y` posisi 0-based; `w`,`h` span (default 1).
- Widget tak dikenal → placeholder `.w-missing` bertuliskan nama widget.
- `bind` tak dikenal → `unavailable` + tooltip alasan.
- JSON invalid → `.layout-error`, tidak pernah crash.
- Precedence Overview: `?layout=<file>` > `theme.json.layout` > `theme.mount`.

### Widget primitif & props

| Widget | Props | Perilaku |
|---|---|---|
| `value` | `bind`, opsional `label`/`unit` | label + angka + satuan |
| `bar` | `bind` | nilai terhadap `scaleKey` registry |
| `sparkline` | `bind` | 60 sampel terakhir dari `ctx.hist(key)` |
| `gauge` | `bind`, opsional `max` | arc; skala `max` atau `ctx.max(key)` |

Semua widget menampilkan `unavailable` + tooltip `registry.reason` bila nilai
tidak tersedia. Tambah widget sendiri:

```js
Noterra.addWidget("my-widget", {
  mount(el, props, ctx){ /* bangun DOM sekali */ },
  update(el, props, ctx){ /* refresh tiap snapshot */ },
});
```

## L3 — theme JavaScript

```js
window.Noterra.addTheme("mytheme", {
  mount(root, ctx){ /* bangun DOM sekali */ },
  update(ctx){ /* refresh dari ctx.data / ctx.registry / ctx.hist */ },
  chips(ctx){ /* opsional: status recording berubah */ },
});
```

Theme bisa mendaftarkan widget komposit sendiri (contoh:
`themes/default/overview.js` → `cpu-panel`, `gpu-panel`, `memory-panel`,
`storage-panel`, `rail`) lalu memakainya di `layout.json`.

### `ctx` (kontrak stabil)

- `ctx.data` — nilai snapshot terkini (scalar, array `pu/pf/pt/eu/ef/et`,
  per-drive `r0/w0/...`).
- `ctx.registry` — `Map` key → `{key, kind, label, unit, digits, source,
  scaleKey, available, reason, value}`; entri `kind:"drive"` (`dev`, `name`,
  `link`, `mount`, …); `gpuPresent` menandai GPU terdeteksi.
- `ctx.hist(key)` — ring buffer 60 sampel; `ctx.max(key)` — peak nyata.
- `ctx.reasons` — alasan unavailable mentah dari `/api/health`.
- `ctx.fmt` — `fx/val/esc/mmss/clamp/avg`; `ctx.mk(html)`.
- `ctx.online`, `ctx.recording`, `ctx.mock`, `ctx.snap`, `ctx.drives`.
- `ctx.on("update"|"offline", fn)` — hook headless; `update` setelah snapshot
  baru, `offline` saat fetch gagal.

## L4 — headless

```html
<script src="../core/client.js"></script>
<script>
  const N = window.Noterra, C = N.ctx;
  C.on("update", () => console.log(C.data.cpuT, C.data.gT, C.data.gW));
  N.loadSchema().then(() => N.start());
</script>
```

Contoh utuh: `web/examples/headless.html` (tiga nilai live). `client.js` tidak
menyentuh DOM; `start()` idempoten.

## `theme.json`

```json
{"name":"mytheme","author":"...","version":"1.0",
 "palettes":["light","dark"],
 "entry":"overview.js","css":"theme.css","layout":"layout.json"}
```

- `entry` opsional (default `overview.js` bila file itu ada); tanpa `entry`
  dan dengan `layout`, core memakai jalur L2.
- `css` opsional (default `theme.css`).
- `layout` opsional; kalau ada, menang atas `mount` (precedence `?layout` >
  `theme.json.layout` > `mount`).

Server `GET /api/themes` memindai `web/themes/*/theme.json` dan meneruskan
`entry`, `css`, `layout` (tidak menjalankan script theme).

## View registry

```js
Noterra.addView("log", {label:"Log", order:10, mount(root, ctx){...}, update(ctx){...}});
```

- Nav dibangun dari view terdaftar, diurutkan `order` (Overview 0, Log 10).
- `overview` didaftarkan oleh `addTheme`; `log` didaftarkan shell.
- Theme boleh override `log` dengan `addView("log", {...})`.

## id DOM wajib dari `index.html`

`#nav` (nav + tombol view + `#theme` + `#status`), `#root` (tempat view
di-mount), `#theme` (select palette), `#status` (teks backend). Id tab Log
(`#iv`, `#lb`, `#tg`, `#tm`, `#mk`, `#rc`, `#ex`, `#asub`, `#an`, `#mt`,
`#tr`, `#gp`, `#ov`) dibuat shell saat tab Log dirender.

## `core.css` — kelas & variabel fallback

Kelas: `.btn` (`.btn.on`, `:disabled`), `.p`, `.tag`, `.bar-top`, `.stack`,
`.ctl`, `.hint` (`.hint.warn`), `.empty`, `.grow`, `.sub`, `.fld`, `.timer`,
`table/th/td`, `tr.grp`, `svg.sp`, `svg path.l`, `.layout`, `.layout-host`,
`.w`, `.w-value`, `.w-bar`, `.w-spark`, `.w-gauge`, `.w-missing`,
`.layout-error`.
Token: `--a --b --ok --warn --bad --bg --surface --line --ink --mute` (dipakai
lewat `var(--x, fallback)`).

## `/api/schema`

`GET /api/schema` dan `/api/mock/schema` mengembalikan
`server/metrics_meta.json`: `key → {label, unit, digits, source, scaleKey?}`.
Core mem-fetch sekali saat start; key tanpa schema tetap masuk registry dengan
`label = key`. Metrik baru cukup ditambah di adapter/snapshot + schema.

## test tanpa hardware

Buka `/index.html?mock=1` (data `server/fixtures/snapshot-sample.json`), atau
`?theme=minimal&mock=1` untuk contoh L2. Test: `cd tests && npm test`.
`node check-layout.mjs <widget...>` untuk cek komposit layout.

## peringatan

**Pasang theme hanya dari sumber yang dipercaya.** Script theme dieksekusi
sepenuhnya di browser dan mendapat akses penuh ke DOM, localStorage, dan
seluruh data yang dikirim core. `/api/themes` hanya daftar — isi script tidak
diverifikasi core.
