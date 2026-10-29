#!/usr/bin/env python3
"""Lovelace — noterra monitoring backend.

Serves index.html and /api/snapshot. Every metric is read from real sources
(/proc, /sys, NVML). Anything that cannot be read is returned as null; the
UI renders null as "unavailable". Nothing is guessed.

Run:  .venv/bin/python server.py   (serves http://127.0.0.1:5130)
"""
import os
import re
import time
from pathlib import Path

import psutil
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

try:
    import pynvml  # module name provided by the nvidia-ml-py package
    pynvml.nvmlInit()
    NVML = True
except Exception:
    NVML = False

BASE = Path(__file__).resolve().parent
app = FastAPI(title="Lovelace monitor")

# ---- helpers ----------------------------------------------------------------

def rd(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return None

def rd_int(path):
    try:
        return int(rd(path))
    except (TypeError, ValueError):
        return None

def lines(path):
    try:
        with open(path) as f:
            return f.readlines()
    except Exception:
        return []

def gen_of(speed):
    """'8.0 GT/s PCIe' -> 3 ; unknown -> None."""
    if not speed:
        return None
    m = re.search(r"([\d.]+)\s*GT/s", speed)
    if not m:
        return None
    gts = float(m.group(1))
    for gen, v in enumerate((2.5, 5.0, 8.0, 16.0, 32.0, 64.0), start=1):
        if abs(gts - v) < 0.4:
            return gen
    return None

_state = {}      # previous cumulative counters
_last_t = None   # previous sample time (monotonic)

def rate(key, cur, dt):
    """Per-second delta of a cumulative counter; None until two samples exist."""
    prev = _state.get(key)
    _state[key] = cur
    if prev is None or dt is None or dt <= 0 or cur < prev:
        return None
    return (cur - prev) / dt

# ---- CPU --------------------------------------------------------------------

def proc_stat():
    """busy jiffies per logical cpu, total busy, total jiffies, ctxt/s raw."""
    busy = {}
    total_busy = 0
    total_all = 0
    ctxt = None
    for ln in lines("/proc/stat"):
        p = ln.split()
        if not p:
            continue
        if p[0] == "ctxt":
            ctxt = int(p[1])
        elif p[0].startswith("cpu") and p[0] != "cpu" and len(p) >= 8:
            nums = [int(x) for x in p[1:]]
            # user nice system idle iowait irq softirq [steal]
            steal = nums[7] if len(nums) > 7 else 0
            b = nums[0] + nums[1] + nums[2] + nums[5] + nums[6] + steal
            a = b + nums[3] + nums[4]
            busy[int(p[0][3:])] = b
            total_busy += b
            total_all += a
    return busy, total_busy, total_all, ctxt

def cpu_topology():
    """logical cpu -> physical core id (from /proc/cpuinfo)."""
    core = {}
    proc = None
    for ln in lines("/proc/cpuinfo"):
        if ln.startswith("processor"):
            proc = int(ln.split(":")[1])
        elif ln.startswith("core id") and proc is not None:
            try:
                core[proc] = int(ln.split(":")[1])
            except ValueError:
                pass
    return core

def cpufreq():
    cur, mx = {}, {}
    for d in Path("/sys/devices/system/cpu").glob("cpu[0-9]*"):
        i = int(d.name[3:])
        cur[i] = rd_int(d / "cpufreq/scaling_cur_freq")
        mx[i] = rd_int(d / "cpufreq/scaling_max_freq")
    return cur, mx

def core_temps():
    """(package degC, {logical cpu: degC}) via coretemp hwmon labels."""
    pkg = None
    per_cpu = {}
    for h in Path("/sys/class/hwmon").glob("hwmon*"):
        if rd(h / "name") != "coretemp":
            continue
        for f in h.glob("temp*_label"):
            label = rd(f) or ""
            val = rd_int(f.parent / (f.name[:-6] + "_input"))
            if val is None:
                continue
            v = val / 1000
            m = re.search(r"Core\s+(\d+)", label)
            if m:
                per_cpu.setdefault(int(m.group(1)), v)
            elif "Package" in label and pkg is None:
                pkg = v
    if pkg is None and per_cpu:
        pkg = max(per_cpu.values())
    return pkg, per_cpu

def idle_residency(dt):
    """% of time in the deepest cpuidle state, averaged across cpus."""
    name = None
    vals = []
    for d in sorted(Path("/sys/devices/system/cpu").glob("cpu[0-9]*")):
        states = sorted(d.glob("cpuidle/state*"), key=lambda s: int(s.name[-1]))
        if not states:
            continue
        st = states[-1]
        name = rd(st / "name") or name
        t = rd_int(st / "time")
        if t is None:
            continue
        prev = _state.get(f"idle:{d.name}")
        _state[f"idle:{d.name}"] = t
        if prev is None or t < prev or not dt:
            continue
        vals.append(min(100.0, (t - prev) / (dt * 1e6) * 100))
    return name, (sum(vals) / len(vals) if vals else None)

def migrations(dt):
    """Thread migrations/s = /proc/schedstat nb_push+nb_pull deltas per cpu.

    The cpu line format can change between kernels; the counters are only
    trusted when the observed values look like counts (<1e9). Otherwise the
    metric stays unavailable instead of reporting nonsense.
    """
    total = 0
    seen = 0
    for ln in lines("/proc/schedstat"):
        if not ln.startswith("cpu"):
            continue
        nums = [int(x) for x in ln.split()[1:]]
        if len(nums) < 3 or nums[0] > 1e9 or nums[1] > 1e9 or nums[2] > 1e9:
            _state.pop("migr", None)
            return None
        total += nums[1] + nums[2]
        seen += 1
    if seen == 0:
        return None
    return rate("migr", total, dt)

def irq_rate(dt):
    total = 0
    for ln in lines("/proc/interrupts"):
        if ln.startswith("CPU") or ":" not in ln:
            continue
        for x in ln.split(":")[1].split():
            if x.isdigit():
                total += int(x)
    return rate("irq", total, dt)

# ---- RAPL package power -----------------------------------------------------

def rapl_power(dt):
    base = Path("/sys/class/powercap/intel-rapl:0")
    e = rd_int(base / "energy_uj")
    mx = rd_int(base / "max_energy_range_uj")
    name = rd(base / "name")
    if e is None:
        return None, name
    prev = _state.get("rapl:0")
    _state["rapl:0"] = e
    if prev is None or not dt:
        return None, name
    d = e - prev
    if d < 0 and mx:
        d += mx            # counter wrapped
    if d < 0:
        return None, name
    return d / dt / 1e6, name   # microjoules / s -> watts

# ---- memory -----------------------------------------------------------------

def meminfo():
    m = {}
    for ln in lines("/proc/meminfo"):
        k, v = ln.split(":")[0], ln.split(":")[1].split()[0]
        try:
            m[k] = int(v)
        except ValueError:
            pass
    gb = lambda k: m.get(k, 0) / 1048576
    return {
        "memTot": gb("MemTotal"),
        "ramU": gb("MemTotal") - gb("MemAvailable"),
        "avail": gb("MemAvailable"),
        "cache": gb("Cached") + gb("Shmem"),
        "swapTot": gb("SwapTotal"),
        "swapU": gb("SwapTotal") - gb("SwapFree"),
    }

def vmstat_rates(dt):
    v = {}
    for ln in lines("/proc/vmstat"):
        p = ln.split()
        if len(p) == 2:
            try:
                v[p[0]] = int(p[1])
            except ValueError:
                pass
    maj = rate("pgmajfault", v.get("pgmajfault", 0), dt)
    allf = rate("pgfault", v.get("pgfault", 0), dt)
    minf = (allf - maj) if (allf is not None and maj is not None) else None
    swpin = rate("pswpin", v.get("pswpin", 0), dt)
    swpout = rate("pswpout", v.get("pswpout", 0), dt)
    swp = (swpin + swpout) * 4096 / 1e6 if (swpin is not None and swpout is not None) else None
    return {"majF": maj, "minF": minf, "swp": swp}

# ---- storage ----------------------------------------------------------------

def drive_metrics(idx, dt):
    dev = f"nvme{idx}n1"
    row = None
    for ln in lines("/proc/diskstats"):
        p = ln.split()
        if len(p) >= 14 and p[2] == dev:
            row = [int(x) for x in p[3:14]]
            break
    if row is None:
        return {}
    rc, _rm, rs, rms, wc, _wm, ws, wms, infl, io_ms, _ = row

    out = {}
    rs_r = rate(f"{dev}:rs", rs, dt)
    ws_r = rate(f"{dev}:ws", ws, dt)
    out["r"] = None if rs_r is None else rs_r * 512 / 1e6
    out["w"] = None if ws_r is None else ws_r * 512 / 1e6
    out["ops"] = rate(f"{dev}:ops", rc + wc, dt)
    io_ms_rate = rate(f"{dev}:io_ms", io_ms, dt)   # ms of I/O per second
    out["u"] = None if io_ms_rate is None else min(100.0, io_ms_rate / 10)
    out["q"] = infl
    ops_ms = rate(f"{dev}:opsms", rms + wms, dt)
    out["a"] = (ops_ms / out["ops"]) if (ops_ms is not None and out["ops"]) else None

    blk = Path("/sys/block") / dev
    out["model"] = rd(Path("/sys/class/nvme") / f"nvme{idx}" / "model")
    out["sizeGB"] = (rd_int(blk / "size") or 0) * 512 / 1e9
    out["sched"] = rd(blk / "queue/scheduler")
    m = re.search(r"\[(\w+)\]", out["sched"] or "")
    if m:
        out["sched"] = m.group(1)
    ra = rd_int(blk / "queue/readahead_kb")
    out["readahead"] = f"{ra} KB" if ra is not None else None

    out["temp"] = None
    for h in Path("/sys/class/hwmon").glob("hwmon*"):
        if rd(h / "name") == "nvme" and Path(h / "device").resolve().name == f"nvme{idx}":
            t = rd_int(h / "temp1_input")
            if t is not None:
                out["temp"] = t / 1000

    pci = None
    resolved = Path(blk / "device").resolve()
    for p in (resolved, *resolved.parents):
        if re.fullmatch(r"[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9]", p.name):
            pci = p
            break
    if pci:
        cur_g = gen_of(rd(pci / "current_link_speed"))
        max_g = gen_of(rd(pci / "max_link_speed"))
        w = rd(pci / "current_link_width")
        wm = rd(pci / "max_link_width")
        out["link"] = f"Gen{cur_g} x{w}" if cur_g else None
        out["linkMax"] = f"Gen{max_g} x{wm}" if max_g else None

    mount = None
    for ln in lines("/proc/mounts"):
        p = ln.split()
        if len(p) >= 2 and re.match(rf"/dev/{dev}p?\d*$", p[0]):
            if mount is None or len(p[1]) < len(mount):
                mount = p[1]
    out["capUsed"] = None
    if mount and os.path.isdir(mount):
        try:
            out["capUsed"] = psutil.disk_usage(mount).percent
        except Exception:
            pass
    return out

# ---- GPU --------------------------------------------------------------------

def throttle_names(bits):
    names = []
    for attr, val in vars(pynvml).items():
        if attr.startswith("NVML_CLOCK_THROTTLE_REASON_") and isinstance(val, int) and val:
            if bits & val and attr != "NVML_CLOCK_THROTTLE_REASON_TOTAL":
                names.append(attr.replace("NVML_CLOCK_THROTTLE_REASON_", "").replace("_", " ").lower())
    return ", ".join(sorted(names)) if names else "none"

def gpu_metrics():
    out = dict(gT=None, gW=None, gClk=None, gMemClk=None, gClkMax=None, gU=None,
               gMU=None, vram=None, vramTot=None, gLim=None, pstate=None, thr=None,
               fan=None, pcieGen=None, pcieWidth=None)
    if NVML:
        try:
            h = pynvml.nvmlDeviceGetHandleByIndex(0)
            safe = lambda fn, *a: fn(*a)
            try:
                out["gT"] = safe(pynvml.nvmlDeviceGetTemperature, h, pynvml.NVML_TEMPERATURE_GPU)
                pw = safe(pynvml.nvmlDeviceGetPowerUsage, h)
                out["gW"] = pw / 1000 if pw else None
                out["gClk"] = safe(pynvml.nvmlDeviceGetClockInfo, h, pynvml.NVML_CLOCK_SM)
                out["gMemClk"] = safe(pynvml.nvmlDeviceGetClockInfo, h, pynvml.NVML_CLOCK_MEM)
                out["gClkMax"] = safe(pynvml.nvmlDeviceGetMaxClockInfo, h, pynvml.NVML_CLOCK_SM)
                u = safe(pynvml.nvmlDeviceGetUtilizationRates, h)
                out["gU"], out["gMU"] = u.gpu, u.memory
                mi = safe(pynvml.nvmlDeviceGetMemoryInfo, h)
                out["vram"], out["vramTot"] = mi.used / 1e6, mi.total / 1e6
                lim = safe(pynvml.nvmlDeviceGetPowerManagementLimit, h)
                out["gLim"] = lim / 1000 if lim else None
                out["pstate"] = str(safe(pynvml.nvmlDeviceGetPerformanceState, h))
                out["thr"] = throttle_names(safe(pynvml.nvmlDeviceGetCurrentClocksThrottleReasons, h))
                out["fan"] = safe(pynvml.nvmlDeviceGetFanSpeed, h)
                out["pcieGen"] = safe(pynvml.nvmlDeviceGetCurrPcieLinkGeneration, h)
                out["pcieWidth"] = safe(pynvml.nvmlDeviceGetCurrPcieLinkWidth, h)
            except Exception:
                pass  # leave whatever was filled, rest stays null
        except Exception:
            pass
    if out["pcieGen"] is None:  # sysfs fallback, works without NVML device nodes
        pci = Path("/sys/bus/pci/devices/0000:01:00.0")
        out["pcieGen"] = gen_of(rd(pci / "current_link_speed"))
        out["pcieWidth"] = rd_int(pci / "current_link_width")
    # PCIe rx/tx throughput and VRAM bandwidth have no real source here
    out.update(vbw=None, prx=None, ptx=None, pcu=None)
    return out

# ---- system snapshot --------------------------------------------------------

def system_snap():
    cpus = list(Path("/sys/devices/system/cpu").glob("cpu[0-9]*"))
    gov = sorted({rd(f"{d}/cpufreq/scaling_governor") for d in cpus} - {None})
    epp = sorted({rd(f"{d}/cpufreq/energy_performance_preference") for d in cpus} - {None})
    status = rd("/sys/devices/system/cpu/intel_pstate/status")
    no_turbo = rd_int("/sys/devices/system/cpu/intel_pstate/no_turbo")
    nv = rd("/proc/driver/nvidia/version")
    nv_m = re.search(r"(\d+\.\d+\.\d+)", nv or "")
    thp = rd("/sys/kernel/mm/transparent_hugepage/enabled")
    thp_m = re.search(r"\[(\w+)\]", thp or "")
    model = None
    for ln in lines("/proc/cpuinfo"):
        if ln.startswith("model name"):
            model = ln.split(":")[1].strip()
            break
    pin = rd("/sys/fs/cgroup/cpuset.cpus.effective")
    return {
        "kernel": os.uname().release,
        "cpuModel": model,
        "driver": f"intel_pstate ({status})" if status else None,
        "gpuDriver": nv_m.group(1) if nv_m else None,
        "governor": ", ".join(gov) if gov else None,
        "epp": ", ".join(epp) if epp else None,
        "turbo": "off" if no_turbo == 1 else ("on" if no_turbo == 0 else None),
        "pinning": pin if pin and pin != "0-15" else "none",
        "thp": thp_m.group(1) if thp_m else None,
        "swappiness": rd("/proc/sys/vm/swappiness"),
        "nvml": NVML,
    }

# ---- snapshot ---------------------------------------------------------------

@app.get("/api/snapshot")
def snapshot():
    global _last_t
    now = time.monotonic()
    dt = None if _last_t is None else now - _last_t
    _last_t = now

    busy, total_busy, total_all, ctxt = proc_stat()
    cur_f, max_f = cpufreq()
    core = cpu_topology()
    pkg, cpu_temp = core_temps()

    # utilization per logical cpu: share of total cpu-time, scaled to 0..100%
    prev_busy = _state.get("busy")
    prev_all = _state.get("busy_all")
    _state["busy"] = busy
    _state["busy_all"] = total_all
    util = {}
    if prev_busy and dt and total_all > prev_all:
        ncpu = len(busy)
        for cpu, b in busy.items():
            pb = prev_busy.get(cpu)
            if pb is not None and b >= pb:
                util[cpu] = min(100.0, (b - pb) / (total_all - prev_all) * ncpu * 100)
    overall = None
    if prev_busy is not None and dt and total_all > prev_all:
        overall = min(100.0, (total_busy - sum(prev_busy.values())) / (total_all - prev_all) * 100)

    # group logical cpus into physical cores, split P vs E by max frequency
    groups = {}
    order = []
    for cpu, cid in sorted(core.items()):
        mx = max_f.get(cpu)
        if mx is None:
            continue
        kind = "P" if mx >= 4_000_000 else "E"
        key = (kind, cid)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(cpu)

    def group(kind):
        u, f, t = [], [], []
        for k in order:
            if k[0] != kind:
                continue
            threads = groups[k]
            vals = [util.get(c) for c in threads]
            u.append(sum(v for v in vals if v is not None) / len(threads) if vals and any(v is not None for v in vals) else None)
            cf = cur_f.get(threads[0])
            f.append(cf / 1000 if cf else None)
            temps = [cpu_temp.get(c) for c in threads]
            t.append(max(x for x in temps if x is not None) if temps and any(temps) else pkg)
        return u, f, t

    pu, pf, pt = group("P")
    eu, ef, et = group("E")

    idle_name, idle_pct = idle_residency(dt)
    rapl_w, rapl_name = rapl_power(dt)
    mem = meminfo()
    vms = vmstat_rates(dt)
    d0 = drive_metrics(0, dt)
    d1 = drive_metrics(1, dt)
    gpu = gpu_metrics()

    def drive_view(d):
        return {"name": d.get("model"), "sizeGB": d.get("sizeGB"), "link": d.get("link"),
                "linkMax": d.get("linkMax"), "sched": d.get("sched"),
                "readahead": d.get("readahead"), "capUsed": d.get("capUsed")}

    return JSONResponse({
        "cpuT": pkg,
        "cpuW": rapl_w,
        "cpuU": overall,
        "pfa": (sum(x for x in pf if x is not None) / len([x for x in pf if x is not None])) if pf and any(pf) else None,
        "pu": pu, "pf": pf, "pt": pt, "eu": eu, "ef": ef, "et": et,
        "ctx": rate("ctxt", ctxt or 0, dt),
        "migr": migrations(dt),
        "irq": irq_rate(dt),
        "idle": idle_pct,
        "idleName": idle_name,
        "cpuThr": None,
        "gT": gpu["gT"], "gW": gpu["gW"], "gClk": gpu["gClk"], "gMemClk": gpu["gMemClk"],
        "gClkMax": gpu["gClkMax"], "gU": gpu["gU"], "gMU": gpu["gMU"],
        "vram": gpu["vram"], "vramTot": gpu["vramTot"], "gLim": gpu["gLim"],
        "pstate": gpu["pstate"], "thr": gpu["thr"], "fan": gpu["fan"],
        "pcieGen": gpu["pcieGen"], "pcieWidth": gpu["pcieWidth"],
        "vbw": None, "prx": None, "ptx": None, "pcu": None,
        "ramU": mem["ramU"], "cache": mem["cache"], "avail": mem["avail"],
        "memTot": mem["memTot"], "swapU": mem["swapU"], "swapTot": mem["swapTot"],
        "majF": vms["majF"], "minF": vms["minF"], "swp": vms["swp"],
        "r0": d0.get("r"), "w0": d0.get("w"), "i0": d0.get("ops"), "a0": d0.get("a"),
        "u0": d0.get("u"), "q0": d0.get("q"), "t0": d0.get("temp"),
        "r1": d1.get("r"), "w1": d1.get("w"), "i1": d1.get("ops"), "a1": d1.get("a"),
        "u1": d1.get("u"), "q1": d1.get("q"), "t1": d1.get("temp"),
        "drives": [drive_view(d0), drive_view(d1)],
        "snap": system_snap(),
    })

@app.get("/")
def index():
    return HTMLResponse((BASE / "index.html").read_text())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5130)
