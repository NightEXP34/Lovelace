#!/usr/bin/env python3
"""Lovelace — noterra monitoring backend.

Serves the web/ shell (GET /), core+theme static files (mount), /api/themes,
/api/snapshot, and mock routes (?mock=1 di UI). Every metric is read from real
sources (/proc, /sys, NVML). Anything that cannot be read is returned as null;
the UI renders null as "unavailable". Nothing is guessed. Mock routes hanya
membaca noterra/snapshot-sample.json — tidak menyentuh hardware.

Run:  .venv/bin/python server.py   (serves http://127.0.0.1:5130)
"""
import asyncio
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import psutil
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

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

GT = {1: 2.5, 2: 5.0, 3: 8.0, 4: 16.0, 5: 32.0, 6: 64.0}   # GT/s per PCIe generation

def pci_display():
    """Cari display controller (PCI class 0x03xx) di sysfs — alamat tidak
    di-hardcode, jadi bekerja di mesin lain."""
    for d in sorted(Path("/sys/bus/pci/devices").glob("*")):
        try:
            if rd(d / "class").startswith("0x03"):
                return d
        except Exception:
            continue
    return None

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

_health = {}     # metric key -> None (available) or a reason string for unavailable

def avail(key, reason=None):
    """Record availability of a metric key; reason explains why it is null."""
    _health[key] = reason

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
    if not busy:
        avail("cpuU", "/proc/stat tidak terbaca atau tidak ada baris per-cpu")
    if ctxt is None:
        avail("ctx", "/proc/stat tidak memiliki baris ctxt")
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
    if not cur:
        avail("pfa", "sysfs cpufreq (scaling_cur_freq) tidak ditemukan")
    elif all(v is None for v in cur.values()):
        avail("pfa", "scaling_cur_freq tidak terbaca di sysfs cpufreq")
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
    if pkg is None:
        avail("cpuT", "hwmon coretemp tidak ditemukan (tidak ada sensor suhu CPU)")
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
    if name is None:
        avail("idle", "cpuidle sysfs (state*/time) tidak tersedia")
    if vals:
        avail("idle")
    return name, (sum(vals) / len(vals) if vals else None)

_mig_prev = {}   # path thread -> nilai se.nr_migrations terakhir

def migrations(dt):
    """Thread migrations/s dari se.nr_migrations tiap thread (/proc/<pid>/task/<tid>/sched).

    Kenapa sumber ini dipilih (diukur nyata di mesin ini):
    - bisa dibaca tanpa root (mode 0444), ~1273 thread, ~14–15 ms per snapshot;
    - terbukti merespons beban: delta 1116 migration saat 4 thread ganti
      affinity 3000x (12000 perubahan) selama 3 detik;
    - /proc/schedstat nb_push+nb_pull selalu 0 di kernel 7.0 ini (sumber mati);
    - perf software event `migrations` (system-wide) diblokir
      kernel.perf_event_paranoid=4 tanpa root/CAP_PERFMON; menurunkan sysctl
      itu mengubah parameter tuning -> butuh konfirmasi pengguna, tidak dilakukan.
    Caveat: thread yang mati sebelum terobservasi ikut hilang dari tracking,
    jadi migrasi <1 interval untuk thread short-lived bisa ter-lewat (undercount kecil).
    """
    if dt is None:
        avail("migr", PENDING)
    cur = {}
    try:
        pids = os.listdir("/proc")
    except Exception:
        avail("migr", "/proc tidak terbaca")
        return None
    for p in pids:
        if not p.isdigit():
            continue
        tdir = f"/proc/{p}/task"
        try:
            tids = os.listdir(tdir)
        except Exception:
            continue
        for t in tids:
            path = f"{tdir}/{t}/sched"
            try:
                with open(path) as f:
                    for ln in f:
                        if ln.startswith("se.nr_migrations"):
                            cur[path] = int(ln.split(":")[1])
                            break
            except Exception:
                continue
    if not cur:
        avail("migr", "tidak ada /proc/<pid>/task/<tid>/sched yang terbaca")
        return None
    first = not _mig_prev
    delta = 0
    for path, v in cur.items():
        pv = _mig_prev.get(path)
        if pv is not None and v > pv:
            delta += v - pv
    _mig_prev.clear()
    _mig_prev.update(cur)    # thread yang exit hilang; delta positif saja yang dihitung
    if first or dt is None:  # belum ada baseline / interval belum terukur
        avail("migr", PENDING if first else "interval tidak terukur (dt=None)")
        return None
    avail("migr")
    return delta / dt

def irq_rate(dt):
    total = 0
    seen = 0
    for ln in lines("/proc/interrupts"):
        if ln.startswith("CPU") or ":" not in ln:
            continue
        for x in ln.split(":")[1].split():
            if x.isdigit():
                total += int(x)
                seen += 1
    if seen == 0:
        avail("irq", "/proc/interrupts tidak terbaca atau tidak ada counter")
    return rate("irq", total, dt)

