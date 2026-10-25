// The title screen: run / daily / room cards, profile and stats, the looping plane, and ending a run.
import { drawPart } from '../art.js';
import { townOf } from '../fiction.js';
import { openGuide } from '../guide.js';
import { CONTRACTS, UNLOCKS, ceilingRules, newRun } from '../sim.js';
import { CARD } from '../troupe.js';
import {
  $, esc, fmt, homeURL, persist, plural, reduceMotion, reportRun, save, show, ui,
  veil,
} from './core.js';
import { bindModeCards, dailyCard, leaveMode } from './daily.js';
import { openHangar } from './hangar.js';
import { openLibrary } from './library.js';
import { GEAR, PENCIL, addHistory, avatarURL, editName, showHistory, showSettings } from './profile.js';
import { roomCard } from './rooms.js';

export function endRun(){if(ui.slot!=='run'){leaveMode();return}reportRun(save.run,true);addHistory(save.run);save.meta.runs=(save.meta.runs||0)+1;save.run=null;persist();veil.hidden=true;ui.armAbandon=false;show('title');renderTitle()}
/* ================= title ================= */
// a home card's header: title (and a hint line) beside the card's small picture
export const cardHead=(label,hint,pic)=>`<div class="chead"><div><span class="label">${label}</span>${hint?`<p class="hint">${hint}</p>`:''}</div><img class="cpic" alt="" src="${pic}"></div>`;
export let pickLevel=save.meta.level||0;
export function renderTitle(){
  const m=save.meta, r=save.run;
  pickLevel=Math.min(pickLevel,m.level||0);
  let h='';
  if(r){
    const tw=townOf(r.seed,r.stage);
    h+=`<div class="card stack">${cardHead('Current run',`Contract ${r.stage+1}${r.endless?' (endless)':' of '+CONTRACTS}: <strong>${tw.town}</strong> · ${r.coins} coins · ${plural(r.mods.length,'mod')}${r.level?' · Difficulty '+r.level:''}`,CARD.run)}
      <button class="big" id="cont" type="button">Continue run</button>
      <button class="ghost${ui.armAbandon?' armed':''}" id="aband" type="button">${ui.armAbandon?'Tap again to abandon':'Abandon run'}</button></div>`;
  }else{
    h+=`<div class="card">${cardHead('New run','',CARD.run)}
      ${m.level>0?`<div style="margin-top:12px"><div class="row" style="margin-bottom:6px"><span class="label">Difficulty</span></div><div class="seg" id="lvl">${Array.from({length:m.level+1},(_,i)=>`<button type="button" data-l="${i}" aria-pressed="${i===pickLevel}">${i}</button>`).join('')}</div>
        ${pickLevel?`<div class="crules"><span>+${pickLevel*25}% score targets</span>${ceilingRules(pickLevel).map(t=>`<span>${t}</span>`).join('')}</div>`:''}</div>`:''}
      <div style="margin-top:12px"><button class="big" id="start" type="button">Start run</button></div></div>`;
  }
  // the games, then you (on landscape screens all cards sit in one column beside a big logo, style.css)
  h=`<div class="tcol tgames">${h}`+dailyCard()+roomCard();
  h+=`<div class="row2"><button class="ghost howto${m.guideSeen?'':' new'}" id="howto" type="button">How to play</button><button class="ghost" id="libBtn" type="button">Mods library</button></div>`;
  h+=`</div><div class="tcol tme"><div class="card"><span class="label">Profile</span>
    <div class="profile"><img class="avatar" alt="" src="${avatarURL()}"><div class="pname"><strong>${esc(m.name||'Pilot')}</strong>
      <button class="icon" id="nameEdit" type="button" aria-label="Change name">${PENCIL}</button></div>
      <button class="icon" id="profSet" type="button" aria-label="Settings">${GEAR}</button></div>
    <div class="row" style="margin-top:14px"><span class="label">Stats</span>${(m.history||[]).length?'<button class="ghost hbtn" id="histBtn" type="button">History</button>':''}</div>
    <dl class="stats"><dt>Runs</dt><dd>${m.runs}</dd><dt>Wins</dt><dd>${m.wins}</dd><dt>Most contracts in a run</dt><dd>${m.deepest||m.bestStage}</dd><dt>Best score</dt><dd>${fmt(m.bestFlight)}</dd>${m.level?`<dt>Highest Difficulty</dt><dd>${m.level}</dd>`:''}</dl>
    <div class="row" style="margin-top:12px"><span class="label">Unlocks</span><span class="hint">contracts in one run</span></div>
    <ul class="unl">${UNLOCKS.map(u=>{const d=m.bestStage>=u.at;return `<li class="${d?'done':''}"><i>${d?'\u2713':u.at}</i><span>${u.text}</span></li>`}).join('')}</ul></div>`;
  const legal=homeURL('/imprint-and-privacy-policy.html'); // .html so the dev server finds it too; Cloudflare Pages redirects it to the clean URL
  h+=`<p class="ver">v${__VERSION__} · <a href="${legal}#imprint" target="_blank" rel="noopener">Imprint</a> · <a href="${legal}#privacy" target="_blank" rel="noopener">Privacy</a></p></div>`;
  $('titleBody').innerHTML=h;
  startTitleScene();
  $('howto').onclick=openGuide;
  $('libBtn').onclick=()=>openLibrary();
  bindModeCards();
  {const hb=$('histBtn');if(hb)hb.onclick=showHistory}
  $('nameEdit').onclick=editName;$('profSet').onclick=showSettings;
  if(r){
    $('cont').onclick=()=>{ui.armAbandon=false;ui.slot='run';openHangar()};
    $('aband').onclick=()=>{if(!ui.armAbandon){ui.armAbandon=true;renderTitle();return}endRun()};
  }else{
    const lv=$('lvl');if(lv)lv.onclick=e=>{const b=e.target.closest('button');if(b){pickLevel=+b.dataset.l;renderTitle()}};
    $('start').onclick=()=>{ui.slot='run';save.run=newRun(pickLevel,save.meta);persist();ui.tab='build';ui.sel='wing';openHangar()};
  }
}

