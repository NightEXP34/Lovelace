/* Noterra core — punya: fetch snapshot, ring buffer 60 sampel, format angka,
   registry metrik dari snapshot nyata, status unavailable, pemilihan theme,
   dan tab Log. Theme TIDAK boleh fetch/parse sendiri: hanya membaca registry
   dan data lewat ctx (lihat web/THEMES.md). */
(function(){
"use strict";

/* ---- format angka (kontrak: core yang memformat, theme yang menata) ---- */
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
const fx=(v,d=0)=>typeof v==="number"?v.toFixed(d):"unavailable";
const val=(v,d=0)=>typeof v==="number"?v.toFixed(d):"—";
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const mmss=t=>String(t/60|0).padStart(2,"0")+":"+String(t%60).padStart(2,"0");
const mk=h=>{const d=document.createElement("div");d.innerHTML=h;return d};

/* ---- mode: ?mock=1 memakai snapshot-sample.json, tanpa hardware ---- */
const params=new URLSearchParams(location.search);
const MOCK=params.get("mock")==="1";
const SNAP_URL=MOCK?"/api/mock/snapshot":"/api/snapshot";
const HEALTH_URL=MOCK?"/api/mock/health":"/api/health";

let S={snap:{},drives:[]}, H={}, R={}, online=false, rec=null;
const REG=new Map();               // registry metrik, rebuild tiap snapshot
let theme=null, themeMeta=null;

/* ---- metadata metrik: label, satuan, skala asli (scaleKey), sumber nyata ---- */
const META={
  cpuT:{label:"CPU temp",unit:"°C",digits:0,source:"hwmon coretemp package"},
  cpuW:{label:"Power",unit:"W",digits:1,source:"RAPL energy_uj",scaleKey:"pl1"},
  cpuU:{label:"Util",unit:"%",digits:0,source:"/proc/stat delta per-cpu"},
  pfa:{label:"P clock",unit:"GHz",digits:2,source:"sysfs cpufreq scaling_cur_freq"},
  pu:{label:"P util per core",unit:"%",digits:0,source:"/proc/stat delta"},
  pf:{label:"P clock per core",unit:"GHz",digits:2,source:"sysfs cpufreq"},
  pt:{label:"P temp per core",unit:"°C",digits:0,source:"hwmon coretemp"},
  eu:{label:"E util per core",unit:"%",digits:0,source:"/proc/stat delta"},
  ef:{label:"E clock per core",unit:"GHz",digits:2,source:"sysfs cpufreq"},
  et:{label:"E temp per core",unit:"°C",digits:0,source:"hwmon coretemp"},
  ctx:{label:"Context switches",unit:"/s",digits:0,source:"/proc/stat ctxt"},
  migr:{label:"Migrations",unit:"/s",digits:0,source:"/proc/*/task/*/sched nr_migrations"},
  irq:{label:"Interrupts",unit:"/s",digits:0,source:"/proc/stat irq"},
  idle:{label:"Idle residency",unit:"%",digits:0,source:"cpuidle sysfs state*/time"},
  idleName:{label:"Idle state",unit:null,digits:0,source:"cpuidle state tertinggi"},
  cpuThr:{label:"Throttle",unit:null,digits:0,source:"sysfs thermal throttling"},
  pl1:{label:"PL1",unit:"W",digits:1,source:"RAPL constraint"},
  pl2:{label:"PL2",unit:"W",digits:1,source:"RAPL constraint"},
  plPeak:{label:"PL peak window",unit:"W",digits:1,source:"RAPL peak window"},
  gT:{label:"GPU temp",unit:"°C",digits:0,source:"NVML"},
  gW:{label:"GPU power",unit:"W",digits:1,source:"NVML",scaleKey:"gLim"},
  gClk:{label:"SM clock",unit:"MHz",digits:0,source:"NVML"},
  gMemClk:{label:"Memory clock",unit:"MHz",digits:0,source:"NVML"},
  gClkMax:{label:"SM clock max",unit:"MHz",digits:0,source:"NVML"},
  gU:{label:"GPU util",unit:"%",digits:0,source:"NVML"},
  gMU:{label:"Mem ctrl util",unit:"%",digits:0,source:"NVML"},
  vram:{label:"VRAM used",unit:"GiB",digits:1,source:"NVML",scaleKey:"vramTot"},
  vramTot:{label:"VRAM total",unit:"GiB",digits:2,source:"NVML"},
  gLim:{label:"Draw limit",unit:"W",digits:0,source:"NVML power limit"},
  gLimDef:{label:"Limit default",unit:null,digits:0,source:"NVML"},
  pstate:{label:"P-state",unit:null,digits:0,source:"NVML"},
  thr:{label:"GPU throttle",unit:null,digits:0,source:"NVML throttle decoder"},
  fan:{label:"Fan",unit:"%",digits:0,source:"NVML"},
  thrIdle:{label:"Idle",unit:null,digits:0,source:"NVML throttle bit"},
  thrPower:{label:"Power cap",unit:null,digits:0,source:"NVML throttle bit"},
  thrThermal:{label:"Thermal",unit:null,digits:0,source:"NVML throttle bit"},
  thrHw:{label:"HW slowdown",unit:null,digits:0,source:"NVML throttle bit"},
  pcieGen:{label:"PCIe gen",unit:null,digits:0,source:"NVML atau sysfs PCI"},
  pcieWidth:{label:"PCIe width",unit:"lane",digits:0,source:"NVML atau sysfs PCI"},
  pcieMax:{label:"PCIe max",unit:null,digits:0,source:"sysfs PCI max_link"},
  vbw:{label:"VRAM bw",unit:"GB/s",digits:0,source:"mem util × clock × bus width (estimasi)",scaleKey:"gpeak"},
  prx:{label:"PCIe receive",unit:"GB/s",digits:2,source:"NVML rx bytes delta",scaleKey:"pctheory"},
  ptx:{label:"PCIe transmit",unit:"GB/s",digits:2,source:"NVML tx bytes delta",scaleKey:"pctheory"},
  pcu:{label:"PCIe util",unit:"%",digits:2,source:"NVML"},
  gbw:{label:"Bus width",unit:"bit",digits:0,source:"NVML"},
  gpeak:{label:"VRAM theoretical peak",unit:"GB/s",digits:0,source:"clock mem × bus width"},
  pctheory:{label:"PCIe link ceiling",unit:"GB/s",digits:2,source:"gen × width"},
  ramU:{label:"RAM used",unit:"GiB",digits:1,source:"/proc/meminfo",scaleKey:"memTot"},
  cache:{label:"Page cache",unit:"GiB",digits:1,source:"/proc/meminfo"},
  avail:{label:"Available",unit:"GiB",digits:1,source:"/proc/meminfo"},
  memTot:{label:"Total",unit:"GiB",digits:2,source:"/proc/meminfo"},
  swapU:{label:"Swap used",unit:"GiB",digits:1,source:"/proc/meminfo",scaleKey:"swapTot"},
  swapTot:{label:"Swap total",unit:"GiB",digits:2,source:"/proc/meminfo"},
  majF:{label:"Major faults",unit:"/s",digits:0,source:"/proc/vmstat maj_flt"},
  minF:{label:"Minor faults",unit:"/s",digits:0,source:"/proc/vmstat min_flt"},
  swp:{label:"Swap I/O",unit:"MB/s",digits:1,source:"/proc/vmstat pgpgin/out"},
  ramBW:{label:"Measured bandwidth",unit:"GB/s",digits:1,source:"PMU IMC read events"},
};

/* ---- registry metrik dari snapshot nyata + alasan dari /api/health ---- */
function metricEntry(k,v,m){
  const available=v!=null&&v!==""&&v!=="unavailable";
  return {key:k,kind:"metric",label:m.label||k,unit:m.unit||null,digits:m.digits??0,
    source:m.source||null,scaleKey:m.scaleKey||null,available,
    reason:available?null:(R[k]||"tidak ada sumber data"),value:v};
}
const DRIVE_COLS={r:{label:"read",unit:"MB/s",digits:0},w:{label:"write",unit:"MB/s",digits:1},
  i:{label:"IOPS",unit:"IOPS",digits:0},a:{label:"Await",unit:"ms",digits:1},
  u:{label:"Util",unit:"%",digits:0},q:{label:"Queue",unit:"requests",digits:0},t:{label:"Temp",unit:"°C",digits:1}};
function buildRegistry(){
  REG.clear();
  for(const k in S){
    const v=S[k];
    if(k==="snap"||k==="drives")continue;
    if(Array.isArray(v)){
      const m=META[k]||{};
      const any=v.some(x=>typeof x==="number");
      REG.set(k,{key:k,kind:"array",label:m.label||k,unit:m.unit||null,digits:m.digits??0,
        source:m.source||null,scaleKey:null,length:v.length,count:v.length,available:any,
        reason:any?null:(R[k]||"tidak ada sumber data"),value:v});
    }else REG.set(k,metricEntry(k,v,META[k]||{}));
  }
  (S.drives||[]).forEach((d,i)=>{
    const dev=d.dev||("drive"+i);
    REG.set("drive:"+dev,{key:"drive:"+dev,kind:"drive",dev,index:i,label:dev,available:true,reason:null,
      name:d.name,sizeGB:d.sizeGB,link:d.link,linkMax:d.linkMax,sched:d.sched,
      readahead:d.readahead,capUsed:d.capUsed,mount:d.mount});
    for(const p in DRIVE_COLS)
      REG.set(p+i,metricEntry(p+i,S[p+i],{label:dev+" "+DRIVE_COLS[p].label,unit:DRIVE_COLS[p].unit,
        digits:DRIVE_COLS[p].digits,source:"/proc/diskstats + /sys/block/"+dev}));
  });
  REG.set("gpuPresent",{key:"gpuPresent",kind:"presence",label:"GPU",available:!!(S.snap&&S.snap.gpuPresent),
    reason:S.snap&&S.snap.gpuPresent?null:"NVML tidak aktif dan tidak ada PCI display controller terdeteksi",
    source:"NVML atau PCI class 0300"});
  REG.set("backend",{key:"backend",kind:"presence",label:"Backend",available:online,
    reason:online?null:"server tidak merespons",source:SNAP_URL});
}

/* skala gauge dari DATA NYATA (ring buffer 60 sampel + nilai terkini) */
const dynMax=k=>{const arr=H[k]||[],cur=S[k];const all=arr.concat(typeof cur==="number"?[cur]:[]);
  return all.length?Math.max(...all):null};

/* ---- ctx: satu-satunya jalan theme membaca data ---- */
const ctx={
  get data(){return S}, get snap(){return S.snap}, get drives(){return S.drives},
  registry:REG, hist:k=>H[k]||[], max:dynMax, get reasons(){return R}, mock:MOCK,
  get online(){return online}, get recording(){return rec},
  fmt:{fx,val,esc,mmss,clamp,avg}, mk,
};

async function sample(){
  try{
    const r=await fetch(SNAP_URL,{cache:"no-store"});
    if(!r.ok) throw new Error(r.status);
    const d=await r.json();
    S={drives:[],snap:{},...d};
    online=true; $("#status").textContent=MOCK?"Backend: mock":"Backend: live";
    for(const k in d){const v=d[k];
      if(typeof v==="number"){(H[k]=H[k]||[]).push(v); if(H[k].length>60)H[k].shift()}
    }
    buildRegistry();
    if(theme)theme.update(ctx);
  }catch(e){
    online=false; $("#status").textContent=MOCK?"Backend: mock data gagal dimuat":"Backend: offline — run server.py";
    refreshTheme(); /* padanan chipsTop() lama — tidak menyentuh rail */
  }
}
async function health(){
  try{const r=await fetch(HEALTH_URL,{cache:"no-store"});if(!r.ok)throw new Error(r.status);
    R=(await r.json()).items||{};}catch(e){/* backend offline: keep last reasons */}
}
/* padanan chipsTop() lama: hook opsional theme, aman di tab Log */
function refreshTheme(){if(theme&&theme.chips)theme.chips(ctx);}

/* ---- pemilihan theme: ?theme=nama > localStorage > default ---- */
function themeName(){
  const q=params.get("theme"); if(q)return q;
  try{const st=localStorage.getItem("nt.theme"); if(st)return st;}catch(e){}
  return "default";
}
function initPalette(){
  const pals=(themeMeta&&themeMeta.palettes)||["light","dark"];
  let p=null; try{p=localStorage.getItem("nt.palette");}catch(e){}
  if(!p||pals.indexOf(p)<0){
    p=(window.matchMedia?window.matchMedia("(prefers-color-scheme:dark)").matches:false)?"dark":"light";
    if(pals.indexOf(p)<0)p=pals[0];
  }
  const th=$("#theme");
  th.innerHTML=pals.map(x=>`<option value="${x}">${x[0].toUpperCase()+x.slice(1)}</option>`).join("");
  th.value=p; document.documentElement.dataset.theme=p;
  th.onchange=()=>{try{localStorage.setItem("nt.palette",th.value);}catch(e){}
    document.documentElement.dataset.theme=th.value;};
}
async function loadTheme(){
  let themes=[];
  try{const r=await fetch("/api/themes",{cache:"no-store"}); if(r.ok)themes=(await r.json()).themes||[];}catch(e){}
  const name=themeName();
  themeMeta=themes.find(t=>t.name===name)||{name:name,palettes:["light","dark"]};
  const link=document.createElement("link");
  link.rel="stylesheet"; link.href="themes/"+encodeURIComponent(name)+"/theme.css";
  document.head.append(link);
  const sc=document.createElement("script");
  sc.src="themes/"+encodeURIComponent(name)+"/overview.js";
  sc.onerror=()=>{$("#status").textContent="Theme gagal dimuat";
    $("#root").innerHTML=`<div class="empty">Theme "${esc(name)}" tidak ditemukan di themes/${esc(name)}/overview.js. Pasang theme hanya dari sumber yang dipercaya.</div>`;};
  sc.onload=()=>{if(!theme)$("#status").textContent=`Theme "${name}" tidak mendaftar lewat Noterra.addTheme`;};
  document.body.append(sc);
}

/* ---- navigasi: Overview = theme, Log = milik core ---- */
function show(id){
  if(id!=="log")id="overview"; location.hash=id;
  document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.p===id));
  const root=$("#root");
  if(id==="log"){renderLog();return}
  if(theme)theme.mount(root,ctx); else root.innerHTML="";
}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>show(b.dataset.p));

