/* client.js — data client headless (L4). TIDAK menyentuh DOM: fetch snapshot/
   health/schema, ring buffer 60 sampel, registry metrik, ctx, dan hook
   ctx.on("update"|"offline", fn). Shell (shell.js) yang memegang DOM. */
(function(){
"use strict";

/* ---- format angka: kontrak data (tanpa DOM) ---- */
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
const fx=(v,d=0)=>typeof v==="number"?v.toFixed(d):"unavailable";
const val=(v,d=0)=>typeof v==="number"?v.toFixed(d):"—";
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const mmss=t=>String(t/60|0).padStart(2,"0")+":"+String(t%60).padStart(2,"0");

/* ---- mode: ?mock=1 memakai snapshot-sample.json, tanpa hardware ---- */
const params=new URLSearchParams(location.search);
const MOCK=params.get("mock")==="1";
const SNAP_URL=MOCK?"/api/mock/snapshot":"/api/snapshot";
const HEALTH_URL=MOCK?"/api/mock/health":"/api/health";
const SCHEMA_URL=MOCK?"/api/mock/schema":"/api/schema";

let S={snap:{},drives:[]}, H={}, R={}, online=false;
const REG=new Map();               // registry metrik, rebuild tiap snapshot
const WIDGETS=new Map();           // widget registry (implementasi di widgets.js)
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
  for(const e of REG.values())e.reason=e.reason||null;
}

/* skala gauge dari DATA NYATA (ring buffer 60 sampel + nilai terkini) */
const dynMax=k=>{const arr=H[k]||[],cur=S[k];const all=arr.concat(typeof cur==="number"?[cur]:[]);
  return all.length?Math.max(...all):null};

/* ---- ctx: satu-satunya jalan theme membaca data ---- */
const ctx={
  get data(){return S}, get snap(){return S.snap}, get drives(){return S.drives},
  registry:REG, hist:k=>H[k]||[], max:dynMax, get reasons(){return R}, mock:MOCK,
  get online(){return online},
  fmt:{fx,val,esc,mmss,clamp,avg},
};
const EV={update:new Set(),offline:new Set()};
ctx.on=(ev,fn)=>{if(!EV[ev])return()=>{};EV[ev].add(fn);return()=>EV[ev].delete(fn);};
function emit(ev){for(const fn of EV[ev]){try{fn(ctx)}catch(e){console.error(e)}}}

async function sample(){
  try{
    const r=await fetch(SNAP_URL,{cache:"no-store"});
    if(!r.ok) throw new Error(r.status);
    const d=await r.json();
    S={drives:[],snap:{},...d};
    online=true;
    for(const k in d){const v=d[k];
      if(typeof v==="number"){(H[k]=H[k]||[]).push(v); if(H[k].length>60)H[k].shift()}
    }
    buildRegistry();
    emit("update");
  }catch(e){
    online=false;
    emit("offline");
  }
}
async function health(){
  try{const r=await fetch(HEALTH_URL,{cache:"no-store"});if(!r.ok)throw new Error(r.status);
    R=(await r.json()).items||{};}catch(e){/* backend offline: keep last reasons */}
}

/* metadata metrik dari server; key tak dikenal fallback label = key */
async function loadSchema(){
  try{
    const r=await fetch(SCHEMA_URL,{cache:"no-store"});
    if(r.ok){const d=await r.json(); if(d&&typeof d==="object")META=d;}
  }catch(e){/* offline: registry memakai key sebagai label */}
}

/* polling start-up: idempoten, cukup dipanggil sekali (oleh shell/addTheme) */
let STARTED=false;
function start(){
  if(STARTED)return;
  STARTED=true;
  sample(); health();
  setInterval(sample,1000); setInterval(health,5000);
}

function markOffline(){online=false;}
window.Noterra={
  start, sample, health, loadSchema, markOffline,
  addWidget(name,w){WIDGETS.set(name,w);},
  widgets:WIDGETS,
  ctx, registry:REG, fmt:{fx,val,esc,mmss,clamp,avg}, mock:MOCK,
};
})();