def cpu_throttle(dt):
    """Throttle CPU per detik dari sysfs thermal_throttle (counter kumulatif sejak boot).

    package_throttle_count sama di semua thread satu package -> diambil max;
    core_throttle_count sama di sibling (hyperthread) -> max per core id lalu dijumlah.
    Pembanding bila tersedia: turbostat (butuh root/CAP_PERFMON).
    """
    core = cpu_topology()
    per_core, pkg = {}, 0
    seen = 0
    for d in Path("/sys/devices/system/cpu").glob("cpu[0-9]*"):
        i = int(d.name[3:])
        p = rd_int(d / "thermal_throttle/package_throttle_count")
        c = rd_int(d / "thermal_throttle/core_throttle_count")
        if p is None and c is None:
            continue
        seen += 1
        if p is not None:
            pkg = max(pkg, p)
        if c is not None:
            cid = core.get(i, i)
            per_core[cid] = max(per_core.get(cid, 0), c)
    if seen == 0:
        avail("cpuThr", "sysfs thermal_throttle/*_throttle_count tidak tersedia di kernel ini")
        return None
    dp = rate("thr:pkg", pkg, dt)
    dc = rate("thr:core", sum(per_core.values()), dt)
    if dp is None or dc is None:
        avail("cpuThr", PENDING)
        return None
    avail("cpuThr")
    if dp == 0 and dc == 0:
        return "none"
    return f"core {dc:.0f}/s, package {dp:.0f}/s"

# ---- RAPL package power -----------------------------------------------------

def powercap_base():
    """Cari device powercap yang punya energy_uj (vendor apa pun: intel-rapl,
    amd_rapl, dsb). Domain MMIO (`*-mmio:*`) diprioritaskan belakangan: di
    mesin ini MSR domain (`intel-rapl:0`) adalah sumber PL1/PL2 standar; MMIO
    bisa memuat limit yang dikelola firmware/BTP dan nilainya berbeda.
    Return (Path, nama) atau (None, alasan)."""
    p = Path("/sys/class/powercap")
    if not p.exists():
        return None, "sysfs powercap tidak ada di kernel ini"
    cands = sorted((d for d in p.iterdir() if d.is_dir()),
                   key=lambda d: ("mmio" in d.name, str(d)))
    for d in cands:
        if (d / "energy_uj").exists():
            return d, d.name
    return None, ("tidak ada device powercap dengan energy_uj (ditemukan: "
                  + ", ".join(d.name for d in cands[:6]) + ")")

def rapl_power(dt):
    base, info = powercap_base()
    if base is None:
        avail("cpuW", info)
        return None, None
    e = rd_int(base / "energy_uj")
    mx = rd_int(base / "max_energy_range_uj")
    name = rd(base / "name")
    if e is None:
        avail("cpuW", f"RAPL energy_uj {base.name} tidak terbaca tanpa privileges: "
                      "file mode 0400 (butuh root atau CAP_DAC_READ_SEARCH; "
                      "jangan chmod world-readable)")
        return None, name
    prev = _state.get("rapl:0")
    _state["rapl:0"] = e
    if prev is None or not dt:
        avail("cpuW", "butuh dua snapshot (daya = delta energy_uj / dt)")
        return None, name
    d = e - prev
    if d < 0 and mx:
        d += mx            # counter wrapped
    if d < 0:
        avail("cpuW", "delta energy_uj negatif tanpa info max_energy_range (wrap tidak diketahui)")
        return None, name
    avail("cpuW")
    return d / dt / 1e6, name   # microjoules / s -> watts

def rapl_limits():
    """PL1/PL2/peak dari powercap constraint_*_power_limit_uw (µW -> W).

    Files di mesin ini mode 0444/0644 (terbaca tanpa root); server hanya
    MEMBACA — tidak pernah menulis nilai limit (itu parameter tuning).
    """
    base, info = powercap_base()
    if base is None:
        for key in ("pl1", "pl2", "plpeak"):
            avail(key, info)
        return {}
    out = {}
    for idx, key in ((0, "pl1"), (1, "pl2"), (2, "plpeak")):
        v = rd_int(base / f"constraint_{idx}_power_limit_uw")
        nm = rd(base / f"constraint_{idx}_name")
        if v is None or v <= 0:
            avail(key, f"constraint_{idx}_power_limit_uw tidak terbaca/0 "
                       f"(name={nm or 'n/a'})")
            continue
        out[key] = v / 1e6
        avail(key)
    return out

# ---- memory -----------------------------------------------------------------

def meminfo():
    m = {}
    for ln in lines("/proc/meminfo"):
        k, v = ln.split(":")[0], ln.split(":")[1].split()[0]
        try:
            m[k] = int(v)
        except ValueError:
            pass
    if not m:
        for k in ("memTot", "ramU", "avail", "cache", "swapTot", "swapU"):
            avail(k, "/proc/meminfo tidak terbaca")
        return {"memTot": None, "ramU": None, "avail": None, "cache": None,
                "swapTot": None, "swapU": None}
    gb = lambda k: m.get(k, 0) / 1048576   # meminfo is in kB; 1048576 kB = 1 GiB
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
    if not v:
        for k in ("majF", "minF", "swp"):
            avail(k, "/proc/vmstat tidak terbaca")
    maj = rate("pgmajfault", v.get("pgmajfault", 0), dt)
    allf = rate("pgfault", v.get("pgfault", 0), dt)
    minf = (allf - maj) if (allf is not None and maj is not None) else None
    swpin = rate("pswpin", v.get("pswpin", 0), dt)
    swpout = rate("pswpout", v.get("pswpout", 0), dt)
    swp = (swpin + swpout) * 4096 / 1e6 if (swpin is not None and swpout is not None) else None
    return {"majF": maj, "minF": minf, "swp": swp}

_perf_allowed = None

