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
    window.fetch = async (u) => {
      if (String(u).includes("/api/health")) return { ok: true, json: async () => HEALTH };
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
ok(clocks.every(v => v >= 0.4 && v <= 5.5), `all clocks in plausible GHz range 0.4..5.5 (max ${Math.max(...clocks).toFixed(2)})`);
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
ok(thRow && thRow[1].classList.contains("dd-na") && thRow[1].getAttribute("title").includes("throttle"),
   "unavailable dl row rendered dim + tooltip reason from /api/health");
const plRow = dlRows.find(([t]) => t === "PL1 / PL2");
ok(plRow && plRow[1].getAttribute("title").includes("constraint"), "PL1/PL2 row tooltip explains why unavailable");
d.querySelectorAll("nav button")[1].click();
ok(d.body.textContent.includes("No logs yet"), "empty log state");
d.querySelector("#rc").click();
await sleep(2400);
d.querySelector("#rc").click();
ok(d.body.textContent.includes("1 recorded"), "session saved with samples");
ok(d.body.textContent.includes("Mean"), "statistics table shown");
w.URL.createObjectURL = () => "blob:fake";
let clicked = false;
w.HTMLAnchorElement.prototype.click = function () { clicked = true; };
d.querySelector("#ex").click();
ok(clicked, "CSV export triggered");
console.log("ALL PASS");
process.exit(0);
