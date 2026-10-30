/* Theme default — overview.js. Hanya membaca registry + data lewat ctx
   (core yang fetch, parse, dan memformat). Tidak memanggil fetch sendiri.
   Mengekspor mount(root, ctx) dan update(ctx) lewat Noterra.addTheme. */
(function(){
"use strict";
const N=window.Noterra;
const {fx,val,esc,mmss,clamp,avg}=N.fmt;
const mk=N.mk;

let C=null, S=null, R=null;   // ctx, ctx.data, ctx.reasons — di-refresh tiap update
const H=k=>C.hist(k);
const dynMax=k=>C.max(k);

function spark(svg,keys,cols,min){
  const pairs=keys.map((k,i)=>[H(k)||[],cols[i]]).filter(([d])=>d.length>1);
  if(!pairs.length){svg.innerHTML="";return}
  const all=pairs.flatMap(([d])=>d), mn=min??Math.min(...all), span=(Math.max(...all)-mn)||1, h=svg.viewBox.baseVal.height;
  svg.innerHTML=pairs.map(([d,c])=>`<path class="l" style="stroke:var(${c})" d="${d.map((v,j)=>`${j?"L":"M"}${(j/Math.max(d.length-1,1)*200).toFixed(1)},${(h-2-(v-mn)/span*(h-4)).toFixed(1)}`).join("")}"/>`).join("");
}

/* ---- rpm-style gauge: 270° sweep; skala + ambang dari registry/sumber nyata ---- */
const pt=(a,r)=>[75+r*Math.cos(a*Math.PI/180),66+r*Math.sin(a*Math.PI/180)];
const arc=(a0,a1,r)=>{const p=pt(a0,r),q=pt(a1,r);return`M${p[0].toFixed(1)},${p[1].toFixed(1)}A${r},${r} 0 ${a1-a0>180?1:0} 1 ${q[0].toFixed(1)},${q[1].toFixed(1)}`};
function gauge(g){
  const ring=(r,w,c)=>`<path d="${arc(135,405,r)}" fill="none" style="stroke:var(--line)" stroke-width="${w}" stroke-linecap="round"/><path class="${c}" fill="none" stroke-width="${w}" stroke-linecap="round"/>`;
  const el=mk(`<svg viewBox="0 0 150 124">${ring(54,9,"v")}${g.in?ring(41,5,"w"):""}<text x="75" y="72" text-anchor="middle" style="fill:var(--ink);font:600 24px var(--mono)"></text><text x="75" y="88" text-anchor="middle" style="fill:var(--mute);font:11px var(--sans)">${g.unit}</text><text x="75" y="118" text-anchor="middle" style="fill:var(--mute);font:11px var(--sans)">${g.label}</text></svg>`);
  const v=el.querySelector(".v"), w=el.querySelector(".w"), tx=el.querySelector("text");
  const draw=(p,x,m,wn,bd,r)=>{
    if(typeof x!=="number"||typeof m!=="number"||m<=0){p.setAttribute("d","");return}
    p.setAttribute("d",arc(135,135+270*clamp(x/m,.005,1),r));
    p.style.stroke=bd?"var(--bad)":wn?"var(--warn)":"var(--a)";
  };
  return{el,up:()=>{
    const s=C.data, x=s[g.key], m=g.max?g.max():dynMax(g.key);
    draw(v,x,m,g.warn(s),g.bad(s),54);
    tx.textContent=val(x,g.d||0); tx.setAttribute("title",x==null?(R[g.key]||"tidak ada sumber data"):"");
    if(g.in){const ix=s[g.in.key], im=g.in.max?g.in.max():dynMax(g.in.key);
      draw(w,ix,im,g.in.warn(s),g.in.bad(s),41);
      el.querySelector("svg").setAttribute("title",ix==null?(R[g.in.key]||""):"")}
  }};
}

/* ---- blocks: each returns {el, up()} ---- */
const B={
 hd:b=>{const g=gauge(b.g),el=mk(`<div class="hd"><div class="gw"></div><div class="stats">${b.stats.map(s=>`<div><span>${s[1]}</span><b></b></div>`).join("")}</div></div>`);
  el.querySelector(".gw").append(g.el);const bs=[...el.querySelectorAll("b")];
  return{el,up:()=>{g.up();b.stats.forEach((s,i)=>{
    const v=s[4]?s[4](C.data):C.data[s[0]];
    if(typeof v==="number"){bs[i].innerHTML=fx(v,s[3]||0)+`<small>${s[2]||""}</small>`;bs[i].removeAttribute("title")}
    else{bs[i].innerHTML=`<span class="na">${v==null?"unavailable":v}</span>`;
      bs[i].title=v==null?(R[s[0]]||"tidak ada sumber data"):"tidak ada I/O di interval ini"}
  })}}},
 cores:()=>{const el=mk(`<div></div>`);el.className="cores";
  return{el,up:()=>{
    const P=C.data.pu||[],E=C.data.eu||[];
    if(el.dataset.n!==String(P.length+E.length)){
      const cell=(p,k)=>`<div>${[...Array(k)].map((_,i)=>`<div class="cc"><i></i><b>${p}${i}</b><u></u><s></s></div>`).join("")}</div>`;
      el.innerHTML=cell("P",P.length)+cell("E",E.length)+`<div class="hint2">GHz dan °C per core dari snapshot. Fill = utilisasi. "—" = tidak ada sumber.</div>`;
      el.dataset.n=String(P.length+E.length);
    }
    const cc=[...el.querySelectorAll(".cc")];
    cc.forEach((x,i)=>{
      const s=C.data;
      const src=i<P.length?[s.pf[i],s.pt[i],s.pu[i]]:[s.ef[i-P.length],s.et[i-P.length],s.eu[i-P.length]];
      const u=x.querySelector("i"),f=x.querySelector("u"),t=x.querySelector("s");
      u.style.height=(typeof src[2]==="number"?src[2]:0)+"%";
      f.textContent=val(src[0],2); f.title=src[0]==null?(R["pfa"]||R["ef"]||"tidak ada sumber clock"):"";
      t.textContent=val(src[1])+"°"; t.title=src[1]==null?(R["pt"]||"tidak ada sensor suhu core ini"):"";
    });
  }}},
 bars:b=>{const el=mk(`<div class="bars">${b.items.map(it=>`<div class="br"><span>${it.l}</span><div class="bar">${it.c.map(c=>`<i style="background:var(${c})"></i>`).join("")}</div><em></em></div>`).join("")}</div>`);
  const rows=[...el.querySelectorAll(".br")];
  return{el,up:()=>b.items.forEach((it,i)=>{
    // f() mengembalikan [v0, v1, ..., den] dengan den = penyebut nyata (limit dari snapshot / peak terukur)
    const f=it.f(C.data), den=f[f.length-1];
    rows[i].querySelectorAll(".bar i").forEach((x,j)=>{
      const ok=typeof f[j]==="number"&&typeof den==="number"&&den>0;
      x.style.width=ok?clamp(f[j]/den*100,0,100)+"%":"0%"});
    rows[i].querySelector("em").textContent=it.t(C.data);
    rows[i].querySelector("em").title=it.tip?it.tip(C.data):"";
  })};
 },
 chips:b=>{const el=mk(`<div class="chips">${b.items.map(x=>`<span class="cp">${x}</span>`).join("")}</div>`);
  const c=[...el.querySelectorAll(".cp")];
  return{el,up:()=>{
    b.on(C.data).forEach((raw,i)=>{
      const v=raw===true||raw===false?raw:null;
      c[i].className="cp"+(v===true?" on":"");
      c[i].textContent=b.items[i]+(v===null?" —":"");
      c[i].setAttribute("title",v===null?(b.tip?b.tip(C.data,i):"tidak ada sumber (NVML)"):"NVML throttle reasons")});
  }}},
 chart:b=>{let ti=0;const el=mk(`<div class="ch"><div class="tabs">${b.tabs.map(x=>`<button>${x.n}</button>`).join("")}<em class="lg"></em></div><svg class="sp" viewBox="0 0 200 50" preserveAspectRatio="none"></svg></div>`);
  const sv=el.querySelector("svg"),btn=[...el.querySelectorAll("button")],lg=el.querySelector(".lg");
  const draw=()=>spark(sv,b.tabs[ti].s.map(s=>s[0]),b.tabs[ti].s.map(s=>s[2]),b.tabs[ti].min);
  const tab=i=>{ti=i;btn.forEach((x,j)=>x.setAttribute("aria-pressed",j===i));lg.innerHTML=b.tabs[i].s.map(s=>`<span><i style="background:var(${s[2]})"></i>${s[1]}</span>`).join("");draw()};
  btn.forEach((x,i)=>x.onclick=()=>tab(i));tab(0);return{el,up:draw}},
 dl:b=>{const hdr=b.hdr?`<dt></dt>${b.hdr.map(h=>`<dt class="h">${h}</dt>`).join("")}`:"";
  const el=mk(`<dl class="${b.hdr?"tb":"pr"}">${hdr}${b.rows.map(r=>`<dt>${r[0]}</dt>`+(b.hdr?"<dd></dd><dd></dd>":"<dd></dd>")).join("")}</dl>`);
  const dd=[...el.querySelectorAll("dd")];
  // format row: pr [label, fn, warnFn|null, key] · tb [label, fn0, fn1, warnFn|null, key0, key1]
  return{el,up:()=>{let j=0;
    b.rows.forEach(r=>{
      const n=b.hdr?2:1;
      const warn=r[n+1]?r[n+1](C.data):false;
      for(let c=0;c<n;c++){
        const raw=r[1+c], v=typeof raw==="function"?raw(C.data):raw;
        const na=v==null||v==="unavailable";
        dd[j].textContent=na?"unavailable":v;
        dd[j].className=(warn?"warn ":"")+(na?"dd-na":"");
        dd[j].title=na?(R[r[n+2+c]]||"tidak ada sumber data"):"";
        j++;
      }
    })}};
  },
 /* block dinamis: jumlah item/kolom mengikuti registry core (mis. jumlah drive dari /sys/block) */
 dynBars:b=>{const el=mk(`<div class="bars"></div>`), box=el.firstElementChild;let n=-1,rows=[];
  return{el,up:()=>{
    const items=b.items(C.data);
    if(items.length!==n){
      n=items.length;
      box.innerHTML=items.map(it=>`<div class="br"><span>${it.l}</span><div class="bar">${it.c.map(c=>`<i style="background:var(${c})"></i>`).join("")}</div><em></em></div>`).join("");
      rows=[...box.querySelectorAll(".br")];
    }
    items.forEach((it,i)=>{
      const f=it.f(C.data), den=f[f.length-1];
      rows[i].querySelectorAll(".bar i").forEach((x,j)=>{
        const ok=typeof f[j]==="number"&&typeof den==="number"&&den>0;
        x.style.width=ok?clamp(f[j]/den*100,0,100)+"%":"0%";
      });
      rows[i].querySelector("em").textContent=it.t(C.data);
      rows[i].querySelector("em").setAttribute("title",it.tip?it.tip(C.data):"");
    });
  }};
 },
 dynTable:b=>{const el=mk(`<dl class="tb"></dl>`), box=el.firstElementChild;let n=-1,dd=[];
  // format row: [label, get(s,col), keyFn(s,col), warnFn|null]
  return{el,up:()=>{
    const cols=b.n(C.data);
    if(cols!==n){
      n=cols;
      box.innerHTML=`<dt></dt>`+Array.from({length:cols},(_,i)=>`<dt class="h">${esc(b.hdr(C.data,i))}</dt>`).join("")
        +b.rows.map(r=>`<dt>${r[0]}</dt>`+Array.from({length:cols},()=>"<dd></dd>").join("")).join("");
      dd=[...box.querySelectorAll("dd")];
    }
    let j=0;
    b.rows.forEach(r=>{
      for(let c=0;c<cols;c++){
        const v=r[1](C.data,c), na=v==null||v==="unavailable";
        dd[j].textContent=na?"unavailable":v;
        dd[j].className=(r[3]?r[3](C.data,c)?"warn ":"":"")+(na?"dd-na":"");
        dd[j].setAttribute("title",na?(R[r[2](C.data,c)]||"tidak ada sumber data"):"");
        j++;
      }
    });
  }};
 },
 dynChart:b=>{let ti=0,tabs=[];
  const el=mk(`<div class="ch"><div class="tabs"><em class="lg"></em></div><svg class="sp" viewBox="0 0 200 50" preserveAspectRatio="none"></svg></div>`);
  const sv=el.querySelector("svg"), tb=el.querySelector(".tabs"), lg=el.querySelector(".lg");
  const draw=()=>{
    if(!tabs.length){lg.innerHTML="";return}
    ti=Math.min(ti,tabs.length-1);
    spark(sv,tabs[ti].s.map(x=>x[0]),tabs[ti].s.map(x=>x[2]),tabs[ti].min);
    lg.innerHTML=tabs[ti].s.map(x=>`<span><i style="background:var(${x[2]})"></i>${x[1]}</span>`).join("");
    [...tb.querySelectorAll("button")].forEach((x,j)=>x.setAttribute("aria-pressed",String(j===ti)));
  };
  return{el,up:()=>{
    const t=b.tabs(C.data);
    if(t.length!==tabs.length){
      tabs=t;
      [...tb.querySelectorAll("button")].forEach(x=>x.remove());
      tabs.forEach((x,j)=>{
        const btn=document.createElement("button");
        btn.textContent=x.n;
        btn.onclick=()=>{ti=j;draw()};
        tb.prepend(btn);
      });
      ti=0;
    }
    draw();
  }};
 }
};
function panel(c){
  const el=document.createElement("section");el.className="p";el.innerHTML=`<header><h2>${c.title}</h2><span></span></header><div class="col"></div><div class="col"></div>`;
  const cols=el.querySelectorAll(".col"),us=[];
  [c.l,c.r].forEach((side,k)=>side.forEach(b=>{const x=B[b.t](b);cols[k].append(x.el);us.push(x.up)}));
  return{el,us,sub:el.querySelector("span")};
}

/* ---- sinyal nyata untuk ambang gauge/chip ---- */
const cpuThrottling=s=>s.cpuThr!=null&&s.cpuThr!=="none";
const gpuThermal=s=>s.thrThermal===true||s.thrHw===true;
const gpuPowerCap=s=>s.thrPower===true;
const pl1=s=>typeof s.pl1==="number"?s.pl1:null;
const gLim=s=>typeof s.gLim==="number"?s.gLim:null;
const near=(v,m,f)=>typeof v==="number"&&typeof m==="number"&&m>0&&v>=m*f;

const PANELS=[
 {title:"CPU",sub:s=>(s.snap.cpuModel||"CPU")+", "+((S.pu||[]).length)+" P + "+((S.eu||[]).length)+" E cores (dinamis dari kernel)",
  l:[{t:"hd",g:{key:"cpuT",max:()=>Math.max(dynMax("cpuT")||0,70),warn:()=>cpuThrottling(C.data),bad:()=>cpuThrottling(C.data),unit:"°C",label:"temp · ring = daya vs PL1",
       in:{key:"cpuW",max:()=>pl1(C.data)||dynMax("cpuW"),warn:s=>near(s.cpuW,pl1(s),.9),bad:s=>near(s.cpuW,pl1(s),1)}},
     stats:[["cpuU","Util","%"],["migr","Migrations","/s"],["pfa","P clock","GHz",2],["efa","E clock","GHz",2,s=>{const a=(S.ef||[]).filter(x=>typeof x==="number");return a.length?avg(a):null}]]},
   {t:"cores"},
   {t:"bars",items:[
     {l:"Power / PL1",c:["--b"],f:s=>[s.cpuW,pl1(C.data)],t:s=>fx(s.cpuW,1)+" / "+fx(pl1(C.data),1)+" W",tip:s=>pl1(C.data)==null?(R["pl1"]||""):""},
     {l:"Idle residency",c:["--a"],f:s=>[s.idle,100],t:s=>fx(s.idle)+" % "+(s.idleName||""),tip:s=>R["idle"]||""}]},
  ],
  r:[{t:"chart",tabs:[{n:"Temp and power",s:[["cpuT","Temp (°C)","--b"],["cpuW","Power (W)","--a"]]},{n:"Load and idle",min:0,s:[["cpuU","Util (%)","--a"],["idle","Idle (%)","--b"]]}]},
   {t:"dl",rows:[
     ["Governor",s=>s.snap.governor],["EPP",s=>s.snap.epp],["Turbo",s=>s.snap.turbo],
     ["PL1 / PL2",s=>{const a=s.pl1==null?null:fx(s.pl1,1)+" W (PL1)",b=s.pl2==null?null:fx(s.pl2,1)+" W (PL2)";const x=[a,b].filter(Boolean);return x.length?x.join(" / "):null},null,"pl1"],
     ["Context switches",s=>s.ctx==null?null:fx(s.ctx)+" /s",null,"ctx"],
     ["Interrupts",s=>s.irq==null?null:fx(s.irq)+" /s",null,"irq"],
     ["Throttle",s=>s.cpuThr,null,"cpuThr"]]},
  ]},

 {title:"GPU",sub:s=>(s.snap.gpuName||"NVIDIA GPU")+(s.snap.nvml?"":" (NVML unavailable)"),
  l:[{t:"hd",g:{key:"gT",max:()=>Math.max(dynMax("gT")||0,60),warn:()=>gpuThermal(C.data),bad:()=>gpuThermal(C.data),unit:"°C",label:"temp · ring = daya vs limit",
       in:{key:"gW",max:()=>gLim(C.data)||dynMax("gW"),warn:s=>near(s.gW,gLim(s),.9),bad:s=>near(s.gW,gLim(s),1)}},
     stats:[["gW","Power","W",1],["gClk","SM clock","MHz"],["gU","Util","%"],["vram","VRAM","GiB",1]]},
   {t:"chips",items:["Idle","Power cap","Thermal","HW slowdown"],
     on:s=>[s.thrIdle,s.thrPower,s.thrThermal,s.thrHw],tip:(s,i)=>R["thr"]||""},
   {t:"bars",items:[
     {l:"VRAM",c:["--a"],f:s=>[s.vram,s.vramTot],t:s=>fx(s.vram,2)+" / "+fx(s.vramTot,2)+" GiB",tip:s=>R["vram"]||""},
     {l:"VRAM bw (est.)",c:["--b"],f:s=>[s.vbw,s.gpeak],t:s=>fx(s.vbw)+" / "+fx(s.gpeak)+" GB/s (estimasi)",tip:s=>R["vbw"]||""},
     {l:"PCIe receive",c:["--a"],f:s=>[s.prx,s.pctheory],t:s=>fx(s.prx,2)+" / "+fx(s.pctheory,2)+" GB/s",tip:s=>R["prx"]||""},
     {l:"PCIe transmit",c:["--b"],f:s=>[s.ptx,s.pctheory],t:s=>fx(s.ptx,2)+" / "+fx(s.pctheory,2)+" GB/s",tip:s=>R["ptx"]||""}]},
  ],
  r:[{t:"chart",tabs:[{n:"Temp and power",s:[["gT","Temp (°C)","--b"],["gW","Power (W)","--a"]]},{n:"Util",min:0,s:[["gU","GPU (%)","--a"],["gMU","Mem ctrl (%)","--b"]]},{n:"VRAM bw",min:0,s:[["vbw","GB/s (est.)","--a"]]},{n:"PCIe",min:0,s:[["prx","Rx (GB/s)","--a"],["ptx","Tx (GB/s)","--b"]]}]},
   {t:"dl",rows:[
     ["Memory clock",s=>s.gMemClk==null?null:s.gMemClk+" MHz",null,"gMemClk"],
     ["Bus width",s=>s.gbw==null?null:s.gbw+" bit",null,"gbw"],
     ["P-state",s=>s.pstate,null,"pstate"],
     ["PCIe now / max",s=>s.pcieGen==null?null:"Gen"+s.pcieGen+" x"+s.pcieWidth+(s.pcieMax?" / "+s.pcieMax:""),null,"pcieGen"],
     ["Draw / limit",s=>s.gW==null?null:fx(s.gW,1)+" W"+(s.gLim?" / "+fx(s.gLim)+" W"+(s.gLimDef?" (default)":""):""),null,"gW"],
     ["Throttle",s=>s.thr,g=>g.thr!=null&&g.thr!=="none","thr"],
     ["Fan",s=>s.fan==null?null:fx(s.fan)+" %",null,"fan"],
     ["NVIDIA driver",s=>s.snap.gpuDriver]]},
  ]},

 {title:"Memory",sub:s=>s.snap.kernel?"kernel "+s.snap.kernel:"",
  l:[{t:"hd",g:{key:"ramU",max:()=>typeof S.memTot==="number"?S.memTot:dynMax("ramU"),warn:()=>near(S.ramU,S.memTot,.8),bad:()=>near(S.ramU,S.memTot,.93),unit:"GiB used",label:"RAM (total dari meminfo)",d:1},
     stats:[["cache","Page cache","GiB",1],["avail","Available","GiB",1],["majF","Major faults","/s"],["swp","Swap I/O","MB/s",1]]},
   {t:"bars",items:[
     {l:"RAM",c:["--a","--b"],f:s=>[s.ramU,s.cache,S.memTot],t:s=>`${fx(s.ramU,1)} used, ${fx(s.cache,1)} cache, dari ${fx(S.memTot,1)} GiB`,tip:s=>R["ramU"]||""},
     {l:"Swap",c:["--warn"],f:s=>[s.swapU,S.swapTot],t:s=>fx(s.swapU,1)+" / "+fx(S.swapTot,1)+" GiB",tip:s=>R["swapU"]||""},
     {l:"Major faults",c:["--b"],f:s=>[s.majF,dynMax("majF")],t:s=>fx(s.majF)+" /s (peak terukur "+fx(dynMax("majF"))+")",tip:s=>R["majF"]||""},
     {l:"Minor faults",c:["--a"],f:s=>[s.minF,dynMax("minF")],t:s=>fx(s.minF)+" /s (peak terukur "+fx(dynMax("minF"))+")",tip:s=>R["minF"]||""}]},
  ],
  r:[{t:"chart",tabs:[{n:"RAM",min:0,s:[["ramU","Used (GiB)","--a"],["cache","Cache (GiB)","--b"]]},{n:"Page faults",min:0,s:[["majF","Major (/s)","--b"],["minF","Minor (/s)","--a"]]}]},
   {t:"dl",rows:[
     ["Total",s=>s.memTot==null?null:fx(s.memTot,2)+" GiB",null,"memTot"],
     ["Swap total",s=>s.swapTot==null?null:fx(s.swapTot,2)+" GiB",null,"swapTot"],
     ["Measured bandwidth",s=>s.ramBW==null?null:fx(s.ramBW,1)+" GB/s",null,"ramBW"],
     ["Hugepages",s=>s.snap.thp],["Swappiness",s=>s.snap.swappiness]]},
  ]},

 {title:"Storage",sub:s=>C.drives.length?C.drives.map(d=>`${d.dev||"drive"}: ${d.name||"unavailable"}`).join(" · "):"tidak ada drive di /sys/block",
  l:[{t:"hd",g:{key:"r0",max:()=>dynMax("r0"),warn:()=>false,bad:()=>false,unit:"MB/s read",label:"drive 0 (skala = peak terukur)"},
     stats:[["w0","Write","MB/s",1],["i0","IOPS","IOPS"],["a0","Await","ms",1,s=>s.a0Idle?"idle":null],["u0","Util","%"]]},
   {t:"dynBars",items:s=>{const out=[];
     C.drives.forEach((d,i)=>{
       out.push({l:`${d.dev||("drive"+i)} read`,c:["--a"],f:x=>[x["r"+i],dynMax("r"+i)],
         t:x=>fx(x["r"+i])+" / "+fx(dynMax("r"+i))+" MB/s (peak terukur)",tip:x=>R["r"+i]||""});
       out.push({l:`${d.dev||("drive"+i)} capacity`,c:["--warn"],f:x=>[d.capUsed,100],
         t:x=>d.capUsed==null?(d.mount==null?"not mounted":"unavailable"):fx(d.capUsed)+" % of "+fx(d.sizeGB,1)+" GB",
         tip:x=>R["d"+i+"capUsed"]||""})});
     return out}},
  ],
  r:[{t:"dynChart",tabs:s=>C.drives.map((d,i)=>({n:d.dev||("drive"+i),min:0,
        s:[["r"+i,"Read (MB/s)","--a"],["w"+i,"Write (MB/s)","--b"]]}))},
   {t:"dynTable",n:s=>C.drives.length,hdr:(s,i)=>C.drives[i].dev||("drive"+i),rows:[
     ["Model",(s,c)=>C.drives[c].name,(s,c)=>"d"+c+"model"],
     ["Link / max",(s,c)=>{const d=C.drives[c];return d.link==null?null:d.link+(d.linkMax?" / "+d.linkMax:"")},(s,c)=>"d"+c+"link"],
     ["Queue",(s,c)=>s["q"+c]==null?null:fx(s["q"+c],1),(s,c)=>"q"+c],
     ["Temp",(s,c)=>s["t"+c]==null?null:fx(s["t"+c])+" °C",(s,c)=>"t"+c],
     ["Scheduler",(s,c)=>C.drives[c].sched,(s,c)=>"d"+c+"sched"],
     ["Readahead",(s,c)=>C.drives[c].readahead,(s,c)=>"d"+c+"readahead"],
     ["Await",(s,c)=>s["a"+c]==null?(s["a"+c+"Idle"]?"idle":null):fx(s["a"+c],1)+" ms",(s,c)=>"a"+c]]},
  ]},
];

/* ---- panel & rail mengikuti registry core: GPU hanya kalau terdeteksi,
   drive dinamis dari entri drive registry ---- */
let PSIG=""; let cur=[];
function driveCount(){let n=0;for(const e of C.registry.values())if(e.kind==="drive")n++;return n}
function buildPanels(){
  const gpuOK=!!(C.registry.get("gpuPresent")&&C.registry.get("gpuPresent").available);
  const sig=(gpuOK?"gpu":"nogpu")+"|"+driveCount()+"|"+((S.pu||[]).length)+"|"+((S.eu||[]).length)+"|"+C.drives.map(d=>d.dev).join(",");
  if(sig===PSIG)return;
  PSIG=sig;
  const g=document.querySelector("#g"); if(!g)return;
  g.innerHTML=""; cur=[];
  const list=[PANELS[0]];
  if(gpuOK)list.push(PANELS[1]);
  list.push(PANELS[2],PANELS[3]);
  list.forEach(c=>{
    const p=panel({title:c.title,sub:c.sub,l:c.l,r:c.r});
    cur.push({up:()=>{p.us.forEach(f=>f());p.sub.textContent=(typeof c.sub==="function"?c.sub(C.data):c.sub)||""}});
    g.append(p.el);
  });
  buildRail();
}
function refreshSubs(){cur.forEach(x=>x.up())}

/* ---- rail kanan: timeline, events dari transisi nyata, system dari snap ---- */
function tlRows(){
  const gpuOK=!!(C.registry.get("gpuPresent")&&C.registry.get("gpuPresent").available), rows=[];
  rows.push(["cpuT","CPU temp","°C",0]);
  if(gpuOK)rows.push(["gT","GPU temp","°C",0],["gW","GPU power","W",1],["gU","GPU util","%",0],["prx","PCIe rx","GB/s",1]);
  rows.push(["majF","Major flt","/s",0]);
  C.drives.forEach((d,i)=>rows.push(["r"+i,(d.dev||("drive"+i))+" read","MB/s",0]));
  return rows;
}
let TL=[];
function buildRail(){
  TL=tlRows();
  const tl=document.querySelector("#tl"); if(!tl)return;
  tl.innerHTML=TL.map(r=>`<div class="tr"><span>${r[1]}</span><svg viewBox="0 0 200 24" preserveAspectRatio="none"></svg><b></b></div>`).join("");
}
const clock=()=>new Date().toLocaleTimeString("en-GB",{timeZone:"Asia/Jakarta"});
let EV=[],F={};
function rail(){
  document.querySelectorAll("#tl .tr").forEach((r,i)=>{
    spark(r.querySelector("svg"),[TL[i][0]],["--a"]);
    const v=S[TL[i][0]];
    r.querySelector("b").textContent=val(v,TL[i][3]);
    r.querySelector("b").title=v==null?(R[TL[i][0]]||"tidak ada sumber data"):"";
  });
  const s=C.data;
  if(C.online){
    push("thr",s.thr!=null&&s.thr!=="none",`GPU throttle aktif: ${s.thr}`,"GPU throttle lepas");
    push("burst",typeof s.r0==="number"&&s.r0>600,`NVMe read burst ${fx(s.r0)} MB/s (> 600 MB/s)`,"NVMe burst selesai");
    push("cpuThr",cpuThrottling(s),`CPU thermal throttle: ${s.cpuThr}`,"CPU throttle lepas");
    push("power",near(s.gW,gLim(s),.95),`GPU draw ${fx(s.gW,1)} W mendekati limit NVML`,"GPU draw turun di bawah limit");
  }
  document.querySelector("#ev").innerHTML=Array.from({length:6},(_,i)=>EV[i]).map(e=>e?`<div class="ev"><i class="${e.warn?"w":""}"></i><time>${e.t}</time><span title="${esc(e.x)}">${esc(e.x)}</span></div>`:`<div class="ev"></div>`).join("");
  document.querySelector("#sys").innerHTML=[["Kernel",s.snap.kernel],["NVIDIA driver",s.snap.gpuDriver],["Governor",s.snap.governor],
    ["Turbo",s.snap.turbo],["I/O scheduler",C.drives.map(d=>d.sched).filter(Boolean).join(" / ")||null],
    ["Swappiness",s.snap.swappiness],["Pinning",s.snap.pinning],["NVML",s.snap.nvml?"aktif":"tidak aktif"]]
    .map(r=>`<dt>${r[0]}</dt><dd>${r[1]==null?"unavailable":esc(String(r[1]))}</dd>`).join("");
}
function push(k,on,onMsg,offMsg){
  const cur=on?1:0;
  if(F[k]===undefined){F[k]=cur;return}
  if(F[k]!==cur){EV.unshift({t:clock(),x:on?onMsg:offMsg,warn:cur===1});F[k]=cur}
  if(EV.length>12)EV.pop();
}

/* ---- chip atas + hint bottleneck (rule eksplisit, data nyata) ---- */
function chipsTop(){
  const be=document.querySelector("#c-be"); if(be){be.innerHTML=`Backend <b>${C.online?"live":"offline"}</b>`;be.className="chip"+(C.online?"":" warn")}
  const tc=document.querySelector("#c-thr");
  if(tc){const thr=S.thr==null?"unavailable":S.thr;
    tc.innerHTML=`Throttle <b>${thr}</b>`;tc.className="chip"+(S.thr!=null&&S.thr!=="none"?" warn":"");
    tc.title=S.thr==null?(R["thr"]||"tidak ada sumber data"):""}
  const lc=document.querySelector("#c-link");
  if(lc){const now=S.pcieGen==null?"—":"Gen"+S.pcieGen+" x"+S.pcieWidth;
    lc.innerHTML=`GPU link <b>${now}${S.pcieMax?" → "+S.pcieMax:""}</b>`;
    lc.title=S.pcieGen==null?(R["pcieGen"]||"tidak ada sumber data"):"link sekarang bisa turun saat idle (normal)"}
  const rc2=document.querySelector("#c-rec");
  if(rc2){const rec=C.recording;
    rc2.innerHTML=`Recording <b>${rec?("on "+(rec.samples||0)+" samples"):"off"}</b>`;
    rc2.className="chip"+(rec?" warn":"")}
  const h=document.querySelector("#hint"); if(!h)return;
  const rules=[];
  const rd=Math.max(-1,...C.drives.map((d,i)=>typeof S["r"+i]==="number"?S["r"+i]:-1));
  if(rd>600&&typeof S.gU==="number"&&S.gU<50){rules.push(`page-bound: NVMe read ${fx(Math.max(rd,0))} MB/s (> 600) dan GPU util ${fx(S.gU)} % (< 50)`)}
  if(S.thrThermal===true||cpuThrottling(S)){rules.push(`thermal-bound: throttle NVML=${S.thr}, CPU sysfs=${S.cpuThr?? "unavailable"}`)}
  if(near(S.gW,gLim(C.data),.95)){rules.push(`power-bound: GPU draw ${fx(S.gW,1)} W ≥ 95% limit NVML ${fx(gLim(C.data),0)} W`)}
  const w=rules.length>0;
  h.className="hint"+(w?" warn":"");
  h.querySelector("span").textContent=(w?rules.join(" · ")+" (aturan di atas dievaluasi dari data snapshot)":"Tidak ada aturan bottleneck yang picu (page-bound >600 MB/s + GPU <50%; thermal-bound dari throttle NVML/sysfs; power-bound ≥95% limit).");
}

/* ---- titik masuk theme ---- */
function mount(root,ctx){
  C=ctx; S=ctx.data; R=ctx.reasons; PSIG=""; cur=[];
  root.innerHTML=`<div class="top"><h1>Monitor</h1>
    <span class="chip" id="c-be">Backend <b>offline</b></span><span class="chip" id="c-thr">Throttle <b>—</b></span>
    <span class="chip" id="c-link">GPU link <b>—</b></span><span class="chip" id="c-rec">Recording <b>off</b></span>
    <span class="grow"></span></div>
    <div class="wrap"><div class="grid" id="g"></div>
    <aside><div class="rc tl"><h2>Timeline (last 60 s)</h2><div id="tl" style="display:flex;flex-direction:column;flex:1"></div></div>
    <div class="rc"><h2>Events</h2><div id="ev" style="display:flex;flex-direction:column;gap:5px;height:133px;flex:none"></div></div>
    <div class="rc"><h2>System</h2><dl class="pr" id="sys"></dl></div></aside></div>
    <div class="hint" id="hint"><i></i><span></span></div>`;
  buildPanels(); refreshSubs(); chipsTop(); rail();
}
function update(ctx){
  C=ctx; S=ctx.data; R=ctx.reasons;
  buildPanels(); refreshSubs(); refreshSubs(); rail(); chipsTop();
}
/* hook opsional: core memanggil ini saat status recording berubah (padanan
   chipsTop() lama) — aman saat tab Log terbuka karena semua query guarded */
function chips(ctx){
  C=ctx; S=ctx.data; R=ctx.reasons; chipsTop();
}
/* ---- widget komposit untuk layout.json / theme lain ---- */
function compositePanel(name,spec){
  N.addWidget(name,{
    mount(el,props,ctx){
      C=ctx; S=ctx.data; R=ctx.reasons;
      const p=panel(spec);
      el.append(p.el);
      el._up=()=>{p.us.forEach(f=>f());p.sub.textContent=(typeof spec.sub==="function"?spec.sub(C.data):spec.sub)||"";};
      el._up();
    },
    update(el,props,ctx){
      C=ctx; S=ctx.data; R=ctx.reasons;
      if(el._up)el._up();
    }
  });
}
compositePanel("cpu-panel",PANELS[0]);
compositePanel("memory-panel",PANELS[2]);
compositePanel("storage-panel",PANELS[3]);
compositePanel("storage-panel",PANELS[3]);
N.addWidget("gpu-panel",{
  mount(el){el.style.display="none";},
  update(el,props,ctx){
    C=ctx; S=ctx.data; R=ctx.reasons;
    const ok=!!(C.registry.get("gpuPresent")&&C.registry.get("gpuPresent").available);
    if(!ok){el.style.display="none";return;}
    el.style.display="";
    if(!el._up){
      const p=panel(PANELS[1]);
      el.append(p.el);
      el._up=()=>{p.us.forEach(f=>f());p.sub.textContent=(typeof PANELS[1].sub==="function"?PANELS[1].sub(C.data):PANELS[1].sub)||"";};
    }
    el._up();
  }
});

window.Noterra.addTheme("default",{mount,update,chips});
})();
