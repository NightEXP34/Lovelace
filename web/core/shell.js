/* shell.js — bagian DOM: nav, status, pemilihan theme, view registry, tab Log.
   Data ada di client.js (headless); theme hanya membaca ctx. */
(function(){
"use strict";
const N=window.Noterra;
if(!N||!N.ctx)throw new Error("shell.js butuh client.js");

/* ---- format angka (kontrak: core yang memformat, theme yang menata) ---- */
const $=s=>document.querySelector(s);
const mk=h=>{const d=document.createElement("div");d.innerHTML=h;return d};
const {clamp,avg,fx,val,esc,mmss}=N.fmt;
const ctx=N.ctx, REG=N.registry, MOCK=N.mock;
const dataStart=N.start.bind(N);
const params=new URLSearchParams(location.search);
let theme=null, themeMeta=null, rec=null;
Object.defineProperty(ctx,"recording",{get:()=>rec,configurable:true});

/* ---- id DOM yang dipakai core; index.html wajib menyediakan empat pertama ---- */
const DOM={
  nav:"#nav", status:"#status", theme:"#theme", root:"#root",
  iv:"#iv", lb:"#lb", tg:"#tg", tm:"#tm", mk:"#mk", rc:"#rc", ex:"#ex",
  asub:"#asub", an:"#an", mt:"#mt", tr:"#tr", gp:"#gp", ov:"#ov",
};

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
async function loadTheme(){
  await N.loadSchema();
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
  <div class="foot"><label>Palette <select id="theme"></select></label><span id="status">Backend: offline</span></div>
`;
  nav.querySelectorAll("button").forEach(b=>b.onclick=()=>show(b.dataset.p));
}
function addView(id,v){
  VIEWS.set(id,{id,label:v.label||id,order:v.order??100,mount:v.mount,update:v.update});
  renderNav();
}
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
  root.classList.remove("log-host");
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
  const rows=SES.map(s=>`<tr class="${sel.has(s.id)?"is-sel":""}"><td class="check"><input type="checkbox" data-id="${s.id}" ${sel.has(s.id)?"checked":""} aria-label="Select ${esc(s.label)}"></td><td><b>${esc(s.label)}</b>${s.status==="recording"?' <span class="tag">recording</span>':""}</td><td><span class="tag">${esc(s.tag||"none")}</span></td><td class="mono">${esc(s.started_iso||String(s.start_ms))}</td><td class="mono">${mmss(Math.round(s.samples*(s.interval_s||1)))}</td><td>${s.interval_s} s</td><td class="mono">${s.samples}</td><td class="mono">${(s.markers||[]).length}</td><td><button class="btn ghost" data-del="${s.id}">Delete</button></td></tr>`).join("");
  const sessions=SES.length?`<div class="log-table-wrap"><table class="log-table"><thead><tr><th class="check"></th><th>Name</th><th>Tag</th><th>Started</th><th>Length</th><th>Interval</th><th>Samples</th><th>Markers</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="log-empty">No logs yet. Mulai rekaman untuk membuat sesi pertama.</div>`;
  root.innerHTML=`<div class="log">
    <header class="log-head">
      <div>
        <div class="log-kicker">RECORDING / ANALYSIS</div>
        <h1>Log sessions</h1>
        <p class="log-sub">Rekam snapshot server-side, bandingkan sesi, lalu ekspor CSV. Semua data dari folder <code>logs/</code>.</p>
      </div>
      <div class="log-head-actions">
        <span class="log-live ${r?"on":""}"><i></i>${r?"recording":"idle"}</span>
        <button class="btn" id="ex" ${sel.size?"":"disabled"}>Export CSV</button>
      </div>
    </header>

    <section class="log-toolbar">
      <label class="log-field"><span>Session label</span><input id="lb" placeholder="mis. cold-run" value="${esc(lo.lb)}"></label>
      <label class="log-field"><span>Tag</span><input id="tg" placeholder="grup run berulang" value="${esc(lo.tg)}"></label>
      <label class="log-field narrow"><span>Interval</span><select id="iv" ${r?"disabled":""}>${[.5,1,5].map(v=>`<option value="${v}" ${v===(r?rec.iv:lo.iv)?"selected":""}>${v} s</option>`).join("")}</select></label>
      <button class="btn ${r?"on":""}" id="rc">${r?"Stop and save":"Start recording"}</button>
      <span class="timer" id="tm">${r?mmss(Math.round((rec.samples||0)*rec.iv)):"00:00"}</span>
      <button class="btn" id="mk" ${r?"":"disabled"}>Add marker${r?" ("+(rec.mk||0)+")":""}</button>
    </section>

    <section class="log-card">
      <div class="log-card-head">
        <div><h2>Sessions</h2><p>${SES.length} tersimpan di server (folder logs/). Interval & marker ikut tersimpan di meta.json.</p></div>
        <span class="log-count">${SES.length} sesi</span>
      </div>
      ${sessions}
    </section>

    <section class="log-card">
      <div class="log-card-head"><div><h2>Analysis</h2><p id="asub">0 selected</p></div></div>
      <div id="an"><div class="log-empty">Pilih satu atau lebih sesi di atas untuk dianalisis.</div></div>
    </section>
  </div>`;
  $(DOM.lb).oninput=e=>lo.lb=e.target.value; $(DOM.tg).oninput=e=>lo.tg=e.target.value; $(DOM.iv).onchange=e=>lo.iv=+e.target.value;
  $(DOM.rc).onclick=toggleRec; $(DOM.ex).onclick=exportCsv; $(DOM.mk).onclick=addMarker;
  root.querySelectorAll("[data-id]").forEach(c=>c.onchange=()=>{const id=+c.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);renderLog()});
  root.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{const id=+b.dataset.id;
    await fetch(`/api/log/${id}`,{method:"DELETE"}); sel.delete(id); delete CSV[id]; await loadSessions(); renderLog()});
  const ss=SES.filter(s=>sel.has(s.id));
  $(DOM.asub).textContent=ss.length+" selected";
  if(!ss.length)return;
  const cs=await Promise.all(ss.map(s=>loadCsv(s.id)));
  if(!LOG_METRICS.some(x=>x[0]===lo.m)&&LOG_METRICS.length)lo.m=LOG_METRICS[0][0];
  const M=LOG_METRICS.find(x=>x[0]===lo.m)||LOG_METRICS[0]||METRICS[0];
  const arrs=cs.map(c=>c?c[lo.m].slice(Math.round(lo.trim/(ss[0].interval_s||1))).filter(v=>typeof v==="number"):[]);
  const S2=arrs.map(st);
  const line=(l,x,c)=>`<tr${c?' class="grp"':""}><td>${l}</td>${["mean","med","p95","sd","min","max"].map(k=>`<td>${x?f2(x[k]):"unavailable"}</td>`).join("")}</tr>`;
  let tb=ss.map((s,i)=>line(`<i class="legend-dot" style="background:var(${COL[i%5]})"></i>${esc(s.label)}`,S2[i])).join("");
  if(lo.grp){
    const g={};ss.forEach((s,i)=>{if(S2[i])(g[s.tag||"none"]=g[s.tag||"none"]||[]).push(S2[i])});
    Object.entries(g).filter(([,v])=>v.length>1).forEach(([t,v])=>{const m=k=>avg(v.map(x=>x[k]));
      tb+=line(`Average of ${v.length} runs (${esc(t)})`,{mean:m("mean"),med:m("med"),p95:m("p95"),sd:st(v.map(x=>x.mean)).sd,min:Math.min(...v.map(x=>x.min)),max:Math.max(...v.map(x=>x.max))},1)});
  }
  const flat=o=>{const r={};const walk=(v,p)=>{if(v&&typeof v==="object"){for(const k in v)walk(v[k],p?p+"."+k:k)}else r[p]=v};walk(o,"");return r};
  const cfgs=ss.map(s=>({...flat(s.config||{}),tag:s.tag||"none",interval_s:s.interval_s}));
  const keys=[...new Set(cfgs.flatMap(c=>Object.keys(c)))].filter(k=>new Set(cfgs.map(c=>JSON.stringify(c[k]))).size>1);
  const hasData=arrs.some(a=>a.length);
  $(DOM.an).innerHTML=`<div class="log-controls">
    <label class="log-field"><span>Metric</span><select id="mt">${LOG_METRICS.map(m=>`<option value="${m[0]}" ${m[0]===lo.m?"selected":""}>${m[1]} (${m[2]})</option>`).join("")}</select></label>
    <label class="log-field narrow"><span>Skip first</span><span class="fld"><input type="number" id="tr" min="0" step="5" value="${lo.trim}" aria-label="Seconds to skip"><em>s</em></span></label>
    <label class="log-check"><input type="checkbox" id="gp" ${lo.grp?"checked":""}> Average runs with the same tag</label>
    <span class="grow"></span><span class="log-count">${hasData?"sample tersedia":"tidak ada sample"}</span>
  </div>
  <div class="log-chart">
    <div class="log-chart-head"><span>${M[1]} <em>${M[2]}</em></span><span>${ss.length} sesi · ${arrs.reduce((n,a)=>n+a.length,0)} sample</span></div>
    <svg class="sp lg" id="ov" viewBox="0 0 720 180" preserveAspectRatio="none" aria-label="Grafik ${esc(M[1])}"></svg>
    <div class="log-legend">${ss.map((s,i)=>`<span><i style="background:var(${COL[i%5]})"></i>${esc(s.label)}</span>`).join("")}</div>
  </div>
  <div class="hint lg">${M[1]} (${M[2]}) dari CSV server. ${hasData?"Sample yang di-skip tidak masuk chart/statistik. Marker tersimpan di meta.json.":"Tidak ada sample untuk metrik ini — mungkin unavailable di mesin ini."}</div>
  <h3 class="log-h3">Statistics</h3>
  <div class="log-table-wrap"><table class="log-table n"><thead><tr><th>Session</th><th>Mean</th><th>Median</th><th>p95</th><th>Std dev</th><th>Min</th><th>Max</th></tr></thead><tbody>${tb}</tbody></table></div>
  ${lo.grp?`<div class="hint lg">Untuk baris average, std dev = spread antar run.</div>`:""}
  <h3 class="log-h3">Perbedaan konfigurasi sesi</h3>${keys.length?`<div class="log-table-wrap"><table class="log-table n"><thead><tr><th>Field</th>${ss.map(s=>`<th>${esc(s.label)}</th>`).join("")}</tr></thead><tbody>${keys.map(k=>`<tr><td>${k}</td>${cfgs.map(c=>`<td>${esc(String(c[k]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`:`<div class="log-empty small">Semua sesi terpilih punya konfigurasi (governor/EPP/turbo/sysctl/power limit) yang sama.</div>`}`;
  $(DOM.mt).onchange=e=>{lo.m=e.target.value;renderLog()}; $(DOM.tr).onchange=e=>{lo.trim=Math.max(0,+e.target.value||0);renderLog()}; $(DOM.gp).onchange=e=>{lo.grp=e.target.checked;renderLog()};
  overlay($(DOM.ov),arrs,ss.map(s=>s.interval_s||1));
}
function fmtAxis(v){
  const a=Math.abs(v);
  return v.toFixed(a<1?2:a<10?1:0);
}
function overlay(svg,arrs,ivs){
  if(!svg)return;
  const keep=arrs.map((a,i)=>[a,ivs[i]]).filter(([a])=>a.length>1);
  if(!keep.length){
    svg.innerHTML='<text class="chart-empty" x="360" y="96" text-anchor="middle">Tidak ada sample untuk metrik ini.</text>';
    return;
  }
  const all=keep.flatMap(([a])=>a),mn=Math.min(...all),mx=Math.max(...all),span=mx-mn;
  const W=720,H=180,L=48,R=14,T=18,B=28;
  const D=Math.max(...keep.map(([a,i])=>a.length*i))||1;
  const x=(j,i)=>L+(j*i/D)*(W-L-R);
  const y=v=>span===0?T+(H-T-B)/2:T+(1-(v-mn)/span)*(H-T-B);
  const grid=[0,.25,.5,.75,1].map(f=>{
    const gy=T+f*(H-T-B), val=mx-f*span;
    return `<line x1="${L}" y1="${gy.toFixed(1)}" x2="${W-R}" y2="${gy.toFixed(1)}"/><text x="${L-8}" y="${(gy+3).toFixed(1)}" text-anchor="end">${fmtAxis(val)}</text>`;
  }).join("");
  const paths=keep.map(([a,i],k)=>`<path class="l" style="stroke:var(${COL[k%5]})" d="${a.map((v,j)=>`${j?"L":"M"}${x(j,i).toFixed(1)},${y(v).toFixed(1)}`).join("")}"/>`).join("");
  svg.innerHTML=`<g class="grid">${grid}</g>${paths}`;
}

/* shell memakai polling idempoten dari client */
function start(){dataStart();}

/* ---- titik masuk: daftar theme dari server, muat theme terpilih ---- */
addView("log",{label:"Log",order:10,mount(root){root.classList.add("log-host");renderLog();}});
/* data update -> status + theme/view update; offline -> chips saja (perilaku lama) */
ctx.on("update",()=>{
  $(DOM.status).textContent=MOCK?"Backend: mock":"Backend: live";
  try{
    /* theme Overview tidak boleh di-update saat tab Log aktif: rail/panel
       tidak ada di DOM dan dulu membuat status jatuh ke offline. */
    if(activeView==="overview"&&theme&&theme.update)theme.update(ctx);
    const v=VIEWS.get(activeView); if(v&&v.update)v.update(ctx);
  }catch(e){
    /* perilaku lama: error render theme jatuh ke status offline + chips */
    N.markOffline();
    $(DOM.status).textContent=MOCK?"Backend: mock data gagal dimuat":"Backend: offline — run ./scripts/run.sh";
    refreshTheme();
  }
});
ctx.on("offline",()=>{
  $(DOM.status).textContent=MOCK?"Backend: mock data gagal dimuat":"Backend: offline — run ./scripts/run.sh";
  refreshTheme();
});
ctx.mk=mk;
Object.assign(N,{
  addTheme(name,th){
    const file=params.get("layout")||(themeMeta&&themeMeta.layout)||null;
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
  start:dataStart, addView,
  ctx, registry:REG, fmt:{fx,val,esc,mmss,clamp,avg}, mk, themeName, mock:MOCK,
});
loadTheme();
})();
