// The dealer drawer's contents: the shop (parts, tunings, mods, reroll) and your mods (sell, log, abandon).
import { townOf } from '../fiction.js';
import {
  BOONS, MODMAX, MODS, PARTS, RARITY, TUNES, applyPurchase, canBuy, genShop, isStorm, modDesc, modLevels,
  modSlots, offerPrice, rerollCost, rerollShop, sellMod, sellValue,
} from '../sim.js';
import { $, DECAL, ICON, R, buzz, fmt, metaOf, persist, sfx, ui } from './core.js';
import { dbody, owned, renderHangar, setTab } from './hangar.js';
import { openLibrary } from './library.js';
import { showPacks } from './rewards.js';
import { endRun } from './title.js';

// L: the level shown (description and pips); up: shown as an upgrade offer
export const pips=L=>`<span class="lvp" aria-label="Level ${L} of ${MODMAX}">${Array.from({length:MODMAX},(_,i)=>`<i class="${i<L?'on':''}"></i>`).join('')}</span>`;
export function modCard(id,btn,L,up){const M=MODS[id];L=L||1;return `<div class="offer ${M.r}">${DECAL?`<img class="decal" alt="" src="${DECAL(id,96,L)}">`:`<div class="glyph ${M.r}" aria-hidden="true">${M.name[0]}</div>`}<div><span class="rar r-${M.r}">${up?'<b class="upg">Upgrade</b> · ':''}${RARITY[M.r].name} · ${M.tag}</span><h3>${M.name} ${pips(L)}<button class="qm" type="button" data-lib="${id}" aria-label="How ${M.name} works">?</button></h3><p>${modDesc(id,L)}</p></div>${btn}</div>`}
export function renderShop(){
  const r=R();
  if(!r.shop){r.shop=genShop(r,metaOf(r));persist()}
  const S=r.shop, full=r.mods.length>=modSlots(r), lv=modLevels(r);
  const btn=(kind,i,o)=>{if(o.sold)return `<button class="buy" type="button" disabled>\u2713</button>`;const p=offerPrice(r,kind,o);
    return `<button class="buy" type="button" data-kind="${kind}" data-i="${i}" ${p>r.coins||!canBuy(r,kind,o)?'disabled':''}><i class="cn"></i>${p}</button>`};
  // an owned mod on offer is an upgrade: show the level it would reach (a sold one already shows its new level)
  const mods=S.mods.length?S.mods.map((o,i)=>{const L=lv[o.id]||0,up=!!L&&!o.sold;return `<div class="${o.sold?'sold':''}">${modCard(o.id,btn('mod',i,o),o.sold?Math.max(1,L):L+1,up)}</div>`}).join(''):'<p class="hint">\u2014</p>';
  const tunes=S.tunes.map((o,i)=>{const T=TUNES[o.k],L=r.tune[o.k]||0;return `<div class="offer${o.sold?' sold':''}"><div class="glyph C" aria-hidden="true">+</div><div><h3>${T.name}</h3><p>${T.d} \u00b7 Lv ${o.sold?L:L+1}${T.max?'/'+T.max:''}</p></div>${btn('tune',i,o)}</div>`}).join('');
  const parts=S.parts.map((o,i)=>`<div class="offer${o.sold?' sold':''}"><img alt="" src="${ICON[o.t]}"><div><h3>${PARTS[o.t].name}</h3><p>${owned(o.t)} owned</p></div>${btn('part',i,o)}</div>`).join('')
    +(S.pack?`<div class="offer rarepack${S.pack.sold?' sold':''}"><div class="glyph R" aria-hidden="true">★</div><div><h3>Rare parts pack</h3><p>A random rare part</p></div>${btn('pack',0,S.pack)}</div>`:'');
  const rc=rerollCost(r);
  $('dealerTitle').textContent='Shop';
  dbody.innerHTML=`
  <div class="card"><span class="label">Parts</span><div class="offers">${parts}</div></div>
  <div class="card"><span class="label">Tuning</span><div class="offers">${tunes}</div></div>
  <div class="card"><div class="row"><span class="label">Mods</span><span class="hint${full?' warn':''}">${r.mods.length}/${modSlots(r)}${full?' full':''}</span></div><div class="offers">${mods}</div></div>
  <div class="row" style="justify-content:flex-end"><button class="ghost" id="reroll" type="button" ${rc>r.coins?'disabled':''}>Reroll <i class="cn"></i>${rc}</button></div>`;
  dbody.onclick=e=>{
    const q=e.target.closest('[data-lib]');if(q){openLibrary(q.dataset.lib);return}
    const b=e.target.closest('.buy[data-kind]');
    if(b){buy(b.dataset.kind,+b.dataset.i);return}
    if(e.target.closest('#reroll')){if(rc>r.coins)return;sfx('reroll');r.coins-=rc;rerollShop(r,metaOf(r));persist();renderHangar()}
  };
}
export function buy(kind,i){
  const r=R(),S=r.shop;const o=kind==='pack'?S.pack:S[kind==='part'?'parts':kind==='tune'?'tunes':'mods'][i];if(!o)return;
  if(applyPurchase(r,kind,o)){sfx('buy');buzz(12);persist();if(kind==='pack'){setTab('build');showPacks()}else renderHangar()}else sfx('error')
}
export function renderMods(){
  const r=R();
  const lv=modLevels(r);
  const slots=Array.from({length:modSlots(r)},(_,i)=>{const id=r.mods[i];if(!id)return `<div class="slot">Empty</div>`;const v=sellValue(id,lv[id]);
    return modCard(id,`<button class="buy sell${ui.armSell===id?' armed':''}" type="button" data-sell="${id}">${ui.armSell===id?'Sell?':'Sell +'+v}</button>`,lv[id])}).join('');
  const tl=Object.entries(r.tune).filter(([,L])=>L>0).map(([k,L])=>`${TUNES[k].name} ×${L}`).join(' · ');
  const bl=Object.entries(r.boons||{}).filter(([k,n])=>n>0&&k!=='coins'&&k!=='upgrade').map(([k,n])=>`${BOONS[k].name}${n>1?' ×'+n:''}`).join(' · ');
  const byStage={};for(const l of r.log)(byStage[l.stage]=byStage[l.stage]||[]).push(l.score);
  const log=Object.keys(byStage).map(s=>{s=+s;const done=s<r.stage;return `<div><span>${townOf(r.seed,s).town}${isStorm(s,r.level)?' \u00b7 storm':''}</span><b>${byStage[s].map(fmt).join(' · ')}${done?' ✓':''}</b></div>`}).join('');
  $('dealerTitle').textContent='Your mods';
  dbody.innerHTML=`
  <div class="card"><div class="row"><span class="label">Mods</span><span class="hint">${r.mods.length}/${modSlots(r)}</span></div><div class="offers">${slots}</div></div>
  <div class="card"><span class="label">Tuning</span><p class="hint" style="margin-top:6px">${tl||'\u2014'}</p></div>
  ${bl?`<div class="card"><span class="label">Storm rewards</span><p class="hint" style="margin-top:6px">${bl}</p></div>`:''}
  <div class="card"><span class="label">Log</span><div class="log">${log||'<div>\u2014</div>'}</div></div>
  <div class="card stack"><button class="ghost" id="libOpen" type="button">Mods library</button><button class="ghost${ui.armAbandon?' armed':''}" id="aband2" type="button">${ui.armAbandon?'Tap again':ui.slot==='online'?'Leave room':ui.slot==='daily'?'End puzzle':'Abandon run'}</button></div>`;
  dbody.onclick=e=>{
    const q=e.target.closest('[data-lib]');if(q){openLibrary(q.dataset.lib);return}
    if(e.target.closest('#libOpen')){openLibrary();return}
    const b=e.target.closest('[data-sell]');
    if(b){const id=b.dataset.sell;if(ui.armSell!==id){ui.armSell=id;renderMods();return}ui.armSell=null;sfx('sell');sellMod(r,id);persist();renderHangar();return}
    if(e.target.closest('#aband2')){if(!ui.armAbandon){ui.armAbandon=true;renderMods();return}endRun()}
  };
}
