// The profile: run history, name, and the cloud save settings (link codes for another device).
import { drawPilot } from '../art.js';
import { cellsOf } from '../bots.js';
import { decalURL } from '../decals.js';
import { townOf } from '../fiction.js';
import { claimCode, cloudGet, linkCode } from '../net.js';
import { CONTRACTS, MODS, TUNES } from '../sim.js';
import {
  $, ICON, adoptCloud, cloudLabel, cloudPush, esc, fmt, persist, save, setCloud, sfx, sheet,
  store, veil,
} from './core.js';
import { renderTitle } from './title.js';

/* ---------- history: finished runs and puzzles ----------
   save.meta.history, newest first, at most HIST_MAX (it rides along in the cloud save). Each entry keeps the build, mods
   and tunings of the last flight, and the result: contract reached and best single flight for a run, total for a puzzle. */
export const HIST_MAX=40;
export function addHistory(r){
  if(!r||!r.log||!r.log.length)return;
  const s=r.log[r.log.length-1].s||{}, daily=r.mode==='daily';
  const e={k:daily?(r.ranked?'daily':'puzzle'):'run',t:Date.now(),cells:s.cells||'c22',mods:s.mods||[],tune:s.tune||{},flights:r.log.length};
  if(daily){e.day=r.day;e.total=r.total||r.score||0}
  else Object.assign(e,{lv:r.level||0,cleared:r.stage,endless:!!r.endless,best:Math.max(...r.log.map(l=>l.score)),town:townOf(r.seed,r.stage).town,lost:r.phase==='over'});
  const h=save.meta.history=save.meta.history||[];h.unshift(e);if(h.length>HIST_MAX)h.length=HIST_MAX;
}
// the craft cropped to its parts, drawn with the bench icons
export function miniCraft(code){
  const cells=cellsOf(code),xs=cells.map(c=>c.c),ys=cells.map(c=>c.r),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0+1,h=Math.max(...ys)-y0+1;
  return `<div class="hcraft" style="grid-template-columns:repeat(${w},1fr);grid-template-rows:repeat(${h},1fr);width:${Math.min(132,w*26)}px">${cells.map(c=>
    `<img alt="" src="${ICON[c.type+(c.rare?'+':'')]}" style="grid-column:${c.c-x0+1};grid-row:${c.r-y0+1}">`).join('')}</div>`;
}
export function histEntry(e){
  const date=new Date(e.t).toLocaleDateString(undefined,{day:'numeric',month:'short'});
  const rank=e.k==='daily'&&save.meta.daily&&save.meta.daily[e.day]&&save.meta.daily[e.day].rank;
  const title=e.k==='run'?`Run${e.lv?' · Difficulty '+e.lv:''}`:e.k==='daily'?`Daily puzzle #${e.day}`:'Random puzzle';
  const result=e.k!=='run'?`Total score <b>${fmt(e.total)}</b>${rank?` · rank ${rank}`:''}`
    :e.cleared>=CONTRACTS?`<b>Won</b>${e.endless&&e.cleared>CONTRACTS?` · endless to contract ${e.cleared+(e.lost?1:0)}`:''}`
    :`Reached contract <b>${e.cleared+1}</b> of ${CONTRACTS} · ${esc(e.town)}`;
  const mods=e.mods.map(x=>{const [id,l]=x.split(':');return MODS[id]?`<img alt="${esc(MODS[id].name)}" title="${esc(MODS[id].name)}${l?' Lv '+l:''}" src="${decalURL(id,40,+l||1)}">`:''}).join('');
  const tune=Object.entries(e.tune).filter(([k,L])=>L>0&&TUNES[k]).map(([k,L])=>`${TUNES[k].name} ${L}`).join(' · ');
  return `<div class="hentry"><div class="row"><b class="htitle">${title}</b><span class="hint">${date}</span></div>
    <div class="hbody">${miniCraft(e.cells)}<div class="hres"><div>${result}</div>${e.k==='run'?`<div>Best flight <b>${fmt(e.best)}</b></div>`:''}</div></div>
    ${mods?`<div class="hmods">${mods}</div>`:''}${tune?`<p class="hint">${tune}</p>`:''}</div>`;
}
export function showHistory(){
  const h=save.meta.history||[];
  sheet.className='sheet';sheet.innerHTML=`<div class="hhead"><span class="label">History</span><button class="big" id="hOk" type="button">Close</button></div><div class="hlist">${h.map(histEntry).join('')}</div>`;
  veil.hidden=false;$('hOk').onclick=()=>{veil.hidden=true};
}

