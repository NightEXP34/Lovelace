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

/* ---- id DOM yang dipakai core; index.html wajib menyediakan empat pertama ---- */
const DOM={
  nav:"#nav", status:"#status", theme:"#theme", root:"#root",
  iv:"#iv", lb:"#lb", tg:"#tg", tm:"#tm", mk:"#mk", rc:"#rc", ex:"#ex",
  asub:"#asub", an:"#an", mt:"#mt", tr:"#tr", gp:"#gp", ov:"#ov",
};

/* ---- mode: ?mock=1 memakai snapshot-sample.json, tanpa hardware ---- */
const params=new URLSearchParams(location.search);
const MOCK=params.get("mock")==="1";
const SNAP_URL=MOCK?"/api/mock/snapshot":"/api/snapshot";
const HEALTH_URL=MOCK?"/api/mock/health":"/api/health";
const SCHEMA_URL=MOCK?"/api/mock/schema":"/api/schema";

let S={snap:{},drives:[]}, H={}, R={}, online=false, rec=null;
const REG=new Map();               // registry metrik, rebuild tiap snapshot
const WIDGETS=new Map();           // widget registry: nama -> {mount,update}
let theme=null, themeMeta=null;

/* ---- metadata metrik: di-fetch dari /api/schema (noterra/metrics_meta.json) ---- */
let META={};

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
    online=true; $(DOM.status).textContent=MOCK?"Backend: mock":"Backend: live";
    for(const k in d){const v=d[k];
      if(typeof v==="number"){(H[k]=H[k]||[]).push(v); if(H[k].length>60)H[k].shift()}
    }
    buildRegistry();
    if(theme&&theme.update)theme.update(ctx);
    const v=VIEWS.get(activeView);
    if(v&&v.update)v.update(ctx);
  }catch(e){
    online=false; $(DOM.status).textContent=MOCK?"Backend: mock data gagal dimuat":"Backend: offline — run server.py";
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
  const th=$(DOM.theme);
  th.innerHTML=pals.map(x=>`<option value="${x}">${x[0].toUpperCase()+x.slice(1)}</option>`).join("");
  th.value=p; document.documentElement.dataset.theme=p;
  th.onchange=()=>{try{localStorage.setItem("nt.palette",th.value);}catch(e){}
    document.documentElement.dataset.theme=th.value;};
}
/* metadata metrik dari server; key tak dikenal fallback label = key */
async function loadSchema(){
  try{
    const r=await fetch(SCHEMA_URL,{cache:"no-store"});
    if(r.ok){const d=await r.json(); if(d&&typeof d==="object")META=d;}
  }catch(e){/* offline: registry memakai key sebagai label */}
}
async function loadTheme(){
  await loadSchema();
  let themes=[];
  try{const r=await fetch("/api/themes",{cache:"no-store"}); if(r.ok)themes=(await r.json()).themes||[];}catch(e){}
  const name=themeName();
  themeMeta=themes.find(t=>t.name===name)||{name:name,palettes:["light","dark"]};
  const lp=params.get("layout");
  const entry=(themeMeta&&themeMeta.entry)||"overview.js";
  const css=(themeMeta&&themeMeta.css)||"theme.css";
  const link=document.createElement("link");
  link.rel="stylesheet"; link.href="themes/"+encodeURIComponent(name)+"/"+css;
  document.head.append(link);
  // theme tanpa script: overview langsung dari layout.json (L2)
  if(!themeMeta.entry&&(lp||themeMeta.layout)){
    registerLayoutTheme(name,lp||themeMeta.layout);
    return;
  }
  const sc=document.createElement("script");
  sc.src="themes/"+encodeURIComponent(name)+"/"+entry;
  sc.onerror=()=>{$(DOM.status).textContent="Theme gagal dimuat";
    $(DOM.root).innerHTML=`<div class="empty">Theme "${esc(name)}" tidak ditemukan di themes/${esc(name)}/${esc(entry)}. Pasang theme hanya dari sumber yang dipercaya.</div>`;};
  sc.onload=()=>{if(!theme)$(DOM.status).textContent=`Theme "${name}" tidak mendaftar lewat Noterra.addTheme`;};
  document.body.append(sc);
}

