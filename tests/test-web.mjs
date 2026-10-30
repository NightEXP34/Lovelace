/* Smoke test web/ (client + shell + theme default): render Overview, Storage
   tab, Log, widget/layout, theme minimal, dan simulasi hardware lain tanpa GPU.
   Fetch di-stub (tanpa hardware, tanpa server). */
import pkg from "jsdom";
const { JSDOM, requestInterceptor } = pkg;
import { readFileSync } from "fs";
import path from "path";

const SHELL = readFileSync("../web/index.html", "utf8");
const base = JSON.parse(readFileSync("../server/fixtures/snapshot-sample.json", "utf8"));
const SCHEMA = JSON.parse(readFileSync("../server/metrics_meta.json", "utf8"));
const WEB = path.resolve("../web");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error("FAIL:", m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); console.log("ok:", m); };

/* jsdom 30: muat aset web/ lewat requestInterceptor, bukan ResourceLoader */
const fileInterceptor = requestInterceptor(request => {
  const p = new URL(request.url).pathname;
  try {
    const body = readFileSync(path.join(WEB, p), "utf8");
    return new Response(body, { status: 200, headers: { "content-type": p.endsWith(".css") ? "text/css" : "text/javascript" } });
  } catch {
    return new Response("", { status: 404 });
  }
});

const HEALTH = { ok: true, nvml: false, items: {
  cpuThr: "belum ada sumber throttle CPU di mesin ini",
  cpuW: "RAPL energy_uj tidak terbaca tanpa privileges: file mode 0400",
  fan: "NVML NotSupported: kipas laptop diatur EC",
  pl1: "constraint RAPL belum dibaca",
  ramBW: "PMU IMC ada tapi perf diblokir kernel.perf_event_paranoid=4",
  pcieGen: "NVML dan sysfs tidak terbaca",
  cpuT: "hwmon coretemp tidak terbaca" } };
const CSV_TEXT = "timestamp_ms,cpu_temp_c,cpu_power_w,gpu_temp_c,gpu_power_w,vram_bw_gbs,pcie_rx_gbs,mem_major_faults_s,nvme0_read_mbps\n" +
  Array.from({ length: 12 }, (_, i) => `1793000000000,${60 + i}.000,,61.000,15.000,0.000,0.164,10.000,0.000`).join("\n") + "\n";
const SESSION = { id: 1793000000000, label: "rec-test", tag: "none", interval_s: 1,
  start_ms: Date.now(), started_iso: "2026-10-30T10:26:56+0700",
  config: { governor: "powersave", epp: "balance_performance", turbo: "on",
    swappiness: "60", kernel: "7.0.0-38-generic", sysctl: { "vm.swappiness": "60" } } };

/* stub fetch identik per harness: hanya /api/snapshot yang menaikkan counter i */
function installFetch(w, snapshotFn) {
  let i = 0, recStarted = false, recStopped = false;
  w.matchMedia = () => ({ matches: false });
  w.fetch = async (u, opts) => {
    const url = String(u), method = (opts && opts.method) || "GET";
    if (url.includes("/api/schema") || url.includes("/api/mock/schema")) return { ok: true, json: async () => SCHEMA };
    if (url.includes("/api/themes")) return { ok: true, json: async () => ({ themes: [
      { name: "default", entry: "overview.js", palettes: ["light", "dark"] },
      { name: "minimal", entry: null, layout: "layout.json", palettes: ["light", "dark"] }] }) };
    if (url.includes("/api/health") || url.includes("/api/mock/health")) return { ok: true, json: async () => HEALTH };
    if (url.includes("themes/")) {
      try { return { ok: true, text: async () => readFileSync(path.join(WEB, new URL(url, "http://localhost/").pathname), "utf8") }; }
      catch { return { ok: false }; }
    }
    if (url.includes("/api/mock/snapshot")) return { ok: true, json: async () => base };
    if (url.includes("/api/log/start")) { recStarted = true; return { ok: true, json: async () => ({ id: SESSION.id, dir: "logs/test" }) }; }
    if (url.includes("/api/log/stop")) { recStopped = true; return { ok: true, json: async () => ({ id: SESSION.id, status: "saved", samples: 12 }) }; }
    if (url.includes("/api/log/marker")) return { ok: true, json: async () => ({ id: SESSION.id, markers: [{ ts_ms: 1, since_s: 1.5, note: "" }] }) };
    if (url.includes("/api/log/sessions")) {
      const s = { ...SESSION, status: recStopped ? "saved" : "recording",
        samples: recStopped ? 12 : 3, markers: [] };
      return { ok: true, json: async () => ({ sessions: recStarted ? [s] : [] }) };
    }
    if (url.includes("samples.csv")) return { ok: true, text: async () => CSV_TEXT };
    if (snapshotFn) return { ok: true, json: async () => snapshotFn };
    i++;
    return { ok: true, json: async () => ({ ...base, majF: (base.majF ?? 20) + i * 7, cpuU: (base.cpuU ?? 10) + i, r0: (base.r0 ?? 0) + i, gT: 60 + i, gW: 50 + i }) };
  };
}