def perf_allowed():
    """Cek apakah perf boleh jalan (root/CAP_PERFMON atau perf_event_paranoid<=0)."""
    global _perf_allowed
    if _perf_allowed is None:
        try:
            r = subprocess.run(["perf", "stat", "-a", "-e", "cpu-migrations", "sleep", "0.2"],
                               capture_output=True, timeout=3)
            _perf_allowed = r.returncode == 0
        except Exception:
            _perf_allowed = False
    return _perf_allowed

def ram_bw(dt):
    """Bandwidth RAM terukur via PMU IMC (butuh perf diizinkan).

    Discovery generik: `uncore_imc_free_running_*`, `uncore_imc_*`, `imc_*` di
    event_source. Di mesin ini (Intel Raptor Lake) ada dua kanal free-running
    dengan event data_read/data_write berunit MiB, scale 6.1035e-5 MiB
    (= 64 byte per count). Sebagai user perf diblokir kernel.perf_event_paranoid=4;
    menurunkan sysctl itu mengubah parameter tuning -> butuh konfirmasi pengguna,
    tidak dilakukan. Jalur pengukuran di bawah hanya berjalan kalau perf diizinkan.
    """
    pmus = sorted(set(
        list(Path("/sys/bus/event_source/devices").glob("uncore_imc_free_running_*")) +
        list(Path("/sys/bus/event_source/devices").glob("uncore_imc_*")) +
        list(Path("/sys/bus/event_source/devices").glob("imc_*"))))
    pmus = [p for p in pmus if (p / "events" / "data_read").exists()]
    if not pmus:
        avail("ramBW", "PMU IMC dengan event data_read (uncore_imc_* / imc_*) "
                       "tidak ditemukan di kernel/CPU ini")
        return None
    if not perf_allowed():
        avail("ramBW", "PMU IMC ada tapi perf diblokir kernel.perf_event_paranoid=4 "
                       "(butuh root/CAP_PERFMON; mengubah sysctl butuh konfirmasi pengguna)")
        return None
    if not dt:
        avail("ramBW", PENDING)
        return None
    events = ",".join(f"{p.name}/data_read,{p.name}/data_write" for p in pmus)
    try:
        r = subprocess.run(["perf", "stat", "-a", "-e", events,
                            "sleep", str(min(max(dt, 0.5), 3))],
                           capture_output=True, text=True, timeout=8)
        total = 0
        parsed = False
        for ln in r.stderr.splitlines():
            m = re.match(r"([\d,.]+)\s*(MiB)?\s+\S+/data_(read|write)", ln.strip())
            if not m:
                continue
            v = float(m.group(1).replace(",", ""))
            # MiB per output perf, atau raw count × skala PMU (di mesin ini 64 B/count)
            total += v * (1048576 if m.group(2) else 64)
            parsed = True
        if parsed:
            avail("ramBW", "unit PMU (MiB / 64 byte per count); GB/s desimal dari (read+write)/dt")
            return total / dt / 1e9
        avail("ramBW", f"perf jalan tapi output tidak ter-parse: {r.stderr[:120]}")
    except Exception as e:
        avail("ramBW", f"perf IMC gagal: {e}")
    return None

# ---- storage ----------------------------------------------------------------

def disk_devices():
    """Discovery drive nyata dari /sys/block (disk penuh, bukan partisi/loop).

    Vendor apa pun: nvme*n1, sda/sdb, mmcblk0, vda, dst. Urutan sorted supaya
    indeks stabil antar snapshot.
    """
    out = []
    for d in sorted(Path("/sys/block").iterdir()):
        if not d.is_dir() or d.name.startswith(("loop", "ram", "zram")):
            continue
        out.append(d.name)
    return out