/* ---- navigasi: view registry (Log milik core, Overview dari addTheme) ---- */
const VIEWS=new Map();            // id -> {id,label,order,mount,update}
let activeView="overview";
function renderNav(){
  const nav=$(DOM.nav); if(!nav)return;
  const vs=[...VIEWS.values()].sort((a,b)=>(a.order??100)-(b.order??100));
  nav.innerHTML=`<h1>Monitor</h1>
${vs.map(v=>`  <button data-p="${esc(v.id)}">${esc(v.label)}</button>`).join("\n")}
  <div class="foot"><label>Theme <select id="theme"></select></label><span id="status">Backend: offline</span></div>
`;
  nav.querySelectorAll("button").forEach(b=>b.onclick=()=>show(b.dataset.p));
}
function addView(id,v){
  VIEWS.set(id,{id,label:v.label||id,order:v.order??100,mount:v.mount,update:v.update});
  renderNav();
}
/* widget registry: theme/widgets.js yang mendaftarkan implementasinya */
function addWidget(name,w){WIDGETS.set(name,w);}

/* view overview dari file layout (tanpa JavaScript milik theme) */
function layoutView(name,file){
  let inst=null, seq=0;
  return{
    mount(root,c){
      const my=++seq;
      root.innerHTML=`<div class="empty">Memuat layout ${esc(file)}…</div>`;
      fetch("themes/"+encodeURIComponent(name)+"/"+file,{cache:"no-store"})
        .then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.text()})
        .then(txt=>{
          if(my!==seq)return;
          inst=window.Noterra.renderLayout?window.Noterra.renderLayout(root,txt,c):null;
          if(!inst)root.innerHTML=`<div class="layout-error">Renderer layout tidak tersedia (widgets.js belum dimuat).</div>`;
        })
        .catch(e=>{if(my!==seq)return;
          root.innerHTML=`<div class="layout-error">Layout "${esc(file)}" gagal dimuat: ${esc(e.message||e)}</div>`;});
    },
    update(c){if(inst&&inst.update)inst.update(c);}
  };
}
/* theme L2 murni: tidak ada script, overview = layout.json */
function registerLayoutTheme(name,file){
  theme=null;
  addView("overview",{label:"Overview",order:0,...layoutView(name,file)});
  initPalette(); show(location.hash.slice(1)); start();
}
function show(id){
  if(!VIEWS.has(id))id="overview";
  activeView=id;
  if(id!=="log")location.hash=id;
  document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.p===id));
  const root=$(DOM.root), v=VIEWS.get(id);
  root.classList.remove("layout-host");
  if(v&&v.mount)v.mount(root,ctx); else root.innerHTML="";
}

/* ---- tab Log: sesi persisten di server, folder logs/<tanggal>_<label>/ ---- */
const METRICS=[["cpuT","CPU temp","°C","cpu_temp_c"],["cpuW","CPU power","W","cpu_power_w"],["gT","GPU temp","°C","gpu_temp_c"],["gW","GPU power","W","gpu_power_w"],["vbw","VRAM bandwidth","GB/s","vram_bw_gbs"],["prx","PCIe receive","GB/s","pcie_rx_gbs"],["majF","Major faults","/s","mem_major_faults_s"],["r0","NVMe 0 read","MB/s","nvme0_read_mbps"]];
/* header CSV -> key registry; fallback: nama kolom yang kebetulan sama dengan key */
const HEADER_TO_KEY={"cpu_temp_c":"cpuT","cpu_power_w":"cpuW","gpu_temp_c":"gT","gpu_power_w":"gW",
  "vram_bw_gbs":"vbw","pcie_rx_gbs":"prx","mem_major_faults_s":"majF","nvme0_read_mbps":"r0"};