function domFor(html, wopts) {
  return new JSDOM(html, { url: wopts.url || "http://localhost/", runScripts: "dangerously",
    pretendToBeVisual: true, resources: wopts.resources,
    beforeParse(w) { installFetch(w, wopts.snapshot); } });
}
/* ---- assertions fungsional pada web/ baru ---- */
const dom = domFor(SHELL, { resources: { interceptors: [fileInterceptor] } });
const d = dom.window.document;
await sleep(2200);
const N = dom.window.Noterra;
ok(N && N.registry && N.registry.size > 0, "core membangun registry dari snapshot nyata");
ok(N.registry.get("cpuT") && N.registry.get("cpuT").label === "CPU temp" && N.registry.get("cpuT").unit === "°C",
  "registry punya label/satuan/sumber (cpuT)");
ok(N.registry.get("cpuW") && N.registry.get("cpuW").scaleKey === "pl1" && !N.registry.get("cpuW").available
  && N.registry.get("cpuW").reason.includes("RAPL"), "registry: cpuW unavailable + alasan + skala pl1");
ok([...N.registry.values()].filter(e => e.kind === "drive").length === base.drives.length,
  `entri drive registry mengikuti /sys/block (${base.drives.length})`);
ok(N.registry.get("gpuPresent")?.available === true, "gpuPresent tersedia dari snapshot");
ok(d.querySelector("#status").textContent.includes("live"), "backend live setelah fetch pertama");
const nCores = (base.pu || []).length + (base.eu || []).length;
ok(d.querySelectorAll(".cc").length === nCores, `core cell dinamis dari registry (${nCores})`);
ok([...d.querySelectorAll(".stats b")].map(x => x.textContent).every(t => !t.includes("undefined")), "stat cards tanpa 'undefined'");
const cpuPanel = [...d.querySelectorAll(".p")].find(p => p.querySelector("h2").textContent === "CPU");
ok(cpuPanel.querySelector(".gw svg")?.getAttribute("title").includes("RAPL"), "tooltip gauge dari alasan health");
ok(cpuPanel.querySelector(".gw svg .v") && cpuPanel.querySelector(".gw svg .w"), "gauge CPU punya ring luar + ring dalam");
const coreClocks = [...d.querySelectorAll(".cc u")].map(x => x.textContent);
const realClocks = [...(base.pf || []), ...(base.ef || [])].filter(v => typeof v === "number");
ok(coreClocks.filter(t => /^\d+\.\d{2}$/.test(t)).length === nCores, "core cell render GHz dengan 2 desimal");
ok(realClocks.every(v => v >= 0.39 && v <= 5.5), `semua clock di rentang 0.39..5.5 GHz (max ${Math.max(...realClocks).toFixed(2)})`);
ok(d.querySelectorAll(".cores > div:not(.hint2)").length === 2, "P dan E dipisah dua baris");
const gpuPanel = [...d.querySelectorAll(".p")].find(p => p.querySelector("h2").textContent === "GPU");
const chips = [...gpuPanel.querySelectorAll(".cp")].map(x => x.textContent);
ok(chips.length === 4, "chip throttle GPU 4 slot");
if (base.thrIdle != null) ok(chips.every(t => !t.includes("—")), "chip NVML throttle bits terbaca (tidak '—')");
else ok(chips.some(t => t.includes("—")), "chip throttle tampil '—' saat NVML gagal");
const tlExpect = 1 + (base.snap.gpuPresent ? 4 : 0) + 1 + base.drives.length;
ok(d.querySelectorAll("#tl .tr").length === tlExpect, `timeline rail dinamis (${tlExpect} baris)`);
ok([...d.querySelectorAll("#tl .tr b")].map(x => x.textContent).every(t => !t.includes("undefined")), "timeline tanpa 'undefined'");
ok(d.querySelectorAll("#ev .ev").length === 6, "events rail 6 slot");
ok([...d.querySelectorAll("#sys dd")].map(x => x.textContent).includes(base.snap.kernel), "System rail dari nilai snapshot nyata");
ok(d.querySelector("#hint span").textContent.includes("aturan"), "hint bottleneck menyebut aturan");
const subs = [...d.querySelectorAll(".p header span")].map(x => x.textContent);
ok(subs.some(t => t.includes("RTX 4060")), "subtitle GPU dari nvmlDeviceGetName");
ok(subs.some(t => t.startsWith("kernel ")), "subtitle Memory = kernel saja");
const gpuDd = [...gpuPanel.querySelectorAll("dd")].map(x => x.textContent);
ok(gpuDd.includes(base.snap.gpuDriver), "versi NVIDIA driver tampil di panel GPU");