def drive_metrics(dev, idx, dt):
    keys = {
        "r": f"r{idx}", "w": f"w{idx}", "ops": f"i{idx}", "a": f"a{idx}",
        "u": f"u{idx}", "q": f"q{idx}", "temp": f"t{idx}",
    }
    dl_keys = {"model": f"d{idx}model", "sizeGB": f"d{idx}size", "sched": f"d{idx}sched",
               "readahead": f"d{idx}readahead", "capUsed": f"d{idx}capUsed",
               "link": f"d{idx}link", "linkMax": f"d{idx}linkMax"}
    row = None
    for ln in lines("/proc/diskstats"):
        p = ln.split()
        if len(p) >= 14 and p[2] == dev:
            row = [int(x) for x in p[3:14]]
            break
    if row is None:
        reason = f"{dev} tidak muncul di /proc/diskstats"
        for k in keys.values():
            avail(k, reason)
        for k in dl_keys.values():
            avail(k, reason)
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
    # ops rate known and zero => the drive did no I/O in this interval ("idle",
    # not "unavailable": we did measure it, there was simply nothing to await)
    out["idle"] = out["ops"] is not None and out["ops"] == 0

    blk = Path("/sys/block") / dev
    out["dev"] = dev
    # model: NVML-style sysfs generik (/sys/block/<dev>/device/model bekerja untuk
    # SATA/USB; untuk NVMe symlink device mengarah ke controller nvmeN)
    out["model"] = rd(blk / "device" / "model")
    if out["model"] is None and dev.startswith("nvme"):
        out["model"] = rd(Path("/sys/class/nvme") / dev.rsplit("n", 1)[0] / "model")
    out["sizeGB"] = (rd_int(blk / "size") or 0) * 512 / 1e9   # decimal GB (marketing units), UI label GB
    out["sched"] = rd(blk / "queue/scheduler")
    m = re.search(r"\[(\w+)\]", out["sched"] or "")
    if m:
        out["sched"] = m.group(1)
    ra = rd_int(blk / "queue/read_ahead_kb")
    out["readahead"] = f"{ra} KB" if ra is not None else None

    out["temp"] = None
    base = dev.rsplit("n", 1)[0] if dev.startswith("nvme") else dev
    for h in Path("/sys/class/hwmon").glob("hwmon*"):
        if rd(h / "name") == "nvme" and Path(h / "device").resolve().name in (dev, base):
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
    else:
        out["link"] = out["linkMax"] = None

    mount = None
    for ln in lines("/proc/mounts"):
        p = ln.split()
        if len(p) >= 2 and re.match(rf"/dev/{dev}p?\d*$", p[0]):
            if mount is None or len(p[1]) < len(mount):
                mount = p[1]
    out["capUsed"] = None
    out["mount"] = mount
    if mount and os.path.isdir(mount):
        try:
            out["capUsed"] = psutil.disk_usage(mount).percent
        except Exception:
            pass

    two = "butuh dua snapshot (laju dihitung dari delta diskstats)"
    for name, k in keys.items():
        if out.get(name) is None:
            if name == "a" and out["idle"]:
                avail(k, "")                 # idle: terukur, tidak ada I/O yang di-await (reason "" = state, bukan unavailable)
            elif name == "t":
                avail(k, f"hwmon tidak menyediakan sensor suhu untuk {dev}")
            elif name == "q":
                avail(k, "queue depth tidak terbaca dari /proc/diskstats")
            else:
                avail(k, two)
        else:
            avail(k)
    for name, k in dl_keys.items():
        if out.get(name) is None:
            if name == "capUsed":
                avail(k, "drive tidak di-mount — tidak ada filesystem terpasang di drive ini")
            elif name == "readahead":
                avail(k, "sysfs queue/read_ahead_kb tidak terbaca")
            elif name == "model":
                avail(k, f"sysfs /sys/block/{dev}/device/model tidak menyediakan nama model")
            elif name == "sizeGB":
                avail(k, "sysfs block size tidak terbaca")
            elif name == "sched":
                avail(k, "sysfs queue/scheduler tidak terbaca")
            else:
                avail(k, "sysfs PCI link tidak ditemukan untuk drive ini")
        else:
            avail(k)
    return out

# ---- GPU --------------------------------------------------------------------

def throttle_bits(bits):
    """Decode bitmask NVML jadi daftar nama reason + boolean untuk chip UI.

    Konstanta NVML di pynvml bernama `nvmlClocksThrottleReason*` (bukan
    NVML_CLOCK_THROTTLE_REASON_* yang tidak ada di paket ini).
    """
    names, flags = [], {}
    for attr, val in vars(pynvml).items():
        if not attr.startswith("nvmlClocksThrottleReason"):
            continue
        name = attr[len("nvmlClocksThrottleReason"):]
        if not isinstance(val, int) or not val or name in ("None", "All"):
            continue
        label = re.sub(r"(?<!^)(?=[A-Z])", " ", name).lower()
        if bits & val:
            names.append(label)
        flags[name] = bool(bits & val)
    return (", ".join(sorted(names)) if names else "none"), flags

