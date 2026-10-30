#!/usr/bin/env python3
"""Lovelace/noterra FastAPI app + route API + recording.

Collector hardware ada di server/collectors.py. Jalankan dari root repo:
    server/.venv/bin/python -m server.main
atau dari folder server:
    .venv/bin/python -m server.main
"""
import asyncio
import json
import re
import shutil
import time

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

try:
    from .collectors import BASE, NVML, _health, build_snapshot, config_snapshot
except ImportError:  # menjalankan file langsung (python server/main.py)
    from collectors import BASE, NVML, _health, build_snapshot, config_snapshot

app = FastAPI(title="Lovelace monitor")

@app.get("/api/snapshot")
def snapshot():
    return JSONResponse(build_snapshot())

@app.get("/api/health")
def health():
    """Availability of every metric key: null reason = available, string = why unavailable."""
    return JSONResponse({"ok": True, "nvml": NVML, "items": dict(_health)})

# ---- recording (persistensi log di repo) -------------------------------------

LOGS = BASE.parent / "logs"
# Kolom skalar yang direkam; kolom per-core/drive ditambahkan dinamis saat start.
MINIMAL_COLS = ["cpuT", "cpuW", "gT", "gW", "vbw", "prx", "majF", "r0"]
LOG_SCALARS = [
    "cpuT", "cpuU", "cpuW", "pfa", "pl1", "pl2", "plPeak", "cpuThr", "idle", "idleName",
    "ctx", "migr", "irq",
    "gT", "gU", "gW", "gClk", "gMemClk", "gClkMax", "gMU", "vram", "vramTot", "gLim",
    "gLimDef", "pstate", "thr", "fan", "thrIdle", "thrPower", "thrThermal", "thrHw",
    "pcieGen", "pcieWidth", "pcieMax", "vbw", "prx", "ptx", "pcu", "gbw", "gpeak", "pctheory",
    "ramU", "cache", "avail", "memTot", "swapU", "swapTot", "majF", "minF", "swp",
    "ramBW",
]
CORE_ARRAYS = ("pu", "pf", "pt", "eu", "ef", "et")
DRIVE_COLS = ("r", "w", "i", "a", "u", "q", "t")
_sessions = {}   # id -> sesi aktif

def build_log_columns(snapshot=None, mode="detailed"):
    """Kolom CSV untuk satu sesi.

    minimal  = 8 kolom lama (cpuT/cpuW/gT/gW/vbw/prx/majF/r0)
    detailed = skalar penting + tiap core (P/E) + tiap drive
    """
    if mode == "minimal":
        return list(MINIMAL_COLS)
    snapshot = snapshot or {}
    cols = [k for k in LOG_SCALARS if k in snapshot]
    for arr in CORE_ARRAYS:
        for i in range(len(snapshot.get(arr) or [])):
            cols.append(f"{arr}{i}")
    for i in range(len(snapshot.get("drives") or [])):
        for p in DRIVE_COLS:
            cols.append(f"{p}{i}")
    return cols

def log_value(data, col):
    """Ambil nilai kolom dari snapshot, termasuk array core dan kunci drive."""
    if col in data:
        return data[col]
    m = re.match(r"^(pu|pf|pt|eu|ef|et)(\d+)$", col)
    if m:
        arr = data.get(m.group(1)) or []
        i = int(m.group(2))
        return arr[i] if i < len(arr) else None
    m = re.match(r"^([rwiaqut])(\d+)$", col)
    if m:
        return data.get(m.group(1) + m.group(2))
    return None

def csv_value(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return f"{v:.3f}"
    return str(v).replace(",", ";")

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
            "mode": s.get("mode", "detailed"),
            "csv": "samples.csv", "columns": ["timestamp_ms"] + s["columns"],
            "config": s["config"]}

def _write_meta(sid):
    with open(_sessions[sid]["dir"] / "meta.json", "w") as f:
        json.dump(_meta(sid), f, indent=1)

async def _record(sid):
    s = _sessions[sid]
    cols = s["columns"]
    try:
        while s["rec"]:
            data = build_snapshot()
            row = ",".join(csv_value(log_value(data, c)) for c in cols)
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
    mode = (body.get("mode") or "detailed").strip().lower()
    if mode not in ("detailed", "minimal"):
        mode = "detailed"
    start = int(time.time() * 1000)
    name = f"{time.strftime('%Y-%m-%d_%H%M', time.localtime(start / 1000))}_{slug(label)}"
    d = LOGS / name
    n = 2
    while d.exists():
        d = LOGS / f"{name}-{n}"
        n += 1
    d.mkdir(parents=True)
    csv = d / "samples.csv"
    columns = build_log_columns(build_snapshot() if mode == "detailed" else None, mode)
    csv.write_text(",".join(["timestamp_ms"] + columns) + "\n")
    _sessions[sid] = dict(id=sid, label=label, tag=tag, iv=iv, start=start,
                          dir=d, csv=csv, markers=[], samples=0, rec=True, mode=mode,
                          status="recording", columns=columns, config=config_snapshot())
    _sessions[sid]["task"] = asyncio.create_task(_record(sid))
    _write_meta(sid)
    return JSONResponse({"id": sid, "dir": str(d.relative_to(BASE.parent)),
                         "mode": mode, "columns": columns})

@app.post("/api/log/stop")
async def log_stop(req: Request):
    body = await req.json()
    sid = int(body.get("id"))
    if sid not in _sessions:
        return JSONResponse({"error": "session tidak ditemukan"}, status_code=404)
    s = _sessions[sid]
    s["rec"] = False
    # Hentikan task recorder sekarang juga, bukan menunggu interval sleep
    # berikutnya; finally _record menulis status "saved" + meta final.
    task = s.pop("task", None)
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    return JSONResponse({"id": sid, "status": s["status"], "samples": s["samples"]})

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
SAMPLE = BASE / "fixtures" / "snapshot-sample.json"
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
            entry = m.get("entry")
            if entry is None and (f.parent / "overview.js").exists():
                entry = "overview.js"
            out.append({"name": m.get("name") or f.parent.name, "author": m.get("author"),
                        "version": m.get("version"),
                        "palettes": m.get("palettes") or ["light", "dark"],
                        "description": m.get("description"),
                        "entry": entry,
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
