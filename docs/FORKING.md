# FORKING — bikin UI sendiri di noterra

Panduan 1 halaman untuk fork (mis. optimisasi game). Tidak perlu menyentuh
`shell.js`/`client.js` untuk kustomisasi biasa.

## 0. Jalankan dulu

```bash
cd noterra
.venv/bin/python server.py          # http://127.0.0.1:5130
```

Buka `http://127.0.0.1:5130/?mock=1` — data dari
`noterra/snapshot-sample.json`, tanpa hardware. Untuk mesin nyata buka tanpa
`?mock=1`. UI yang diserve adalah `web/index.html` (bukan
`noterra/index.html`; file itu UI lama di `/legacy`).

## 1. Copy theme contoh

```bash
cp -r web/themes/minimal web/themes/game
```

`minimal/` hanya berisi `theme.json`, `layout.json`, `theme.css` — **tanpa
JavaScript**.

## 2. Ganti nama theme

`web/themes/game/theme.json`:

```json
{"name":"game","author":"nama kamu","version":"1.0",
 "palettes":["light","dark"],"layout":"layout.json"}
```

Buka `http://127.0.0.1:5130/?theme=game&mock=1`.

## 3. Atur layout (L2, tanpa JS)

Edit `web/themes/game/layout.json`:

```json
{"cols":12,"gap":10,"items":[
  {"widget":"value","bind":"cpuT","x":0,"y":0,"w":3,"h":1},
  {"widget":"bar","bind":"cpuU","x":3,"y":0,"w":3,"h":1}
]}
```

- Widget siap pakai: `value`, `bar`, `sparkline`, `gauge`.
- `bind` = key di `ctx.registry`/snapshot. Lihat key yang ada di
  `http://127.0.0.1:5130/api/schema`.
- `x,y` 0-based; `w,h` span; `cols` default 12.
- Key/widget salah tidak bikin crash: muncul `unavailable` atau placeholder.

## 4. Ganti warna (L1)

Edit `web/themes/game/theme.css`:

```css
:root{--bg:#f7f8fa;--surface:#fff;--ink:#181b20;--a:#2563eb;--bad:#dc2626}
[data-theme="dark"]{--bg:#111318;--surface:#191c22;--ink:#e8eaf0}
```

`core.css` sudah menyediakan fallback untuk tab Log dan widget; theme tidak
wajib menulis semuanya.

## 5. Tambah metrik (adapter/schema)

Core tidak punya daftar metrik hardware yang hardcoded. Untuk metrik baru
(mis. FPS game):

1. Tambahkan key ke JSON snapshot backend/adapter, mis. `"fps": 144.0`
   (atau `null` kalau memang tidak ada — jangan mengarang angka).
2. Tambahkan entri di `noterra/metrics_meta.json`:

```json
"fps": {"label":"FPS","unit":"fps","digits":0,"source":"game adapter"}
```

3. Restart server. Key otomatis masuk registry dengan label/satuan/skala itu;
   pakai `{"widget":"value","bind":"fps"}` di layout.
4. Metrik yang tidak tersedia tampil `unavailable` + alasan dari
   `/api/health` (tambahkan alasan di collector bila perlu).

## 6. Kalau butuh JS (L3)

Buat `web/themes/game/overview.js`:

```js
window.Noterra.addTheme("game", {
  mount(root, ctx){ root.innerHTML = "<div class='p'><h2>Game</h2></div>"; },
  update(ctx){ /* baca ctx.data / ctx.registry / ctx.hist */ },
});
```

Tambahkan `"entry":"overview.js"` ke `theme.json` (atau biarkan default).
Theme hanya membaca `ctx`; jangan fetch/parse data sendiri.

## 7. Headless (L4)

Kalau ingin UI framework lain, pakai `web/core/client.js` saja — lihat
`web/examples/headless.html`. Tidak ada DOM di client:

```js
const N = window.Noterra, C = N.ctx;
C.on("update", () => console.log(C.data.fps));
N.loadSchema().then(() => N.start());
```

## 8. Tes sebelum push

```bash
cd nttest
node test-web.mjs     # UI web/ + theme minimal + widget/layout
node test.mjs         # UI lama (pembanding)
```

Jangan menambah dependency baru; jsdom dan `.venv` sudah tersedia.