def gpu_metrics():
    out = dict(gT=None, gW=None, gClk=None, gMemClk=None, gClkMax=None, gU=None,
               gMU=None, vram=None, vramTot=None, gLim=None, pstate=None, thr=None,
               fan=None, pcieGen=None, pcieWidth=None, name=None,
               thrIdle=None, thrPower=None, thrThermal=None, thrHw=None,
               pcieMax=None, pcieMaxGen=None, pcieMaxWidth=None, prx=None, ptx=None,
               pcu=None, gbw=None, gpeak=None, pctheory=None, vbw=None)
    keys = list(out)
    if NVML:
        try:
            if pynvml.nvmlDeviceGetCount() == 0:
                for k in keys:
                    avail(k, "NVML aktif tapi tidak ada GPU yang dilaporkan driver")
                return out
            h = pynvml.nvmlDeviceGetHandleByIndex(0)
        except Exception as e:
            reason = f"NVML: handle GPU gagal ({e})"
            for k in keys:
                avail(k, reason)
            return out

        def nv(key, fn, *a, scale=None):
            try:
                v = fn(*a)
                out[key] = None if v is None else (v / scale if scale else v)
                avail(key)
                if v == 0:
                    avail(key, "NVML mengembalikan 0")
            except Exception as e:
                avail(key, f"NVML {getattr(fn, '__name__', 'call')}: {e}")

        nv("name", pynvml.nvmlDeviceGetName, h)
        nv("gT", pynvml.nvmlDeviceGetTemperature, h, pynvml.NVML_TEMPERATURE_GPU)
        nv("gW", pynvml.nvmlDeviceGetPowerUsage, h, scale=1000)          # mW -> W
        nv("gClk", pynvml.nvmlDeviceGetClockInfo, h, pynvml.NVML_CLOCK_SM)
        nv("gMemClk", pynvml.nvmlDeviceGetClockInfo, h, pynvml.NVML_CLOCK_MEM)
        nv("gClkMax", pynvml.nvmlDeviceGetMaxClockInfo, h, pynvml.NVML_CLOCK_SM)
        try:
            u = pynvml.nvmlDeviceGetUtilizationRates(h)
            out["gU"], out["gMU"] = u.gpu, u.memory
            avail("gU"); avail("gMU")
        except Exception as e:
            avail("gU", f"NVML nvmlDeviceGetUtilizationRates: {e}")
            avail("gMU", f"NVML nvmlDeviceGetUtilizationRates: {e}")
        try:
            mi = pynvml.nvmlDeviceGetMemoryInfo(h)
            out["vram"], out["vramTot"] = mi.used / 1024**3, mi.total / 1024**3   # bytes -> GiB
            avail("vram"); avail("vramTot")
        except Exception as e:
            avail("vram", f"NVML nvmlDeviceGetMemoryInfo: {e}")
            avail("vramTot", f"NVML nvmlDeviceGetMemoryInfo: {e}")
        nv("gLim", pynvml.nvmlDeviceGetPowerManagementLimit, h, scale=1000)
        if out["gLim"] is None:
            # limit aktif tidak dilaporkan GPU laptop ini; default limit bisa dibaca
            try:
                out["gLim"] = pynvml.nvmlDeviceGetPowerManagementDefaultLimit(h) / 1000
                out["gLimDef"] = True
                avail("gLim", "NVML NotSupported untuk limit aktif; nilai ini default limit (NVML)")
            except Exception as e:
                avail("gLim", f"NVML power limit (aktif & default) gagal: {e}")
        try:
            out["pstate"] = "P" + str(pynvml.nvmlDeviceGetPerformanceState(h))
            avail("pstate")
        except Exception as e:
            avail("pstate", f"NVML nvmlDeviceGetPerformanceState: {e}")
        try:
            bits = pynvml.nvmlDeviceGetCurrentClocksThrottleReasons(h)
            out["thr"], fl = throttle_bits(bits)
            out["thrIdle"] = fl.get("GpuIdle")
            out["thrPower"] = bool(fl.get("SwPowerCap") or fl.get("HwPowerBrakeSlowdown"))
            out["thrThermal"] = bool(fl.get("SwThermalSlowdown") or fl.get("HwThermalSlowdown"))
            out["thrHw"] = fl.get("HwSlowdown")
            avail("thr")
        except Exception as e:
            avail("thr", f"NVML nvmlDeviceGetCurrentClocksThrottleReasons: {e}")
        try:
            out["fan"] = pynvml.nvmlDeviceGetFanSpeed(h)
            avail("fan")
        except Exception as e:
            avail("fan", "NVML NotSupported: fan speed tidak dilaporkan GPU laptop ini "
                         "(kipas diatur Embedded Controller, tidak lewat NVML)")
        nv("pcieGen", pynvml.nvmlDeviceGetCurrPcieLinkGeneration, h)
        nv("pcieWidth", pynvml.nvmlDeviceGetCurrPcieLinkWidth, h)
        try:
            g = pynvml.nvmlDeviceGetMaxPcieLinkGeneration(h)
            w = pynvml.nvmlDeviceGetMaxPcieLinkWidth(h)
            out["pcieMaxGen"], out["pcieMaxWidth"] = g, w
            out["pcieMax"] = f"Gen{g} x{w}"
            avail("pcieMax")
        except Exception as e:
            avail("pcieMax", f"NVML nvmlDeviceGetMaxPcieLinkGeneration/Width: {e}")
        try:
            rx = pynvml.nvmlDeviceGetPcieThroughput(h, pynvml.NVML_PCIE_UTIL_RX_BYTES)
            tx = pynvml.nvmlDeviceGetPcieThroughput(h, pynvml.NVML_PCIE_UTIL_TX_BYTES)
            out["prx"] = rx * 1024 / 1e9    # KB/s -> GB/s (decimal)
            out["ptx"] = tx * 1024 / 1e9
            avail("prx"); avail("ptx")
        except Exception as e:
            msg = f"NVML nvmlDeviceGetPcieThroughput: {e}"
            avail("prx", msg); avail("ptx", msg)
        try:
            bw = pynvml.nvmlDeviceGetMemoryBusWidth(h)          # bit
            out["gbw"] = bw
            if bw and out["gMemClk"]:
                # GDDR6 double-data-rate: MT/s = 2 × clock MHz; byte/MT = bus width/8
                out["gpeak"] = bw / 8 * (out["gMemClk"] / 1000) * 2   # GB/s (estimasi DDR)
                avail("gpeak", "estimasi: bus width × memory clock × 2 (DDR), dari NVML")
            else:
                avail("gpeak", "NVML bus width atau memory clock tidak terbaca")
            avail("gbw")
        except Exception as e:
            avail("gbw", f"NVML nvmlDeviceGetMemoryBusWidth: {e}")
            avail("gpeak", f"NVML nvmlDeviceGetMemoryBusWidth: {e}")
    else:
        for k in keys:
            avail(k, "NVML init gagal (Driver Not Loaded): /dev/nvidia* tidak terlihat; "
                     "jalankan server di host atau dengan akses device node")
    if out["pcieGen"] is None:  # sysfs fallback, works without NVML device nodes
        pci = pci_display()
        if pci is None:
            avail("pcieGen", "NVML tidak tersedia dan tidak ada PCI display controller di sysfs")
            avail("pcieWidth", "NVML tidak tersedia dan tidak ada PCI display controller di sysfs")
            avail("pcieMax", "NVML tidak tersedia dan tidak ada PCI display controller di sysfs")
        else:
            g = gen_of(rd(pci / "current_link_speed"))
            w = rd_int(pci / "current_link_width")
            out["pcieGen"], out["pcieWidth"] = g, w
            if g is None:
                avail("pcieGen", f"sysfs PCI {pci.name}: current_link_speed tidak terbaca")
            if w is None:
                avail("pcieWidth", f"sysfs PCI {pci.name}: current_link_width tidak terbaca")
            mg = gen_of(rd(pci / "max_link_speed"))
            mw = rd_int(pci / "max_link_width")
            if mg and mw:
                out["pcieMaxGen"], out["pcieMaxWidth"] = mg, mw
                out["pcieMax"] = f"Gen{mg} x{mw}"
                avail("pcieMax")
            else:
                avail("pcieMax", f"sysfs PCI {pci.name}: max_link_speed/width tidak terbaca")
    # theoretical bandwidth dari LINK MAX (link sekarang bisa turun saat idle — normal)
    if out.get("pcieMaxGen") and out.get("pcieMaxWidth"):
        enc = 0.8 if out["pcieMaxGen"] <= 2 else 128 / 130
        out["pctheory"] = GT[out["pcieMaxGen"]] * out["pcieMaxWidth"] / 8 * enc
        avail("pctheory")
    else:
        avail("pctheory", "link max (generation/width) tidak terbaca")
    # VRAM bandwidth terpakai = ESTIMASI dari util controller × peak turunan NVML
    if out["gMU"] is not None and out.get("gpeak"):
        out["vbw"] = out["gMU"] / 100 * out["gpeak"]
        avail("vbw", "estimasi: memory-controller util × peak bandwidth (bukan pengukuran langsung)")
    else:
        avail("vbw", "belum ada peak bandwidth (NVML bus width/memory clock) untuk estimasi")
    if out["prx"] is not None and out["ptx"] is not None and out.get("pctheory"):
        out["pcu"] = (out["prx"] + out["ptx"]) / out["pctheory"] * 100
        avail("pcu")
    else:
        avail("pcu", "rx/tx throughput NVML belum tersedia untuk hitung persen link")
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