/* nilai nyata di dl/bar (port assertion test.mjs) */
const dlRowsMain = [...d.querySelectorAll(".p dl")].flatMap(dl =>
  [...dl.children].reduce((acc, el, i) => (i % 2 === 0 ? acc.push([el.textContent, dl.children[i + 1]]) : acc, acc), []));
const thRow = dlRowsMain.find(([t]) => t === "Throttle");
if (base.cpuThr != null) ok(thRow[1].textContent === base.cpuThr, `Throttle CPU row = nilai sysfs nyata (${base.cpuThr})`);
else ok(thRow[1].classList.contains("dd-na") && thRow[1].getAttribute("title").includes("throttle"),
  "dl row Throttle unavailable + tooltip alasan");
if (base.pl1 != null) ok(dlRowsMain.find(([t]) => t === "PL1 / PL2")[1].textContent.includes("PL1"),
  "PL1/PL2 nyata tampil");
else ok(dlRowsMain.find(([t]) => t === "PL1 / PL2")[1].getAttribute("title").includes("constraint"),
  "PL tooltip alasan constraint");
ok(dlRowsMain.filter(([t]) => t === "Readahead").every(([, dd]) => /KB$/.test(dd.textContent)), "readahead nyata KB");
const raEmMain = [...d.querySelectorAll(".br em")].map(x => x.textContent);
ok(raEmMain.some(t => t === "not mounted"), "drive tanpa mount tampil 'not mounted'");
ok(raEmMain.some(t => /% of /.test(t)), "drive mounted tampil persen kapasitas nyata");
if (base.ramBW == null) {
  const bw = dlRowsMain.find(([t]) => t === "Measured bandwidth")[1];
  ok(bw.classList.contains("dd-na") && bw.getAttribute("title").includes("perf"),
    "measured RAM bandwidth unavailable + tooltip perf");
}
ok(d.querySelector("#theme").options.length === 2 && d.querySelector("#theme").value === "light",
  "palette light/dark dari theme.json + prefers-color-scheme");

/* ---- simulasi hardware lain: tanpa GPU, 3 drive SATA ---- */
const alt = { ...base, snap: { ...base.snap, gpuPresent: false, nvml: false },
  gT: null, gW: null, gU: null, prx: null, gLim: null, thr: null, thrIdle: null,
  drives: [
    { dev: "sda", name: "Seagate Barracuda", sizeGB: 1000.2, link: null, linkMax: null, sched: "mq-deadline", readahead: "128 KB", capUsed: 71.2, mount: "/mnt/data" },
    { dev: "sdb", name: "WD Green", sizeGB: 500.1, link: null, linkMax: null, sched: "mq-deadline", readahead: "128 KB", capUsed: null, mount: null },
    { dev: "sdc", name: null, sizeGB: null, link: null, linkMax: null, sched: null, readahead: null, capUsed: null, mount: null }],
  r2: 12.4, w2: 3.1, i2: 220, a2: 4.2, a2Idle: false, u2: 8, q2: 1, t2: null };
