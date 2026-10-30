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
      pl1: "constraint RAPL belum dibaca",
      ramBW: "PMU IMC ada tapi perf diblokir kernel.perf_event_paranoid=4",
      pcieGen: "NVML dan sysfs tidak terbaca",
      cpuT: "hwmon coretemp tidak terbaca" } };
    const CSV_TEXT = "timestamp_ms,cpu_temp_c,cpu_power_w,gpu_temp_c,gpu_power_w,vram_bw_gbs,pcie_rx_gbs,mem_major_faults_s,nvme0_read_mbps\n" +
      Array.from({ length: 12 }, (_, i) => `1793000000000,${60 + i}.000,,61.000,15.000,0.000,0.164,10.000,0.000`).join("\n") + "\n";
    let recStarted = false, recStopped = false;
    const SESSION = { id: 1793000000000, label: "rec-test", tag: "none", interval_s: 1,
      start_ms: Date.now(), started_iso: "2026-10-30T10:26:56+0700",
      config: { governor: "powersave", epp: "balance_performance", turbo: "on",
        swappiness: "60", kernel: "7.0.0-38-generic", sysctl: { "vm.swappiness": "60" } } };
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
const nCores = (base.pu || []).length + (base.eu || []).length;
ok(d.querySelectorAll(".cc").length === nCores, `core cells dynamic dari snapshot (${nCores} = ${base.pu.length} P + ${base.eu.length} E)`);
ok(d.querySelectorAll(".cores > div:not(.hint2)").length === 2, "P dan E dipisah dua baris");

const stats = [...d.querySelectorAll(".stats b")].map(x => x.textContent);
ok(stats.every(t => !t.includes("undefined")), `no "undefined" in stat cards (${stats.length} cards)`);

const cells = [...d.querySelectorAll(".cc u")].map(x => x.textContent);
const clocks = [...base.pf, ...base.ef].filter(v => typeof v === "number");
if (clocks.length) {
  ok(cells.filter(t => /^\d+\.\d{2}$/.test(t)).length === nCores,
    `core cells render GHz bare (kHz/1e6): ${cells.filter(t => /^\d+\.\d{2}$/.test(t)).length}/${nCores}`);
  ok(clocks.every(v => v >= 0.39 && v <= 5.5), `semua clock nyata di rentang 0.39..5.5 GHz (max ${Math.max(...clocks).toFixed(2)})`);
}

/* gauge CPU: ring dalam = daya vs PL1; tooltip dari /api/health saat unavailable */
const cpuPanel = [...d.querySelectorAll(".p")].find(p => p.querySelector("h2").textContent === "CPU");
const gaugeSvg = cpuPanel.querySelector(".gw svg");
ok(gaugeSvg && gaugeSvg.querySelector(".v") && gaugeSvg.querySelector(".w"), "gauge CPU punya ring luar (suhu) + ring dalam (daya)");
if (base.cpuW == null) ok(gaugeSvg.getAttribute("title").includes("RAPL"),
  "gauge tooltip membawa alasan RAPL dari /api/health");

/* chips throttle GPU dari bit NVML nyata, bukan ambang suhu */
const gpuPanel = [...d.querySelectorAll(".p")].find(p => p.querySelector("h2").textContent === "GPU");
const chips = [...gpuPanel.querySelectorAll(".cp")].map(x => x.textContent);
ok(chips.length === 4, `chip throttle GPU 4 slot dari NVML: ${chips.join(" | ")}`);
if (base.thrIdle != null)
  ok(chips.every(t => !t.includes("—")), "chip NVML throttle bits terbaca (tidak '—')");
else
  ok(chips.some(t => t.includes("—")), "chip throttle tampil '—' + tooltip saat NVML gagal");

/* rail kanan nyata */
ok(d.querySelectorAll("#tl .tr").length === 7, "timeline rail 7 baris dari ring buffer");
const railVals = [...d.querySelectorAll("#tl .tr b")].map(x => x.textContent);
ok(railVals.every(t => !t.includes("undefined")), `timeline tidak ada "undefined" (${railVals.join(" | ")})`);
ok(d.querySelectorAll("#ev .ev").length === 6, "events rail 6 slot");
const sysRows = [...d.querySelectorAll("#sys dd")].map(x => x.textContent);
ok(sysRows.includes(base.snap.kernel), "System rail memakai nilai nyata dari snapshot");
ok(d.querySelector("#hint span").textContent.includes("aturan"), "hint bottleneck menyebut aturan yang dievaluasi");

/* subtitle nyata */
const subs = [...d.querySelectorAll(".p header span")].map(x => x.textContent);
ok(subs.some(t => t.includes("RTX 4060")), "GPU subtitle dari nvmlDeviceGetName");
ok(subs.some(t => t.startsWith("kernel ")), "Memory subtitle = kernel saja (driver di panel GPU)");
const gpuDl = [...gpuPanel.querySelectorAll("dd")].map(x => x.textContent);
ok(gpuDl.includes(base.snap.gpuDriver), "versi NVIDIA driver tampil di panel GPU");

/* dl rows dengan nilai nyata / tooltip alasan */
const dlRows = [...d.querySelectorAll(".p dl")].flatMap(dl =>
  [...dl.children].reduce((acc, el, i) => (i % 2 === 0 ? acc.push([el.textContent, dl.children[i + 1]]) : acc, acc), []));
const thRow = dlRows.find(([t]) => t === "Throttle");
if (base.cpuThr != null) ok(thRow[1].textContent === base.cpuThr, `Throttle CPU row = nilai sysfs nyata (${base.cpuThr})`);
else ok(thRow[1].classList.contains("dd-na") && thRow[1].getAttribute("title").includes("throttle"),
  "dl row unavailable: redup + tooltip alasan dari /api/health");
if (base.pl1 != null) ok(dlRows.find(([t]) => t === "PL1 / PL2")[1].textContent.includes("PL1"),
  `PL1/PL2 nyata (${dlRows.find(([t]) => t === "PL1 / PL2")[1].textContent})`);
else ok(dlRows.find(([t]) => t === "PL1 / PL2")[1].getAttribute("title").includes("constraint"), "PL tooltip alasan constraint");
const raEm = [...d.querySelectorAll(".br em")].map(x => x.textContent);
if (base.drives[0].readahead != null)
  ok(dlRows.filter(([t]) => t === "Readahead").every(([, dd]) => /KB$/.test(dd.textContent)), "readahead nyata KB");
ok(raEm.some(t => t === "not mounted"), `drive tanpa mount tampil "not mounted"`);
ok(raEm.some(t => /% of /.test(t)), "drive mounted tampil persen kapasitas nyata");
if (base.ramBW == null) {
  const bw = dlRows.find(([t]) => t === "Measured bandwidth")[1];
  ok(bw.classList.contains("dd-na") && bw.getAttribute("title").includes("perf"),
    "measured RAM bandwidth unavailable + tooltip perf");
}

/* tab Log (server-backed) tidak berubah */
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