/* ---------- profile ---------- */
export const PENCIL='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-5L16 4l4 4L9 19z M14 6l4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>';
export const GEAR='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2 2.6 3.2-.6.7 3.2 2.9 1.5-1.4 3 1.4 3-2.9 1.5-.7 3.2-3.2-.6-2 2.6-2-2.6-3.2.6-.7-3.2-2.9-1.5 1.4-3-1.4-3 2.9-1.5.7-3.2 3.2.6z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
export let AVATAR='';
export function avatarURL(){if(AVATAR)return AVATAR;const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');
  g.translate(64,74);g.scale(92,92);drawPilot(g,'grin',0,{lw:.045});return AVATAR=c.toDataURL()}
export function editName(){
  sheet.className='sheet';sheet.innerHTML=`<span class="label">Your name</span>
    <div class="namerow"><input id="pName" maxlength="16" placeholder="Pilot" autocomplete="nickname" value="${esc(save.meta.name||'')}"><button class="big" id="pOk" type="button">Save</button></div>
    <p class="hint">Shown on the daily leaderboard and in live rooms.</p><button class="ghost" id="pNo" type="button">Cancel</button>`;
  veil.hidden=false;const inp=$('pName');inp.focus();$('pNo').onclick=()=>{veil.hidden=true};
  const ok=()=>{const n=inp.value.trim().slice(0,16);if(!n){inp.focus();return}save.meta.name=n;persist();veil.hidden=true;renderTitle()};
  $('pOk').onclick=ok;inp.onkeydown=e=>{if(e.key==='Enter')ok()};
}
export function showSettings(){
  sheet.className='sheet';sheet.innerHTML=`<span class="label">Your progress</span><p class="hint" id="cloudState">${cloudLabel()}</p>
    <div class="row2"><button class="ghost" id="cloudOut" type="button">Use on another device</button><button class="ghost" id="cloudIn" type="button">Enter a code</button></div>
    <button class="big" id="sOk" type="button">Done</button>`;
  veil.hidden=false;$('sOk').onclick=()=>{veil.hidden=true};$('cloudOut').onclick=showLinkCode;$('cloudIn').onclick=showClaim;
}

// a code for another device: it signs that device into this account (10 minutes, single use)
export async function showLinkCode(){
  sheet.className='sheet';sheet.innerHTML=`<span class="label">Use on another device</span><h2 class="rcode" id="lcode">…</h2>
    <p class="hint">On the other device: Profile → ⚙ → Enter a code. Valid for 10 minutes.</p><button class="big" id="lOk" type="button">Done</button>`;
  veil.hidden=false;$('lOk').onclick=()=>{veil.hidden=true};
  try{await cloudPush();const {code}=await linkCode();if($('lcode'))$('lcode').textContent=code.slice(0,4)+'-'+code.slice(4)}
  catch(_){if($('lcode'))$('lcode').textContent='Offline'}
}
export function showClaim(){
  sheet.className='sheet';sheet.innerHTML=`<span class="label">Enter a code</span>
    <p class="note">Shown on your other device under Profile → ⚙ → Use on another device. This device then plays that progress (its own is replaced).</p>
    <div class="joinrow"><input id="ccode" maxlength="9" placeholder="XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Code"><button class="big" id="cGo" type="button">Use</button></div>
    <p class="hint warn" id="cErr" hidden></p><button class="ghost" id="cNo" type="button">Cancel</button>`;
  veil.hidden=false;$('cNo').onclick=()=>{veil.hidden=true};
  $('cGo').onclick=async()=>{const code=($('ccode').value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');const err=$('cErr');
    if(code.length!==8){err.hidden=false;err.textContent='The code has 8 letters and digits.';return}
    $('cGo').disabled=true;
    try{await claimCode(code);const c=await cloudGet();if(c.save)adoptCloud(c.save,c.rev,c.t);else{save.cloud={rev:c.rev||0};store()}setCloud('ok');veil.hidden=true;sfx('fanfare')}
    catch(e){err.hidden=false;err.textContent=e.message||'That code did not work.';$('cGo').disabled=false}};
}
