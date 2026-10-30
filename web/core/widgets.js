/* widgets.js — widget primitif L2. Hanya memakai API publik Noterra/ctx,
   tidak mengakses DOM shell. Gaya memakai token + fallback core.css. */
(function(){
"use strict";
const N=window.Noterra;
if(!N||!N.addWidget)throw new Error("widgets.js butuh core.js (Noterra.addWidget)");
const {esc}=N.fmt;

const reg=(ctx,key)=>ctx.registry.get(key);
const why=(ctx,key,r)=>r&&r.reason?r.reason:(ctx.reasons&&ctx.reasons[key])||"tidak ada sumber data";
const num=(v)=>typeof v==="number";
function labelOf(p,r,key){return p.label||(r&&r.label)||key}
function unitOf(p,r){return p.unit!==undefined?p.unit:((r&&r.unit)||"")}
function showNa(el,text,title){
  el.textContent="unavailable";
  el.className="w-na";
  el.setAttribute("title",title||"tidak ada sumber data");
}
/* nilai non-angka yang tersedia (mis. nama state) tetap ditampilkan apa adanya */
function fmtVal(ctx,v,r){
  if(num(v))return v.toFixed((r&&r.digits)||0);
  if(v!=null&&v!=="unavailable"&&v!=="")return String(v);
  return null;
}

N.addWidget("value",{
  mount(el,p,ctx){
    el.classList.add("w-value");
    el.innerHTML=`<div class="w-label"></div><div class="w-body"><span class="w-num"></span><span class="w-unit"></span></div>`;
    el._l=el.querySelector(".w-label"); el._b=el.querySelector(".w-body");
  },
  update(el,p,ctx){
    const r=reg(ctx,p.bind), v=ctx.data[p.bind];
    el._l.textContent=labelOf(p,r,p.bind);
    const s=fmtVal(ctx,v,r);
    if(s==null){showNa(el._b, "unavailable", why(ctx,p.bind,r)); return;}
    el._b.className="w-body";
    el._b.innerHTML=`<span class="w-num">${esc(s)}</span><span class="w-unit">${esc(unitOf(p,r))}</span>`;
    el._b.removeAttribute("title");
  }
});

N.addWidget("bar",{
  mount(el,p,ctx){
    el.classList.add("w-bar");
    el.innerHTML=`<div class="w-label"></div><div class="w-track"><div class="w-fill"></div></div><div class="w-caption"></div>`;
    el._l=el.querySelector(".w-label"); el._f=el.querySelector(".w-fill"); el._c=el.querySelector(".w-caption");
  },
  update(el,p,ctx){
    const r=reg(ctx,p.bind), v=ctx.data[p.bind], sk=r&&r.scaleKey;
    let den=sk?ctx.data[sk]:null;
    if(!num(den)&&sk)den=ctx.max(sk);
    el._l.textContent=labelOf(p,r,p.bind);
    const s=fmtVal(ctx,v,r), u=unitOf(p,r);
    if(s==null){el._f.style.width="0%";showNa(el._c,"unavailable",why(ctx,p.bind,r));return;}
    el._c.className="w-caption";
    if(num(v)&&num(den)&&den>0){
      el._f.style.width=Math.min(100,Math.max(0,v/den*100)).toFixed(1)+"%";
      el._c.textContent=`${s} / ${den.toFixed((r&&r.digits)||0)} ${u}`.trim();
    }else{
      el._f.style.width="0%";
      el._c.textContent=`${s} ${u}`.trim()+" (skala unavailable)";
    }
    el._c.removeAttribute("title");
  }
});

N.addWidget("sparkline",{
  mount(el,p,ctx){
    el.classList.add("w-spark");
    el.innerHTML=`<div class="w-label"></div><svg viewBox="0 0 100 30" preserveAspectRatio="none"><path class="l" fill="none" stroke="var(--a,#3b5bdb)" stroke-width="1.5"/></svg>`;
    el._l=el.querySelector(".w-label"); el._p=el.querySelector("path");
  },
  update(el,p,ctx){
    const r=reg(ctx,p.bind), arr=ctx.hist(p.bind);
    el._l.textContent=labelOf(p,r,p.bind);
    if(!arr||arr.length<2){el._p.setAttribute("d","");el._l.title=why(ctx,p.bind,r);return;}
    const mn=Math.min(...arr), span=(Math.max(...arr)-mn)||1;
    el._p.setAttribute("d",arr.map((v,j)=>{
      const x=(j/Math.max(arr.length-1,1)*100).toFixed(1);
      const y=(28-(v-mn)/span*26).toFixed(1);
      return `${j?"L":"M"}${x},${y}`;
    }).join(""));
    el._l.removeAttribute("title");
  }
});

const pt=(a,r)=>[50+r*Math.cos(a*Math.PI/180),46+r*Math.sin(a*Math.PI/180)];
const arc=(a0,a1,r)=>{const p=pt(a0,r),q=pt(a1,r);return`M${p[0].toFixed(1)},${p[1].toFixed(1)}A${r},${r} 0 ${a1-a0>180?1:0} 1 ${q[0].toFixed(1)},${q[1].toFixed(1)}`};
N.addWidget("gauge",{
  mount(el,p,ctx){
    el.classList.add("w-gauge");
    el.innerHTML=`<div class="w-label"></div><svg viewBox="0 0 100 82"><path class="w-track" d="${arc(135,405,36)}" fill="none" stroke="var(--line,#e2e4e9)" stroke-width="7" stroke-linecap="round"/><path class="w-val" fill="none" stroke="var(--a,#3b5bdb)" stroke-width="7" stroke-linecap="round"/><text x="50" y="50" text-anchor="middle" style="fill:var(--ink,#15171c);font:600 15px var(--mono,monospace)"></text><text class="w-unit" x="50" y="64" text-anchor="middle" style="fill:var(--mute,#6a7180);font:9px var(--sans,sans-serif)"></text></svg>`;
    el._l=el.querySelector(".w-label"); el._p=el.querySelector(".w-val");
    el._t=el.querySelector("text"); el._u=el.querySelector(".w-unit");
  },
  update(el,p,ctx){
    const r=reg(ctx,p.bind), v=ctx.data[p.bind];
    el._l.textContent=labelOf(p,r,p.bind);
    el._u.textContent=unitOf(p,r);
    const s=fmtVal(ctx,v,r);
    const max=num(p.max)?p.max:ctx.max(p.bind);
    if(s==null||!num(v)||!num(max)||max<=0){
      el._p.setAttribute("d","");
      el._t.textContent=s==null?"—":s;
      el._t.setAttribute("title",s==null?why(ctx,p.bind,r):"skala belum tersedia");
      return;
    }
    const frac=Math.min(1,Math.max(.005,v/max));
    el._p.setAttribute("d",arc(135,135+270*frac,36));
    el._t.textContent=s;
    el._t.removeAttribute("title");
  }
});

/* renderer layout.json: CSS grid 12 kolom (default), posisi x/y/w/h per item */
N.renderLayout=function(root,layout,ctx){
  let obj=layout;
  if(typeof obj==="string"){
    try{obj=JSON.parse(obj);}
    catch(e){root.innerHTML=`<div class="layout-error">layout.json tidak valid: ${esc(e.message)}</div>`;return{update(){}};}
  }
  if(!obj||typeof obj!=="object"||!Array.isArray(obj.items)){
    root.innerHTML=`<div class="layout-error">layout harus objek dengan array "items".</div>`;return{update(){}};
  }
  const cols=Math.max(1,Math.floor(+obj.cols||12));
  const gap=+obj.gap||0;
  root.innerHTML="";
  root.classList.add("layout-host");
  const grid=document.createElement("div");
  grid.className="layout";
  grid.style.cssText=`display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${gap}px;`;
  root.append(grid);       /* item harus sudah di dokumen saat mount (widget boleh query) */
  const inst=[];
  obj.items.forEach(it=>{
    const cell=document.createElement("div");
    cell.className="w";
    const x=+it.x||0, y=+it.y||0, w=Math.max(1,+it.w||1), h=Math.max(1,+it.h||1);
    cell.style.gridColumn=`${x+1} / span ${w}`;
    cell.style.gridRow=`${y+1} / span ${h}`;
    grid.append(cell);
    const def=N.widgets.get(it.widget);
    if(!def){
      cell.classList.add("w-missing");
      cell.textContent=`Widget "${it.widget}" tidak ditemukan`;
    }else{
      inst.push({el:cell,def,it});
      try{if(def.mount)def.mount(cell,it,ctx);}catch(e){cell.innerHTML=`<div class="layout-error">Widget "${esc(it.widget)}" gagal mount: ${esc(e.message)}</div>`;}
    }
  });
  const update=ctx2=>inst.forEach(({el,def,it})=>{
    try{if(def.update)def.update(el,it,ctx2||ctx);}
    catch(e){el.innerHTML=`<div class="layout-error">Widget "${esc(it.widget)}" gagal update: ${esc(e.message)}</div>`;}
  });
  update(ctx);
  return{el:grid,update};
};
})();