def config_snapshot():
    """Snapshot konfigurasi saat sesi mulai (spec 6.3): governor/EPP/turbo/power
    limit/sysctl terkait/kernel param/versi driver. Nilai tanpa sumber = null."""
    cfg = system_snap()
    sysctl = {}
    for p in ("kernel/perf_event_paranoid", "vm/swappiness", "vm/dirty_ratio",
              "vm/dirty_background_ratio"):
        sysctl[p.replace("/", ".")] = rd(Path("/proc/sys") / p)
    cfg["sysctl"] = sysctl
    cfg["kernelCmdline"] = (rd("/proc/cmdline") or "")[:200] or None
    lim = rapl_limits()
    cfg["powerLimits"] = {"pl1W": lim.get("pl1"), "pl2W": lim.get("pl2"), "peakW": lim.get("plpeak")}
    cfg["gpuPowerLimitW"] = gpu_metrics()["gLim"]
    cfg["gpuClockLock"] = None      # NVML tidak menyediakan status clock lock di mesin ini
    cfg["strata"] = None            # adapter Strata belum ada → null (bukan angka karangan)
    return cfg

# ---- snapshot ---------------------------------------------------------------

PENDING = "butuh dua snapshot (laju dihitung dari delta antar snapshot)"

def sync_health(data):
    """Mark each scalar metric available/unavailable; keep collector reasons."""
    for k, v in data.items():
        if k in ("snap", "drives") or isinstance(v, (list, bool)):
            continue
        if v is None:
            if _health.get(k) is None:
                _health[k] = PENDING
        else:
            _health[k] = None

def build_snapshot():
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
            f.append(cf / 1e6 if cf else None)   # kHz -> GHz
            temps = [cpu_temp.get(c) for c in threads]
            t.append(max(x for x in temps if x is not None) if temps and any(temps) else pkg)
        return u, f, t

    pu, pf, pt = group("P")
    eu, ef, et = group("E")

    idle_name, idle_pct = idle_residency(dt)
    rapl_w, rapl_name = rapl_power(dt)
    lims = rapl_limits()
    thr = cpu_throttle(dt)
    mem = meminfo()
    vms = vmstat_rates(dt)
    drives = [drive_metrics(dev, i, dt) for i, dev in enumerate(disk_devices())]
    gpu = gpu_metrics()

    def drive_view(d):
        return {"dev": d.get("dev"), "name": d.get("model"), "sizeGB": d.get("sizeGB"),
                "link": d.get("link"), "linkMax": d.get("linkMax"), "sched": d.get("sched"),
                "readahead": d.get("readahead"), "capUsed": d.get("capUsed"),
                "mount": d.get("mount")}

    snap = system_snap()
    snap["gpuName"] = gpu["name"]
    snap["gpuPresent"] = bool(NVML) or pci_display() is not None
    snap["drivesFound"] = len(drives)
    data = {
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
        "cpuThr": thr,
        "pl1": lims.get("pl1"), "pl2": lims.get("pl2"), "plPeak": lims.get("plpeak"),
        "gT": gpu["gT"], "gW": gpu["gW"], "gClk": gpu["gClk"], "gMemClk": gpu["gMemClk"],
        "gClkMax": gpu["gClkMax"], "gU": gpu["gU"], "gMU": gpu["gMU"],
        "vram": gpu["vram"], "vramTot": gpu["vramTot"], "gLim": gpu["gLim"], "gLimDef": gpu.get("gLimDef"),
        "pstate": gpu["pstate"], "thr": gpu["thr"], "fan": gpu["fan"],
        "thrIdle": gpu["thrIdle"], "thrPower": gpu["thrPower"],
        "thrThermal": gpu["thrThermal"], "thrHw": gpu["thrHw"],
        "pcieGen": gpu["pcieGen"], "pcieWidth": gpu["pcieWidth"], "pcieMax": gpu["pcieMax"],
        "vbw": gpu["vbw"], "prx": gpu["prx"], "ptx": gpu["ptx"], "pcu": gpu["pcu"],
        "gbw": gpu["gbw"], "gpeak": gpu["gpeak"], "pctheory": gpu["pctheory"],
        "ramU": mem["ramU"], "cache": mem["cache"], "avail": mem["avail"],
        "memTot": mem["memTot"], "swapU": mem["swapU"], "swapTot": mem["swapTot"],
        "majF": vms["majF"], "minF": vms["minF"], "swp": vms["swp"], "ramBW": ram_bw(dt),
        "drives": [drive_view(d) for d in drives],
        "snap": snap,
    }
    # kunci laju per drive dibuat dinamis (jumlah drive dari /sys/block mesin ini)
    for i, d in enumerate(drives):
        data[f"r{i}"] = d.get("r")
        data[f"w{i}"] = d.get("w")
        data[f"i{i}"] = d.get("ops")
        data[f"a{i}"] = d.get("a")
        data[f"a{i}Idle"] = d.get("idle")
        data[f"u{i}"] = d.get("u")
        data[f"q{i}"] = d.get("q")
        data[f"t{i}"] = d.get("temp")
    sync_health(data)
    return data