let LOG_METRICS=METRICS;          // [key,label,unit]; diperbarui dari header CSV
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
    const iv=+$(DOM.iv).value;
    const r=await fetch("/api/log/start",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({label:$(DOM.lb).value.trim(),tag:$(DOM.tg).value.trim(),interval:iv})});
    rec=await r.json(); rec.iv=iv; rec.samples=0; rec.mk=0;
    sel.add(rec.id);
    await loadSessions();
    rec.timer=setInterval(async()=>{
      if(!rec)return;
      await loadSessions();
      const t=$(DOM.tm); if(t)t.textContent=mmss(Math.round((rec.samples||0)*rec.iv));
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
  const e=$(DOM.mk); if(e)e.textContent="Add marker ("+(rec.mk||0)+")";
}
async function loadCsv(id){
  if(CSV[id])return CSV[id];
  const r=await fetch(`/api/log/${id}/samples.csv`);
  if(!r.ok)return null;
  const txt=await r.text();
  const lines=txt.split("\n");
  const cols=(lines[0]||"").replace(/\r$/,"").split(",").map(c=>c.trim());
  // header asli tidak memuat timestamp_ms, jadi data bergeser satu kolom;
  // kalau suatu saat header memuatnya, offset menyesuaikan.
  const off=cols[0]==="timestamp_ms"?0:1;
  const found=[];
  cols.forEach((col,i)=>{
    if(!col||col==="timestamp_ms")return;
    const key=HEADER_TO_KEY[col]||(REG.has(col)?col:null);
    if(!key)return;
    const old=METRICS.find(x=>x[0]===key), e=REG.get(key);
    found.push([key,old?old[1]:((e&&e.label)||key),old?old[2]:((e&&e.unit)||""),i+off]);
  });
  let use;
  if(found.length){use=found; LOG_METRICS=found.map(([k,l,u])=>[k,l,u]);}
  else{use=METRICS.map(([k,l,u],i)=>[k,l,u,i+1]); LOG_METRICS=METRICS;}
  const d={ts:[],...Object.fromEntries(use.map(([k])=>[k,[]]))};
  lines.slice(1).forEach(ln=>{
    ln=ln.replace(/\r$/,""); if(!ln)return;
    const p=ln.split(",");
    d.ts.push(+p[0]);
    use.forEach(([k,,,idx])=>{const v=p[idx]; d[k].push(v===undefined||v===""?null:+v)});
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
  const root=$(DOM.root), r=!!rec;
  const rows=SES.map(s=>`<tr><td><input type="checkbox" data-id="${s.id}" ${sel.has(s.id)?"checked":""} aria-label="Select ${esc(s.label)}"></td><td>${esc(s.label)}${s.status==="recording"?' <span class="tag">recording</span>':""}</td><td><span class="tag">${esc(s.tag||"none")}</span></td><td>${esc(s.started_iso||String(s.start_ms))}</td><td>${mmss(Math.round(s.samples*(s.interval_s||1)))}</td><td>${s.interval_s} s</td><td>${s.samples}</td><td>${(s.markers||[]).length}</td><td><button class="btn" data-del="${s.id}">Delete</button></td></tr>`).join("");
  root.innerHTML=`<div class="bar-top"><input id="lb" placeholder="Session label" size="22" value="${esc(lo.lb)}"><input id="tg" placeholder="Tag (groups repeated runs)" size="24" value="${esc(lo.tg)}">
    <label>Interval <select id="iv" ${r?"disabled":""}>${[.5,1,5].map(v=>`<option value="${v}" ${v===(r?rec.iv:lo.iv)?"selected":""}>${v} s</option>`).join("")}</select></label>
    <button class="btn ${r?"on":""}" id="rc">${r?"Stop and save":"Start recording"}</button><span class="timer" id="tm">${r?mmss(Math.round((rec.samples||0)*rec.iv)):"00:00"}</span>
    <button class="btn" id="mk" ${r?"":"disabled"}>Add marker${r?" ("+(rec.mk||0)+")":""}</button><span class="grow"></span><button class="btn" id="ex" ${sel.size?"":"disabled"}>Export CSV</button></div>
    <div class="stack"><section class="p" style="display:block"><h2>Sessions</h2><div class="sub" style="margin:2px 0 16px">${SES.length} tersimpan di server (folder logs/). Interval & marker ikut tersimpan di meta.json.</div>
    ${SES.length?`<table><tr><th></th><th>Name</th><th>Tag</th><th>Started</th><th>Length</th><th>Interval</th><th>Samples</th><th>Markers</th><th></th></tr>${rows}</table>`:`<div class="empty">No logs yet. Start a recording to create one.</div>`}</section>
    <section class="p" style="display:block"><h2>Analysis</h2><div class="sub" id="asub" style="margin:2px 0 16px">0 selected</div><div id="an"><div class="empty">Select one or more sessions above to analyze them.</div></div></section></div>`;
  $(DOM.lb).oninput=e=>lo.lb=e.target.value; $(DOM.tg).oninput=e=>lo.tg=e.target.value; $(DOM.iv).onchange=e=>lo.iv=+e.target.value;
  $(DOM.rc).onclick=toggleRec; $(DOM.ex).onclick=exportCsv; $(DOM.mk).onclick=addMarker;
  root.querySelectorAll("[data-id]").forEach(c=>c.onchange=()=>{const id=+c.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);renderLog()});
  root.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{const id=+b.dataset.id;
    await fetch(`/api/log/${id}`,{method:"DELETE"}); sel.delete(id); delete CSV[id]; await loadSessions(); renderLog()});
  const ss=SES.filter(s=>sel.has(s.id));
  $(DOM.asub).textContent=ss.length+" selected";
  if(!ss.length)return;
  const cs=await Promise.all(ss.map(s=>loadCsv(s.id)));
  const M=LOG_METRICS.find(x=>x[0]===lo.m)||LOG_METRICS[0]||METRICS[0];
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
  $(DOM.an).innerHTML=`<div class="ctl"><label>Metric <select id="mt">${LOG_METRICS.map(m=>`<option value="${m[0]}" ${m[0]===lo.m?"selected":""}>${m[1]} (${m[2]})</option>`).join("")}</select></label>
    <label>Skip first <span class="fld"><input type="number" id="tr" min="0" step="5" value="${lo.trim}" aria-label="Seconds to skip"><em>s</em></span></label>
    <label><input type="checkbox" id="gp" ${lo.grp?"checked":""}> Average runs with the same tag</label></div>
    ${hasData?`<svg class="sp lg" id="ov" viewBox="0 0 200 60" preserveAspectRatio="none"></svg>`:""}
    <div class="hint lg">${M[1]} (${M[2]}) dari CSV server. ${hasData?"Sample yang di-skip tidak masuk chart/statistik. Marker tersimpan di meta.json.":"Tidak ada sample untuk metrik ini — mungkin unavailable di mesin ini."}</div>
    <h3 style="margin-top:18px">Statistics</h3><table class="n"><tr><th>Session</th><th>Mean</th><th>Median</th><th>p95</th><th>Std dev</th><th>Min</th><th>Max</th></tr>${tb}</table>
    ${lo.grp?`<div class="hint lg">Untuk baris average, std dev = spread antar run.</div>`:""}
    <h3 style="margin-top:18px">Perbedaan konfigurasi sesi</h3>${keys.length?`<table class="n"><tr><th>Field</th>${ss.map(s=>`<th>${esc(s.label)}</th>`).join("")}</tr>${keys.map(k=>`<tr><td>${k}</td>${cfgs.map(c=>`<td>${esc(String(c[k]))}</td>`).join("")}</tr>`).join("")}</table>`:`<div class="hint lg">Semua sesi terpilih punya konfigurasi (governor/EPP/turbo/sysctl/power limit) yang sama.</div>`}`;
  $(DOM.mt).onchange=e=>{lo.m=e.target.value;renderLog()}; $(DOM.tr).onchange=e=>{lo.trim=Math.max(0,+e.target.value||0);renderLog()}; $(DOM.gp).onchange=e=>{lo.grp=e.target.checked;renderLog()};
  const ov=$(DOM.ov);
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
addView("log",{label:"Log",order:10,mount(){renderLog();}});
window.Noterra={
  addTheme(name,th){
    const file=params.get("layout")||((!th.mount&&themeMeta&&themeMeta.layout)?themeMeta.layout:null);
    if(file){
      theme=null;
      addView("overview",{label:"Overview",order:0,...layoutView(name,file)});
    }else{
      theme=th;
      addView("overview",{label:"Overview",order:0,mount(root,ctx){
        if(th.mount)th.mount(root,ctx);
        else root.innerHTML=`<div class="empty">Theme "${esc(name)}" tidak punya mount dan tidak punya layout.json.</div>`;
      }});
    }
    initPalette(); show(location.hash.slice(1)); start();
  },
  start, addView, addWidget, widgets:WIDGETS,
  ctx, registry:REG, fmt:{fx,val,esc,mmss,clamp,avg}, mk, themeName, mock:MOCK,
};
loadTheme();
})();