const altDom = domFor(SHELL, { resources: { interceptors: [fileInterceptor] }, snapshot: alt });
const d2 = altDom.window.document;
await sleep(2200);
const panels2 = [...d2.querySelectorAll(".p h2")].map(h => h.textContent);
ok(!panels2.includes("GPU") && panels2.length === 3, `panel GPU tidak dibangun tanpa gpuPresent (${panels2.join(", ")})`);
ok(d2.querySelectorAll("#tl .tr").length === 5, "timeline tanpa GPU: cpu + majF + 3 drive");
const sto2 = [...d2.querySelectorAll(".p")].find(p => p.querySelector("h2").textContent === "Storage");
ok(sto2.querySelectorAll(".bars .br").length === 6, "bar dinamis per drive dari registry (6 baris)");
const tb2 = [...d2.querySelectorAll(".p dl.tb")];
ok(tb2.length === 1 && tb2[0].querySelectorAll("dt.h").length === 3, "tabel drive dinamis: 3 kolom mengikuti /sys/block");
const tbVals = [...tb2[0].querySelectorAll("dd")].map(x => x.textContent);
ok(tbVals.some(t => t === "Seagate Barracuda"), "model drive nyata per kolom");
ok(!tbVals.includes("undefined") && ![...d2.querySelectorAll(".tr b")].some(t => t.textContent.includes("undefined")),
  "hardware lain: tidak ada 'undefined' di tabel/timeline");
ok([...d2.querySelectorAll(".br em")].map(x => x.textContent).some(t => t === "not mounted"), "'not mounted' tetap tampil");
ok([...d2.querySelectorAll(".p dl.tb dd")].some(x => x.classList.contains("dd-na")), "dd-na untuk nilai tanpa sumber");
ok([...altDom.window.Noterra.registry.values()].filter(e => e.kind === "drive").map(e => e.dev).join(",") === "sda,sdb,sdc",
  "registry drive mengikuti hardware lain (sda,sdb,sdc)");
altDom.window.close();

/* ---- Phase 4: widget registry, layout renderer, view override ---- */
for (const w of ["value", "bar", "sparkline", "gauge"])
  ok(N.widgets.has(w), `widget registry punya "${w}"`);
const host = d.createElement("div");
d.body.append(host);
N.renderLayout(host, { cols: 12, gap: 8, items: [
  { widget: "value", bind: "cpuT", x: 0, y: 0, w: 3, h: 1 },
  { widget: "gauge", bind: "cpuT", x: 3, y: 0, w: 3, h: 2 }] }, N.ctx);
ok(host.querySelector(".w-value .w-num")?.textContent.trim().length > 0, "layout valid: widget value merender angka");
ok(host.querySelector(".w-value .w-label")?.textContent === "CPU temp", "layout valid: label dari schema");
ok(host.querySelector(".w-gauge svg path.w-val")?.getAttribute("d"), "layout valid: gauge menggambar arc");

const missingHost = d.createElement("div");
N.renderLayout(missingHost, { items: [{ widget: "tidak-ada", x: 0, y: 0, w: 2, h: 1 }] }, N.ctx);
ok(missingHost.querySelector(".w-missing")?.textContent.includes("tidak-ada"), "layout: widget tak dikenal jadi placeholder");

const bindHost = d.createElement("div");
N.renderLayout(bindHost, { items: [{ widget: "value", bind: "__tidak_ada__", x: 0, y: 0, w: 2, h: 1 }] }, N.ctx);
ok(bindHost.querySelector(".w-na")?.textContent === "unavailable", "layout: bind tak dikenal tampil unavailable");
ok((bindHost.querySelector(".w-na")?.getAttribute("title") || "").length > 0, "layout: bind tak dikenal punya tooltip alasan");

const badHost = d.createElement("div");
N.renderLayout(badHost, "{bukan json", N.ctx);
ok(badHost.querySelector(".layout-error")?.textContent.includes("tidak valid"), "layout: JSON invalid jadi error box (tidak crash)");

/* ---- PART A regression: Storage tab harus memilih drive yang diklik ---- */
const storage = [...d.querySelectorAll(".p")].find(p => p.querySelector("h2")?.textContent === "Storage");
const stTabs = () => [...storage.querySelectorAll(".ch .tabs button")];
const gaugeText = () => [...storage.querySelectorAll(".gw svg text")].map(t => t.textContent).join(" ");
ok(stTabs().map(b => b.textContent).join(",") === "nvme0n1,nvme1n1",
  "storage: urutan tab sesuai index drive (drive 0 dulu)");
