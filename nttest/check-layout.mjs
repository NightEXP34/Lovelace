/* Cek cepat layout.json tanpa hardware: render widget yang diminta lewat
   Noterra.renderLayout, pastikan tidak ada layout-error dan panel/teks muncul.
   Pakai: node check-layout.mjs cpu-panel memory-panel ... */
import pkg from "jsdom";
const { JSDOM, requestInterceptor } = pkg;
import { readFileSync } from "fs";
import path from "path";

const WEB = path.resolve("../web");
const base = JSON.parse(readFileSync("../noterra/snapshot-sample.json", "utf8"));
const SCHEMA = JSON.parse(readFileSync("../noterra/metrics_meta.json", "utf8"));
const names = process.argv.slice(2);
const fileInterceptor = requestInterceptor(request => {
  const p = new URL(request.url).pathname;
  try {
    return new Response(readFileSync(path.join(WEB, p), "utf8"), { status: 200, headers: { "content-type": p.endsWith(".css") ? "text/css" : "text/javascript" } });
  } catch { return new Response("", { status: 404 }); }
});
const dom = new JSDOM(readFileSync("../web/index.html", "utf8"), {
  url: "http://localhost/", runScripts: "dangerously", pretendToBeVisual: true,
  resources: { interceptors: [fileInterceptor] },
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false });
    w.fetch = async u => {
      const s = String(u);
      if (s.includes("/api/schema")) return { ok: true, json: async () => SCHEMA };
      if (s.includes("/api/themes")) return { ok: true, json: async () => ({ themes: [{ name: "default", entry: "overview.js", palettes: ["light", "dark"] }] }) };
      if (s.includes("/api/health")) return { ok: true, json: async () => ({ items: {} }) };
      if (s.includes("/api/log/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (s.includes("themes/")) {
        try { return { ok: true, text: async () => readFileSync(path.join(WEB, new URL(s, "http://localhost/").pathname), "utf8") }; }
        catch { return { ok: false }; }
      }
      return { ok: true, json: async () => base };
    };
  }
});
await new Promise(r => setTimeout(r, 2400));
const N = dom.window.Noterra, d = dom.window.document;
const items = names.map((widget, i) => ({ widget, x: (i % 2) * 6, y: Math.floor(i / 2) * 3, w: 6, h: 3 }));
if (names.includes("value")) items.push({ widget: "value", bind: "cpuT", x: 0, y: 9, w: 2, h: 1 });
if (names.includes("bar")) items.push({ widget: "bar", bind: "vram", x: 2, y: 9, w: 2, h: 1 });
if (names.includes("sparkline")) items.push({ widget: "sparkline", bind: "cpuT", x: 4, y: 9, w: 2, h: 1 });
if (names.includes("gauge")) items.push({ widget: "gauge", bind: "cpuT", x: 6, y: 9, w: 2, h: 1 });
const root = d.createElement("div");
N.renderLayout(root, { cols: 12, gap: 8, items }, N.ctx);
d.body.append(root);
const errs = [...root.querySelectorAll(".layout-error")].map(x => x.textContent);
if (errs.length) { console.error("FAIL layout-error:", errs.join(" | ")); process.exit(1); }
const missing = [...root.querySelectorAll(".w-missing")].map(x => x.textContent);
if (missing.length) { console.error("FAIL missing widget:", missing.join(" | ")); process.exit(1); }
let found = 0;
for (const n of names) {
  if (n.endsWith("-panel")) {
    const title = { "cpu-panel": "CPU", "gpu-panel": "GPU", "memory-panel": "Memory", "storage-panel": "Storage" }[n];
    const p = [...root.querySelectorAll(".p")].find(x => x.querySelector("h2")?.textContent === title);
    if (!p) { console.error(`FAIL panel ${n} tidak muncul`); process.exit(1); }
    found++;
  }
}
if (names.includes("rail")) {
  if (!root.querySelectorAll("#tl .tr").length) { console.error("FAIL rail tanpa timeline"); process.exit(1); }
  found++;
}
if (names.includes("value") && !root.querySelector(".w-num")) { console.error("FAIL value kosong"); process.exit(1); }
console.log(`ok: layout ${names.join(",")} (${found} komposit, ${root.querySelectorAll(".w").length} item)`);
dom.window.close();