/* ---- tab Log: sesi persisten di server, folder logs/<tanggal>_<label>/ ---- */
const METRICS=[["cpuT","CPU temp","°C","cpu_temp_c"],["cpuW","CPU power","W","cpu_power_w"],["gT","GPU temp","°C","gpu_temp_c"],["gW","GPU power","W","gpu_power_w"],["vbw","VRAM bandwidth","GB/s","vram_bw_gbs"],["prx","PCIe receive","GB/s","pcie_rx_gbs"],["majF","Major faults","/s","mem_major_faults_s"],["r0","NVMe 0 read","MB/s","nvme0_read_mbps"]];
const COL=["--a","--b","--ok","--warn","--bad"];
let SES=[],sel=new Set(),CSV={},lo={m:"cpuT",trim:0,grp:true,iv:1,lb:"",tg:""};
const f2=v=>typeof v==="number"?fx(v,Math.abs(v)<10?2:1):"unavailable";
function st(a){
  const v=a.filter(x=>typeof x==="number");
  if(!v.length)return null;
  const s=[...v].sort((x,y)=>x-y),m=avg(v);
  return{mean:m,med:s[s.length>>1],p95:s[Math.floor(s.length*.95)],sd:Math.sqrt(avg(v.map(x=>(x-m)**2))),min:s[0],max:s[v.length-1]};
}
async function loadSessions(){
  const r=await fetch("/api/log/sessions",{cache:"no-store"});
  SES=((await r.json()).sessions||[]).filter(s=>typeof s.id==="number");
  if(rec){const s=SES.find(x=>x.id===rec.id); if(s){rec.samples=s.samples; rec.mk=(s.markers||[]).length}}
}
async function toggleRec(){
  if(!rec){
    const iv=+$("#iv").value;
    const r=await fetch("/api/log/start",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({label:$("#lb").value.trim(),tag:$("#tg").value.trim(),interval:iv})});
    rec=await r.json(); rec.iv=iv; rec.samples=0; rec.mk=0;
    sel.add(rec.id);
    await loadSessions();
    rec.timer=setInterval(async()=>{
      if(!rec)return;
      await loadSessions();
      const t=$("#tm"); if(t)t.textContent=mmss(Math.round((rec.samples||0)*rec.iv));
      refreshTheme();
    },1000);
  } else {
    await fetch("/api/log/stop",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({id:rec.id})});
    clearInterval(rec.timer);
    rec=null; await loadSessions();
  }
  refreshTheme(); renderLog();
}
async function addMarker(){
  if(!rec)return;
  await fetch("/api/log/marker",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({id:rec.id})});
  await loadSessions();
  const e=$("#mk"); if(e)e.textContent="Add marker ("+(rec.mk||0)+")";
}
async function loadCsv(id){
  if(CSV[id])return CSV[id];
  const r=await fetch(`/api/log/${id}/samples.csv`);
  if(!r.ok)return null;
  const txt=await r.text();
  const d={ts:[],...Object.fromEntries(METRICS.map(([k])=>[k,[]]))};
  txt.split("\n").slice(1).forEach(ln=>{
    if(!ln)return;
    const p=ln.split(",");
    d.ts.push(+p[0]);
    METRICS.forEach(([k],i)=>{const v=p[i+1]; d[k].push(v===undefined||v===""?null:+v)});
  });
  CSV[id]=d; return d;
}
async function exportCsv(){
  for(const s of SES.filter(x=>sel.has(x.id))){
    const r=await fetch(`/api/log/${s.id}/samples.csv`);
    const t=await r.text();
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([t],{type:"text/csv"})); a.download=s.label+".csv"; a.click();
  }
}
async function renderLog(){
  await loadSessions();
  const root=$("#root"), r=!!rec;
  const rows=SES.map(s=>`<tr><td><input type="checkbox" data-id="${s.id}" ${sel.has(s.id)?"checked":""} aria-label="Select ${esc(s.label)}"></td><td>${esc(s.label)}${s.status==="recording"?' <span class="tag">recording</span>':""}</td><td><span class="tag">${esc(s.tag||"none")}</span></td><td>${esc(s.started_iso||String(s.start_ms))}</td><td>${mmss(Math.round(s.samples*(s.interval_s||1)))}</td><td>${s.interval_s} s</td><td>${s.samples}</td><td>${(s.markers||[]).length}</td><td><button class="btn" data-del="${s.id}">Delete</button></td></tr>`).join("");
  root.innerHTML=`<div class="bar-top"><input id="lb" placeholder="Session label" size="22" value="${esc(lo.lb)}"><input id="tg" placeholder="Tag (groups repeated runs)" size="24" value="${esc(lo.tg)}">
    <label>Interval <select id="iv" ${r?"disabled":""}>${[.5,1,5].map(v=>`<option value="${v}" ${v===(r?rec.iv:lo.iv)?"selected":""}>${v} s</option>`).join("")}</select></label>
    <button class="btn ${r?"on":""}" id="rc">${r?"Stop and save":"Start recording"}</button><span class="timer" id="tm">${r?mmss(Math.round((rec.samples||0)*rec.iv)):"00:00"}</span>
    <button class="btn" id="mk" ${r?"":"disabled"}>Add marker${r?" ("+(rec.mk||0)+")":""}</button><span class="grow"></span><button class="btn" id="ex" ${sel.size?"":"disabled"}>Export CSV</button></div>
    <div class="stack"><section class="p" style="display:block"><h2>Sessions</h2><div class="sub" style="margin:2px 0 16px">${SES.length} tersimpan di server (folder logs/). Interval & marker ikut tersimpan di meta.json.</div>
    ${SES.length?`<table><tr><th></th><th>Name</th><th>Tag</th><th>Started</th><th>Length</th><th>Interval</th><th>Samples</th><th>Markers</th><th></th></tr>${rows}</table>`:`<div class="empty">No logs yet. Start a recording to create one.</div>`}</section>
    <section class="p" style="display:block"><h2>Analysis</h2><div class="sub" id="asub" style="margin:2px 0 16px">0 selected</div><div id="an"><div class="empty">Select one or more sessions above to analyze them.</div></div></section></div>`;
  $("#lb").oninput=e=>lo.lb=e.target.value; $("#tg").oninput=e=>lo.tg=e.target.value; $("#iv").onchange=e=>lo.iv=+e.target.value;
  $("#rc").onclick=toggleRec; $("#ex").onclick=exportCsv; $("#mk").onclick=addMarker;
  root.querySelectorAll("[data-id]").forEach(c=>c.onchange=()=>{const id=+c.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);renderLog()});
  root.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{const id=+b.dataset.id;
    await fetch(`/api/log/${id}`,{method:"DELETE"}); sel.delete(id); delete CSV[id]; await loadSessions(); renderLog()});
  const ss=SES.filter(s=>sel.has(s.id));
  $("#asub").textContent=ss.length+" selected";
  if(!ss.length)return;
  const cs=await Promise.all(ss.map(s=>loadCsv(s.id)));
  const M=METRICS.find(x=>x[0]===lo.m);
  const arrs=cs.map(c=>c?c[lo.m].slice(Math.round(lo.trim/(ss[0].interval_s||1))).filter(v=>typeof v==="number"):[]);
  const S2=arrs.map(st);
  const line=(l,x,c)=>`<tr${c?' class="grp"':""}><td>${l}</td>${["mean","med","p95","sd","min","max"].map(k=>`<td>${x?f2(x[k]):"unavailable"}</td>`).join("")}</tr>`;
  let tb=ss.map((s,i)=>line(`<i style="display:inline-block;width:10px;height:3px;border-radius:2px;background:var(${COL[i%5]});margin-right:8px;vertical-align:middle"></i>${esc(s.label)}`,S2[i])).join("");
  if(lo.grp){
    const g={};ss.forEach((s,i)=>{if(S2[i])(g[s.tag||"none"]=g[s.tag||"none"]||[]).push(S2[i])});
    Object.entries(g).filter(([,v])=>v.length>1).forEach(([t,v])=>{const m=k=>avg(v.map(x=>x[k]));
      tb+=line(`Average of ${v.length} runs (${esc(t)})`,{mean:m("mean"),med:m("med"),p95:m("p95"),sd:st(v.map(x=>x.mean)).sd,min:Math.min(...v.map(x=>x.min)),max:Math.max(...v.map(x=>x.max))},1)});
  }
  const flat=o=>{const r={};const walk=(v,p)=>{if(v&&typeof v==="object"){for(const k in v)walk(v[k],p?p+"."+k:k)}else r[p]=v};walk(o,"");return r};
  const cfgs=ss.map(s=>({...flat(s.config||{}),tag:s.tag||"none",interval_s:s.interval_s}));
  const keys=[...new Set(cfgs.flatMap(c=>Object.keys(c)))].filter(k=>new Set(cfgs.map(c=>JSON.stringify(c[k]))).size>1);
  const hasData=arrs.some(a=>a.length);
  $("#an").innerHTML=`<div class="ctl"><label>Metric <select id="mt">${METRICS.map(m=>`<option value="${m[0]}" ${m[0]===lo.m?"selected":""}>${m[1]} (${m[2]})</option>`).join("")}</select></label>
    <label>Skip first <span class="fld"><input type="number" id="tr" min="0" step="5" value="${lo.trim}" aria-label="Seconds to skip"><em>s</em></span></label>
    <label><input type="checkbox" id="gp" ${lo.grp?"checked":""}> Average runs with the same tag</label></div>
    ${hasData?`<svg class="sp lg" id="ov" viewBox="0 0 200 60" preserveAspectRatio="none"></svg>`:""}
    <div class="hint lg">${M[1]} (${M[2]}) dari CSV server. ${hasData?"Sample yang di-skip tidak masuk chart/statistik. Marker tersimpan di meta.json.":"Tidak ada sample untuk metrik ini — mungkin unavailable di mesin ini."}</div>
    <h3 style="margin-top:18px">Statistics</h3><table class="n"><tr><th>Session</th><th>Mean</th><th>Median</th><th>p95</th><th>Std dev</th><th>Min</th><th>Max</th></tr>${tb}</table>
    ${lo.grp?`<div class="hint lg">Untuk baris average, std dev = spread antar run.</div>`:""}
    <h3 style="margin-top:18px">Perbedaan konfigurasi sesi</h3>${keys.length?`<table class="n"><tr><th>Field</th>${ss.map(s=>`<th>${esc(s.label)}</th>`).join("")}</tr>${keys.map(k=>`<tr><td>${k}</td>${cfgs.map(c=>`<td>${esc(String(c[k]))}</td>`).join("")}</tr>`).join("")}</table>`:`<div class="hint lg">Semua sesi terpilih punya konfigurasi (governor/EPP/turbo/sysctl/power limit) yang sama.</div>`}`;
  $("#mt").onchange=e=>{lo.m=e.target.value;renderLog()}; $("#tr").onchange=e=>{lo.trim=Math.max(0,+e.target.value||0);renderLog()}; $("#gp").onchange=e=>{lo.grp=e.target.checked;renderLog()};
  const ov=$("#ov");
  if(ov) overlay(ov,arrs,ss.map(s=>s.interval_s||1));
}
function overlay(svg,arrs,ivs){
  const keep=arrs.map((a,i)=>[a,ivs[i]]).filter(([a])=>a.length>1);
  if(!keep.length){svg.innerHTML="";return}
  const all=keep.flatMap(([a])=>a),mn=Math.min(...all),sp=(Math.max(...all)-mn)||1,D=Math.max(...keep.map(([a,i])=>a.length*ivs[i]));
  svg.innerHTML=keep.map(([a,i])=>`<path class="l" style="stroke:var(${COL[i%5]})" d="${a.map((v,j)=>`${j?"L":"M"}${(j*ivs[i]/D*200).toFixed(1)},${(58-(v-mn)/sp*56).toFixed(1)}`).join("")}"/>`).join("");
}

/* ---- polling start-up: idempoten, cukup dipanggil sekali ---- */
let STARTED=false;
function start(){
  if(STARTED)return;
  STARTED=true;
  sample(); health();
  setInterval(sample,1000); setInterval(health,5000);
}

/* ---- titik masuk: daftar theme dari server, muat theme terpilih ---- */
window.Noterra={
  addTheme(name,th){theme=th; initPalette(); show(location.hash.slice(1)); start();},
  start,
  ctx, registry:REG, fmt:{fx,val,esc,mmss,clamp,avg}, mk, themeName, mock:MOCK,
};
loadTheme();
})();
