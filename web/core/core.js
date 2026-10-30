/* core.js — shim kompatibilitas tipis.
   Dulu file ini memuat data + shell sekaligus. Sekarang sudah dipisah:
     client.js  (data, tanpa DOM)  ->  widgets.js  ->  shell.js (DOM)
   index.html memuat ketiganya langsung. File ini hanya untuk pemanggil lama
   yang masih menyertakan core.js sendirian: ia memuat tiga file di atas
   secara berurutan. */
(function(){
"use strict";
if(window.Noterra&&window.Noterra.ctx)return;
const here=(document.currentScript&&document.currentScript.src)||"";
const base=here.replace(/core\.js(?:\?.*)?$/,"");
const files=["client.js","widgets.js","shell.js"];
(function next(i){
  if(i>=files.length)return;
  const s=document.createElement("script");
  s.src=base+files[i];
  s.onload=()=>next(i+1);
  s.onerror=()=>console.error("core.js shim: gagal memuat "+files[i]);
  document.head.append(s);
})(0);
})();