stTabs()[1].click();
await sleep(100);
ok(stTabs()[1]?.getAttribute("aria-pressed") === "true", "storage: tab drive 1 aktif setelah diklik");
ok(stTabs()[1]?.dataset.key === "r1", "storage: chart memakai series drive 1");
ok(gaugeText().includes("drive 1"), "storage: gauge label ikut drive 1");
await sleep(2200);
ok(stTabs()[1]?.getAttribute("aria-pressed") === "true" && stTabs()[1]?.dataset.key === "r1",
  "storage: pilihan drive 1 bertahan setelah 2 tick update");
stTabs()[0].click();
await sleep(100);
ok(stTabs()[0]?.getAttribute("aria-pressed") === "true" && stTabs()[0]?.dataset.key === "r0",
  "storage: klik drive 0 mengembalikan pilihan");
ok(gaugeText().includes("drive 0"), "storage: gauge kembali ke drive 0");

/* ---- tab Log (port assertion test.mjs) ---- */
[...d.querySelectorAll("nav button")].find(b => b.dataset.p === "log").click();
await sleep(400);
ok(d.querySelector("#rc"), "log controls rendered");
ok(d.body.textContent.includes("No logs yet"), "empty log state");
d.querySelector("#rc").click();
await sleep(2400);
ok(d.body.textContent.includes("recording"), "recording session listed from server");
d.querySelector("#rc").click();
await sleep(600);
ok(d.body.textContent.includes("1 tersimpan di server"), "session persisted on server with samples");
ok(d.body.textContent.includes("Mean"), "statistics table shown");
ok(d.body.textContent.includes("65.5"), "mean CPU temp dari CSV server (60..71 → 65.5)");
dom.window.URL.createObjectURL = () => "blob:fake";
let csvClicked = false;
dom.window.HTMLAnchorElement.prototype.click = function () { csvClicked = true; };
d.querySelector("#ex").click();
await sleep(400);
ok(csvClicked, "CSV export triggered");

let customLog = false;
N.addView("log", { label: "Log", order: 10, mount(root) {
  customLog = true; root.innerHTML = '<div id="custom-log">log versi theme</div>';
} });
[...d.querySelectorAll("nav button")].find(b => b.dataset.p === "log").click();
await sleep(80);
ok(customLog && d.querySelector("#custom-log")?.textContent.includes("versi theme"), "theme bisa override view log");

/* ---- layout URL mengalahkan mount theme default ---- */
const lay = domFor(SHELL, { url: "http://localhost/?layout=layout.json",
  resources: { interceptors: [fileInterceptor] } });
const dl = lay.window.document;
await sleep(2200);
ok(dl.querySelectorAll("#root .layout > .w").length === 5, "?layout=layout.json: 5 item komposit");
ok([...dl.querySelectorAll(".p h2")].map(h => h.textContent).join(",") === "CPU,GPU,Memory,Storage",
  "?layout=layout.json: 4 panel dari widget komposit");
ok(dl.querySelectorAll("#tl .tr").length === tlExpect, "?layout=layout.json: rail timeline");
lay.window.close();

/* ---- theme minimal L2 (tanpa JavaScript) di mode mock ---- */
const mini = domFor(SHELL, { url: "http://localhost/?theme=minimal&mock=1",
  resources: { interceptors: [fileInterceptor] } });
const dm = mini.window.document;
await sleep(2200);
const Nm = mini.window.Noterra;
ok(Nm.themeName() === "minimal", "theme minimal dipilih dari ?theme=minimal");
ok(dm.querySelectorAll("#root .layout > .w").length === 4, "minimal: 4 item layout dirender");
ok(!dm.querySelector("#root .layout-error"), "minimal: tanpa error layout");
ok(dm.querySelector(".w-value .w-num")?.textContent.trim().length > 0, "minimal: value dari snapshot mock");
ok(dm.querySelector(".w-gauge svg path.w-val")?.getAttribute("d"), "minimal: gauge dari snapshot mock");
ok(dm.querySelector(".w-bar .w-caption")?.textContent.length > 0, "minimal: bar + caption");
ok(dm.querySelector(".w-spark svg path")?.getAttribute("d"), "minimal: sparkline dari ring buffer");
ok(dm.querySelector("#status").textContent.includes("mock"), "minimal: status mock (client.js + shell.js)");
mini.window.close();

dom.window.close();
console.log("ALL PASS");
process.exit(0);