@app.get("/api/snapshot")
def snapshot():
    return JSONResponse(build_snapshot())

@app.get("/api/health")
def health():
    """Availability of every metric key: null reason = available, string = why unavailable."""
    return JSONResponse({"ok": True, "nvml": NVML, "items": dict(_health)})

# ---- recording (persistensi log di repo) -------------------------------------

LOGS = BASE.parent / "logs"
LOG_COLS = [("cpuT", "cpu_temp_c"), ("cpuW", "cpu_power_w"), ("gT", "gpu_temp_c"),
            ("gW", "gpu_power_w"), ("vbw", "vram_bw_gbs"), ("prx", "pcie_rx_gbs"),
            ("majF", "mem_major_faults_s"), ("r0", "drive0_read_mbps")]
_sessions = {}   # id -> sesi aktif

def slug(s):
    s = re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")
    return s or "session"

def _meta(sid):
    s = _sessions[sid]
    return {"schema_version": 1, "id": sid, "label": s["label"], "tag": s["tag"],
            "interval_s": s["iv"],
            "start_ms": s["start"],
            "started_iso": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(s["start"] / 1000)),
            "status": s["status"], "samples": s["samples"], "markers": s["markers"],
            "csv": "samples.csv", "columns": ["timestamp_ms"] + [c for _, c in LOG_COLS],
            "config": s["config"]}

def _write_meta(sid):
    with open(_sessions[sid]["dir"] / "meta.json", "w") as f:
        json.dump(_meta(sid), f, indent=1)

async def _record(sid):
    s = _sessions[sid]
    header = ",".join(c for _, c in LOG_COLS)
    try:
        while s["rec"]:
            data = build_snapshot()
            row = ",".join("" if data.get(k) is None else f"{data[k]:.3f}" for k, _ in LOG_COLS)
            with open(s["csv"], "a") as f:
                f.write(f"{int(time.time() * 1000)},{row}\n")
            s["samples"] += 1
            _write_meta(sid)
            await asyncio.sleep(s["iv"])
    finally:
        s["status"] = "saved"
        _write_meta(sid)

@app.post("/api/log/start")
async def log_start(req: Request):
    body = await req.json()
    sid = int(time.time() * 1000)   # id global-ish: tidak bentrok antar restart
    label = (body.get("label") or f"session-{sid}")[:48]
    tag = (body.get("tag") or "")[:32]
    iv = float(body.get("interval") or 1)
    iv = min(max(iv, 0.5), 10)
    start = int(time.time() * 1000)
    name = f"{time.strftime('%Y-%m-%d_%H%M', time.localtime(start / 1000))}_{slug(label)}"
    d = LOGS / name
    n = 2
    while d.exists():
        d = LOGS / f"{name}-{n}"
        n += 1
    d.mkdir(parents=True)
    csv = d / "samples.csv"
    csv.write_text(",".join(c for _, c in LOG_COLS) + "\n")
    _sessions[sid] = dict(id=sid, label=label, tag=tag, iv=iv, start=start,
                          dir=d, csv=csv, markers=[], samples=0, rec=True,
                          status="recording", config=config_snapshot())
    asyncio.create_task(_record(sid))
    _write_meta(sid)
    return JSONResponse({"id": sid, "dir": str(d.relative_to(BASE.parent))})

@app.post("/api/log/stop")
async def log_stop(req: Request):
    body = await req.json()
    sid = int(body.get("id"))
    if sid not in _sessions:
        return JSONResponse({"error": "session tidak ditemukan"}, status_code=404)
    _sessions[sid]["rec"] = False
    return JSONResponse({"id": sid, "status": _sessions[sid]["status"], "samples": _sessions[sid]["samples"]})

@app.post("/api/log/marker")
async def log_marker(req: Request):
    body = await req.json()
    sid = int(body.get("id"))
    if sid not in _sessions:
        return JSONResponse({"error": "session tidak ditemukan"}, status_code=404)
    s = _sessions[sid]
    s["markers"].append({"ts_ms": int(time.time() * 1000),
                         "since_s": round(time.time() - s["start"] / 1000, 3),
                         "note": (body.get("note") or "")[:80]})
    _write_meta(sid)
    return JSONResponse({"id": sid, "markers": s["markers"]})

