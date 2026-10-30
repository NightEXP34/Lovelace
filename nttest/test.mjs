import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
const html = readFileSync("../noterra/index.html", "utf8");
const base = JSON.parse(readFileSync("../noterra/snapshot-sample.json", "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(window) {
    let i = 0;
    window.matchMedia = () => ({ matches: false });
    const HEALTH = { ok: true, nvml: false, items: {
      cpuThr: "belum ada sumber throttle CPU di mesin ini",
      cpuW: "RAPL energy_uj tidak terbaca tanpa privileges: file mode 0400",
      fan: "NVML NotSupported: kipas laptop diatur EC",
      pl1: "constraint RAPL belum dibaca" } };
    const CSV_TEXT = "timestamp_ms,cpu_temp_c,cpu_power_w,gpu_temp_c,gpu_power_w,vram_bw_gbs,pcie_rx_gbs,mem_major_faults_s,nvme0_read_mbps\n" +
      Array.from({ length: 12 }, (_, i) => `1793000000000,${60 + i}.000,,61.000,15.000,0.000,0.164,10.000,0.000`).join("\n") + "\n";
    let recStarted = false, recStopped = false;
    const SESSION = { id: 1793000000000, label: "rec-test", tag: "none", iv: 1,
      start_ms: Date.now(), started_iso: "2026-10-30T10:26:56+0700" };
    window.fetch = async (u, opts) => {
      const url = String(u), method = (opts && opts.method) || "GET";
      if (url.includes("/api/health")) return { ok: true, json: async () => HEALTH };
      if (url.includes("/api/log/start")) { recStarted = true; return { ok: true, json: async () => ({ id: SESSION.id, dir: "logs/test" }) }; }
      if (url.includes("/api/log/stop")) { recStopped = true; return { ok: true, json: async () => ({ id: SESSION.id, status: "saved", samples: 12 }) }; }
      if (url.includes("/api/log/marker")) return { ok: true, json: async () => ({ id: SESSION.id, markers: [{ ts_ms: 1, since_s: 1.5, note: "" }] }) };
      if (url.includes("/api/log/sessions")) {
        const s = { ...SESSION, status: recStopped ? "saved" : "recording",
          samples: recStopped ? 12 : 3, markers: [] };
        return { ok: true, json: async () => ({ sessions: recStarted ? [s] : [] }) };
      }
      if (url.includes("samples.csv")) return { ok: true, text: async () => CSV_TEXT };
      i++;
      return { ok: true, json: async () => ({ ...base, majF: (base.majF ?? 20) + i * 7, cpuU: (base.cpuU ?? 10) + i, r0: (base.r0 ?? 0) + i, gT: 60 + i, gW: 50 + i }) };
    };
  } });
const w = dom.window, d = w.document;
const fail = m => { console.error("FAIL:", m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); console.log("ok:", m); };
await sleep(2200);   // two sample ticks + one health fetch, so tooltips are filled from /api/health
ok(d.querySelector("#status").textContent.includes("live"), "backend live after first fetch");
ok(d.querySelectorAll(".pc .cr").length === base.pu.length, `P-core rows dynamic (${base.pu.length})`);
ok(d.querySelectorAll(".ec .cr").length === base.eu.length, `E-core rows dynamic (${base.eu.length})`);
const dls = [...d.querySelectorAll(".p dd")].map(x => x.textContent);
ok(dls.some(t => t === "powersave"), "governor row shows real snap value");
const clocks = [...base.pf, ...base.ef, base.pfa].filter(v => typeof v === "number");
ok(clocks.length > 0, `clock values present (${clocks.length})`);
ok(clocks.every(v => v >= 0.39 && v <= 5.5), `all clocks in plausible GHz range 0.39..5.5 (scaling_min=0.4 GHz, kHz rounding; max ${Math.max(...clocks).toFixed(2)})`);
const rowGHz = [...d.querySelectorAll(".pc .cr")].map(r => r.children[1].textContent);
ok(rowGHz.every(t => /\d+\.\d{2} GHz$/.test(t)), "core rows render GHz from kHz source (no MHz-as-GHz bug)");
const bigs = [...d.querySelectorAll(".big div b")].map(x => x.textContent);
ok(bigs.every(t => !t.includes("undefined")), `no "undefined" units in stat cards (${bigs.filter(t=>t.includes("undefined")).length} found)`);
const idleCards = bigs.filter(t => /\bidle\b/.test(t));
if (base.a0Idle || base.a1Idle) ok(idleCards.length > 0, `drive with no I/O renders "idle" (${idleCards.length} card)`);
ok(bigs.filter(t => t.includes("IOPS")).length >= 2, "IOPS unit label present on both drives");
ok(d.querySelectorAll("svg.sp path").length > 0, "sparkline paths rendered from history");
ok(dls.some(t => t.startsWith("unavailable")), "unavailable metrics rendered honestly");
ok(d.querySelector(".p .sub").textContent.includes("i7-13620H"), "CPU subtitle from real model name");
const subs = [...d.querySelectorAll("#g .p .sub")].map(x => x.textContent);
ok(subs.some(t => t.includes("RTX 4060")), "GPU subtitle from nvmlDeviceGetName");
ok(subs.some(t => t.startsWith("kernel ")), "Memory subtitle = kernel only (driver moved to GPU panel)");
ok(dls.some(t => t === base.snap.gpuDriver), "NVIDIA driver version rendered in GPU panel");
const card = [...d.querySelectorAll(".big div")].find(x => x.querySelector("span").textContent === "Package power");
ok(card && card.querySelector("b").textContent === "unavailable" && card.querySelector(".na"),
   "unavailable in stat card: text only, small/dim span, no unit");
