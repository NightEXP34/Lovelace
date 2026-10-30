/* Smoke test web/ (core + theme default): DOM overview hasil render harus SAMA
   dengan noterra/index.html sebelum refactor, tab Log identik, dan assertions
   fungsional (registry dinamis, hardware lain tanpa GPU, mock tidak dipakai di
   sini — fetch di-stub persis seperti test.mjs lama). */
import pkg from "jsdom";
const { JSDOM, requestInterceptor } = pkg;
import { readFileSync } from "fs";
import path from "path";

const OLD = readFileSync("../noterra/index.html", "utf8");
const SHELL = readFileSync("../web/index.html", "utf8");
const base = JSON.parse(readFileSync("../noterra/snapshot-sample.json", "utf8"));
const SCHEMA = JSON.parse(readFileSync("../noterra/metrics_meta.json", "utf8"));
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
const capture = d => ({
  theme: d.documentElement.dataset.theme || "",
  nav: d.querySelector("#nav").innerHTML,
  root: d.querySelector("#root").innerHTML,
});

/* alur sama di kedua harness: overview → log → recording → stop → export → overview */
async function runSequence(html, wopts) {
  const dom = domFor(html, wopts);
  const d = dom.window.document;
  await sleep(2200);
  const caps = [{ kind: "overview", ...capture(d) }];
  d.querySelectorAll("nav button")[1].click();
  await sleep(400);
  caps.push({ kind: "log", ...capture(d) });
  d.querySelector("#rc").click();
  await sleep(2400);
  caps.push({ kind: "log-rec", ...capture(d) });
  d.querySelector("#rc").click();
  await sleep(600);
  caps.push({ kind: "log-saved", ...capture(d) });
  dom.window.URL.createObjectURL = () => "blob:fake";
  let clicked = false;
  dom.window.HTMLAnchorElement.prototype.click = function () { clicked = true; };
  d.querySelector("#ex").click();
  await sleep(400);
  caps.push({ kind: "log-export", ...capture(d) });
  d.querySelectorAll("nav button")[0].click();
  await sleep(1200);   // melewati satu tick sukses di kedua harness agar status deterministik
  caps.push({ kind: "overview-2", ...capture(d) });
  return { dom, caps, clicked };
}

function compare(a, b, label) {
  if (a.theme !== b.theme) fail(`${label}: theme "${a.theme}" vs "${b.theme}"`);
  for (const k of ["nav", "root"]) {
    if (a[k] !== b[k]) {
      const i = firstDiff(a[k], b[k]);
      console.error(`diff di ${k} (offset ${i}, panjang lama ${a[k].length} baru ${b[k].length})\n--- lama: ${a[k].slice(Math.max(i - 60, 0), i + 160)}\n--- baru: ${b[k].slice(Math.max(i - 60, 0), i + 160)}`);
      fail(`${label}: DOM ${k} tidak sama dengan sebelum refactor`);
    }
  }
  console.log(`ok: ${label} identik`);
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

const oldRun = await runSequence(OLD, {});
const newRun = await runSequence(SHELL, { resources: { interceptors: [fileInterceptor] } });
if (oldRun.clicked !== newRun.clicked) fail("CSV export trigger berbeda");
ok(newRun.clicked, "CSV export tetap dipicu dari tab Log (milik core)");
newRun.caps.forEach((c, i) => compare(oldRun.caps[i], c, `capture ${i} (${c.kind})`));
newRun.dom.window.close(); oldRun.dom.window.close();

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
const gpuPanel = [...d.querySelectorAll(".p")].find(p => p.querySelector("h2").textContent === "GPU");
ok([...gpuPanel.querySelectorAll(".cp")].length === 4, "chip throttle GPU 4 slot");
const tlExpect = 1 + (base.snap.gpuPresent ? 4 : 0) + 1 + base.drives.length;
ok(d.querySelectorAll("#tl .tr").length === tlExpect, `timeline rail dinamis (${tlExpect} baris)`);
ok([...d.querySelectorAll("#tl .tr b")].map(x => x.textContent).every(t => !t.includes("undefined")), "timeline tanpa 'undefined'");
ok([...d.querySelectorAll("#sys dd")].map(x => x.textContent).includes(base.snap.kernel), "System rail dari nilai snapshot nyata");
ok(d.querySelector("#hint span").textContent.includes("aturan"), "hint bottleneck menyebut aturan");
const subs = [...d.querySelectorAll(".p header span")].map(x => x.textContent);
ok(subs.some(t => t.includes("RTX 4060")), "subtitle GPU dari nvmlDeviceGetName");
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
const altOld = await runSequence(OLD, { snapshot: alt });
const altNew = await runSequence(SHELL, { resources: { interceptors: [fileInterceptor] }, snapshot: alt });
altNew.caps.forEach((c, i) => compare(altOld.caps[i], c, `alt hardware capture ${i}`));
const d2 = altNew.dom.window.document;
const panels2 = [...d2.querySelectorAll(".p h2")].map(h => h.textContent);
ok(!panels2.includes("GPU") && panels2.length === 3, `panel GPU tidak dibangun tanpa gpuPresent (${panels2.join(", ")})`);
ok(d2.querySelectorAll("#tl .tr").length === 5, "timeline tanpa GPU: cpu + majF + 3 drive");
const sto2 = [...d2.querySelectorAll(".p")].find(p => p.querySelector("h2").textContent === "Storage");
ok(sto2.querySelectorAll(".bars .br").length === 6, "bar dinamis per drive dari registry (6 baris)");
ok([...d2.querySelectorAll(".br em")].map(x => x.textContent).some(t => t === "not mounted"), "'not mounted' tetap tampil");
ok([...d2.querySelectorAll(".p dl.tb dd")].some(x => x.classList.contains("dd-na")), "dd-na untuk nilai tanpa sumber");
ok([...altNew.dom.window.Noterra.registry.values()].filter(e => e.kind === "drive").map(e => e.dev).join(",") === "sda,sdb,sdc",
  "registry drive mengikuti hardware lain (sda,sdb,sdc)");
altNew.dom.window.close(); altOld.dom.window.close();

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

let customLog = false;
N.addView("log", { label: "Log", order: 10, mount(root) {
  customLog = true; root.innerHTML = '<div id="custom-log">log versi theme</div>';
} });
[...d.querySelectorAll("nav button")].find(b => b.dataset.p === "log").click();
await sleep(80);
ok(customLog && d.querySelector("#custom-log")?.textContent.includes("versi theme"), "theme bisa override view log");

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