@app.get("/api/log/sessions")
def log_sessions():
    """Daftar semua sesi: yang aktif di memori + yang tersimpan di folder logs/."""
    out = []
    seen = set()
    for sid, s in _sessions.items():
        out.append(_meta(sid))
        seen.add(s["dir"].name)
    if LOGS.exists():
        for d in sorted(LOGS.iterdir()):
            if not d.is_dir() or d.name in seen:
                continue
            try:
                m = json.loads((d / "meta.json").read_text())
                m["dir"] = d.name
                out.append(m)
            except Exception:
                continue
    out.sort(key=lambda m: -m.get("start_ms", 0))
    return JSONResponse({"sessions": out})

@app.get("/api/log/{sid}/samples.csv")
def log_samples(sid: str):
    for s in _sessions.values():
        if str(s["id"]) == sid:
            return PlainTextResponse(s["csv"].read_text(), media_type="text/csv")
    if LOGS.exists():
        for d in LOGS.iterdir():
            meta = d / "meta.json"
            if d.is_dir() and meta.exists():
                try:
                    if json.loads(meta.read_text()).get("id") == int(sid):
                        return PlainTextResponse((d / "samples.csv").read_text(), media_type="text/csv")
                except Exception:
                    continue
    return PlainTextResponse("", status_code=404)

@app.delete("/api/log/{sid}")
def log_delete(sid: str):
    target = None
    for s in _sessions.values():
        if str(s["id"]) == sid:
            if s["rec"]:
                return JSONResponse({"error": "masih recording"}, status_code=409)
            target = s["dir"]
            _sessions.pop(s["id"], None)
            break
    if target is None and LOGS.exists():
        for d in LOGS.iterdir():
            meta = d / "meta.json"
            if d.is_dir() and meta.exists():
                try:
                    if json.loads(meta.read_text()).get("id") == int(sid):
                        target = d
                        break
                except Exception:
                    continue
    if target is None:
        return JSONResponse({"error": "session tidak ditemukan"}, status_code=404)
    shutil.rmtree(target)
    return JSONResponse({"deleted": str(target.relative_to(BASE.parent))})

WEB = BASE.parent / "web"
SAMPLE = BASE / "snapshot-sample.json"
SCHEMA = BASE / "metrics_meta.json"

@app.get("/api/schema")
def api_schema():
    """Metadata metrik (label, satuan, digits, sumber, scaleKey) untuk UI."""
    return JSONResponse(json.loads(SCHEMA.read_text()))

@app.get("/api/themes")
def api_themes():
    """Daftar theme dari web/themes/*/theme.json — tanpa menjalankan script theme."""
    out = []
    if WEB.exists():
        for f in sorted(WEB.glob("themes/*/theme.json")):
            try:
                m = json.loads(f.read_text())
            except Exception:
                continue
            out.append({"name": m.get("name") or f.parent.name, "author": m.get("author"),
                        "version": m.get("version"),
                        "palettes": m.get("palettes") or ["light", "dark"],
                        "description": m.get("description"),
                        "entry": m.get("entry") or "overview.js",
                        "css": m.get("css") or "theme.css",
                        "layout": m.get("layout")})
    return JSONResponse({"themes": out})

@app.get("/api/mock/snapshot")
def mock_snapshot():
    """Mode mock (?mock=1): snapshot-sample.json apa adanya — tidak menyentuh hardware."""
    return JSONResponse(json.loads(SAMPLE.read_text()))

@app.get("/api/mock/health")
def mock_health():
    """Alasan unavailable versi mock: dari null di sample, bukan probe hardware."""
    data = json.loads(SAMPLE.read_text())
    items = {}
    for k, v in data.items():
        if k in ("snap", "drives") or isinstance(v, (list, bool)):
            continue
        if v is None:
            items[k] = "unavailable on the sample machine — no source recorded in snapshot-sample.json"
    return JSONResponse({"ok": True, "nvml": bool(data["snap"].get("nvml")), "items": items})

@app.get("/api/mock/schema")
def mock_schema():
    """Metadata metrik versi mock — file yang sama, tanpa hardware."""
    return JSONResponse(json.loads(SCHEMA.read_text()))

@app.get("/")
def index():
    return HTMLResponse((WEB / "index.html").read_text())

@app.get("/legacy")
def legacy():
    """UI lama satu-file — pembanding visual saat refactor core/theme."""
    return HTMLResponse((BASE / "index.html").read_text())

# aset static web/ (core + themes); semua rute /api dan / sudah terdaftar sebelum mount
app.mount("/", StaticFiles(directory=str(WEB)), name="web")

def run_check():
    """Self-diagnostic: probe every source twice (rates need a delta) and print results."""
    build_snapshot()
    time.sleep(1.2)
    build_snapshot()
    rows = sorted(_health.items())
    width = max((len(k) for k, _ in rows), default=0)
    for k, reason in rows:
        state = "available" if reason is None else ("idle (terukur, 0 I/O)" if reason == "" else "unavailable")
        print(f"{k:<{width}}  {state}" + (f"  — {reason}" if reason else ""))
    bad = sum(1 for _, r in rows if r is not None and r != "")
    print(f"\n{len(rows)} metric keys: {len(rows) - bad} available, {bad} unavailable")
    return 0

if __name__ == "__main__":
    import sys
    if "--check" in sys.argv:
        sys.exit(run_check())
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5130)