ok(card.querySelector("b").getAttribute("title").includes("RAPL"), "stat card tooltip carries /api/health reason");
const dlRows = [...d.querySelectorAll(".p dl")].flatMap(dl =>
  [...dl.children].reduce((acc, el, i) => (i % 2 === 0 ? acc.push([el.textContent, dl.children[i + 1]]) : acc, acc), []));
const thRow = dlRows.find(([t]) => t === "Throttle");
if (base.cpuThr != null) ok(thRow[1].textContent === base.cpuThr, `Throttle row shows real sysfs value (${base.cpuThr})`);
else ok(thRow[1].classList.contains("dd-na") && thRow[1].getAttribute("title").includes("throttle"),
   "unavailable dl row rendered dim + tooltip reason from /api/health");
const raRows = dlRows.filter(([t]) => t === "Readahead").map(([, dd]) => dd.textContent);
if (base.drives[0].readahead != null)
  ok(raRows.every(t => /KB$/.test(t)), `readahead rows show real KB values (${raRows.join(", ")})`);
const capRows = dlRows.filter(([t]) => t === "Capacity used").map(([, dd]) => dd.textContent);
ok(capRows.some(t => t === "not mounted") && capRows.some(t => /%$/.test(t)),
  `unmounted drive renders "not mounted", mounted shows % (${capRows.join(" | ")})`);
const plRow = dlRows.find(([t]) => t === "PL1 / PL2");
if (base.pl1 != null) ok(plRow[1].textContent.includes("PL1") && plRow[1].textContent.includes("PL2"),
  `PL1/PL2 row shows real constraint watts (${plRow[1].textContent})`);
else ok(plRow[1].getAttribute("title").includes("constraint"), "PL1/PL2 row tooltip explains why unavailable");
d.querySelectorAll("nav button")[1].click();
await sleep(400);   // renderLog async: menunggu fetch sessions dulu
ok(d.querySelector("#rc"), "log controls rendered");
ok(d.body.textContent.includes("No logs yet"), "empty log state");
d.querySelector("#rc").click();
await sleep(2400);
ok(d.body.textContent.includes("recording"), "recording session listed from server");
d.querySelector("#rc").click();
await sleep(600);
ok(d.body.textContent.includes("1 tersimpan di server"), "session persisted on server with samples");
ok(d.body.textContent.includes("Mean"), "statistics table shown");
ok(d.body.textContent.includes("65.5"), "mean CPU temp computed from server CSV (60..71 → mean 65.5)");
w.URL.createObjectURL = () => "blob:fake";
let clicked = false;
w.HTMLAnchorElement.prototype.click = function () { clicked = true; };
d.querySelector("#ex").click();
await sleep(400);   // exportCsv async: fetch CSV dari server dulu
ok(clicked, "CSV export triggered");
console.log("ALL PASS");
process.exit(0);
