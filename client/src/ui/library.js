// The mods library drawer: every mod with its values per level, plus the tricks the score mods refer to.
import { MODS, RARITY, modLevels, modUnlocked } from '../sim.js';
import { $, DECAL, ICON, metaOf, save, ui } from './core.js';

/* ================= mods library ================= */
// every mod with its values at each level and one plain line on how to trigger it, plus the tricks the score mods refer to
export const TRICKS=[['Loop','Turn a full circle in the air (hold NOSE UP over the top).','+0.5'],['Low pass','Fly under 4 m fast for a second, then climb above 8 m.','+0.25'],
  ['Thermal','Fly through a rising air column.','+0.1'],['Coin','Fly through a gold coin.','+0.05'],['Touchdown','Land and roll to a stop without crashing.','+0.5'],
  ['Altitude','Reach 100, 250, 500, 750, 1000 m … Land afterwards and each height adds to the distance score (a landing bonus).','+200 … +1000'],
  ['Distance','Fly past 500, 1250, 2500, 3750, 5000 m … Land afterwards and each mark adds to the distance score (a landing bonus).','+200 … +1000'],['Redline','Reach 500 km/h.','+1'],['Cloud nine','Climb to 5 km.','+2']];
export const lib=$('library');let libTag='All';
export function descAll(id){const M=MODS[id],j=a=>a.map(x=>String(Math.round(x*100)/100)).join(' / ');
  return M.d.replace('{v%}',M.v?M.v.map(x=>Math.round(x*100)).join(' / ')+'%':'').replace('{v}',M.v?j(M.v):'').replace('{w}',M.w?j(M.w):'')}
export function renderLibrary(focus){
  const r=save[ui.slot],lv=r?modLevels(r):{},meta=r?metaOf(r):save.meta;
  const tags=['All',...new Set(Object.values(MODS).map(M=>M.tag))];
  const ids=Object.keys(MODS).filter(id=>libTag==='All'||MODS[id].tag===libTag);
  $('libBody').innerHTML=`<div class="libtags seg">${tags.map(t=>`<button type="button" data-t="${t}" aria-pressed="${t===libTag}">${t}</button>`).join('')}</div>
    <p class="hint libnote">Numbers show levels 1 / 2 / 3.</p>
    ${libTag==='All'||libTag==='Score'?`<details class="card tricks"><summary class="label">Tricks</summary><dl>${TRICKS.map(([n,d,v])=>`<dt>${n} <b>${v}</b></dt><dd>${d}</dd>`).join('')}</dl></details>`:''}
    <div class="libmods">${ids.map(id=>{const M=MODS[id],L=lv[id],locked=!modUnlocked(id,meta);
      return `<div class="libmod ${M.r}${id===focus?' focus':''}" id="lib-${id}"><img class="decal" alt="" src="${DECAL?DECAL(id,96,L||1):ICON.wing}">
        <div><span class="rar r-${M.r}">${RARITY[M.r].name} · ${M.tag}${L?` · <b class="own">Yours, Lv ${L}</b>`:''}</span><h3>${M.name}</h3>
        <p class="eff">${descAll(id)}</p><p class="how">${M.how}</p>${locked?`<p class="lock">Unlocks after clearing contract ${M.lock} in one run</p>`:''}</div></div>`}).join('')}</div>`;
  const box=$('libBody');box.scrollTop=0;if(focus){const el=$('lib-'+focus);if(el)requestAnimationFrame(()=>{box.scrollTop=el.offsetTop-box.offsetTop-box.clientHeight/2+el.offsetHeight/2})}
}
export function openLibrary(focus){
  if(focus)libTag='All';renderLibrary(focus);
  lib.hidden=false;requestAnimationFrame(()=>lib.classList.add('open'));
}
export function closeLibrary(){lib.classList.remove('open');setTimeout(()=>{lib.hidden=true},260)}
$('libX').onclick=$('libScrim').onclick=closeLibrary;
$('libBody').onclick=e=>{const b=e.target.closest('.libtags button');if(b){libTag=b.dataset.t;renderLibrary()}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!lib.hidden)closeLibrary()});