// the title's hero: a little plane with the goat looping on a dashed brass contrail
export let titleRaf=0;
export function startTitleScene(){
  cancelAnimationFrame(titleRaf);
  const c=$('titleCv');if(!c)return;
  const draw=now=>{
    if($('title').hidden){titleRaf=0;return}
    const w=c.clientWidth,h=c.clientHeight,d=Math.min(2,window.devicePixelRatio||1);if(!w)return;
    if(c.width!==Math.round(w*d)){c.width=Math.round(w*d);c.height=Math.round(h*d)}
    const g=c.getContext('2d');g.setTransform(d,0,0,d,0,0);g.clearRect(0,0,w,h);
    const t=reduceMotion()?1.2:now/1000, cx=w/2, cy=h*.52, R=Math.min(w*.3,h*.36);
    // a loop-the-loop path: the plane rides it, the contrail trails behind
    const pt=u=>{const a=u*Math.PI*2;return [cx+Math.sin(a)*R*1.25+Math.sin(a*2)*R*.15,cy-Math.cos(a)*R*.55+R*.1]};
    const k=Math.max(1,Math.min(w/330,h/150));g.strokeStyle='#e9a93b';g.lineWidth=5*k;g.lineCap='round';g.setLineDash([2*k,11*k]);g.beginPath();
    const u0=(t*.12)%1;for(let i=0;i<=60;i++){const [x,y]=pt(u0-i/60*.55);i?g.lineTo(x,y):g.moveTo(x,y)}g.stroke();g.setLineDash([]);
    const [x,y]=pt(u0),[x2,y2]=pt(u0+.005),ang=Math.atan2(y2-y,x2-x),s=Math.min(30*k,w/11);
    g.save();g.translate(x,y);g.rotate(ang);g.scale(s,s);
    for(const [type,lx,ly] of [['cockpit',0,0],['frame',1,0],['prop',2,0],['wing',0,-1],['wing',1,-1]]){g.save();g.translate(lx-.6,ly);drawPart(g,type,t,{on:true,frac:.8,lw:2.5/s,mood:'grin'});g.restore()}
    g.restore();
    titleRaf=requestAnimationFrame(draw);
  };
  titleRaf=requestAnimationFrame(draw);
}
