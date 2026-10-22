// Wingnut Circus UI: hangar (build / shop / mods), flight rendering + input, results and run screens.
import {
  GIMBAL, NEUT, PAR, VAC, VAC2, C_LIGHT, G0, COLS,
  ROWS, COCKPIT, MAXMODS, FLIGHTS, CONTRACTS, FLIGHT_TIME, clamp, PARTS, PALETTE,
  TUNES, tuneCost, RARITY, MODS, WEATHER, weatherFx, START, UNLOCKS,
  modUnlocked, QUOTA, quotaFor, isStorm, weatherOf, stats, DIRS,
  SOCK, STRUCT, linkage, connected, balanceOf, makeCraft, hs, groundY,
  COINSEG, COINR, thermalSeg, coinAt, newFlight, segDist, flag, step,
  popBalloons, summaryOf, scoreFlight, wpick, PART_W, rollMods, rollTunes, genShop,
  rerollShop, priceOf, offerPrice, rerollCost, sellValue, newRun, craftCounts, flightCtx, onTarget, TARGET_EVERY, settleFlight,
  PACKS, FIRST_PACKS, rollPacks, grantPacks, openPack, RARE, RARE_CHANCE, RARE_PACK_PRICE, isRare, baseOf, partName,
  MODMAX, modLevels, modVal, modDesc, modPrice, canBuy, applyPurchase, sellMod, flightStats, repeats, severity,
  MAX_CEILING, CEILING_RULES, ceilingRules, REDLINE, CLOUD9, ALT_STEP, altBonus, altMilestones, altReached,
  BOONS, rollBoons, boonDesc, pickBoon, modSlots,
  DAILY_COINS, dailyNumber, dailySeed, SIM_DT, isOnline, ONLINE_TIME, clearContract,
} from './sim.js';
import { getDaily, postDaily, newRoomCode, connectRoom, cloudGet, cloudPut, linkCode, claimCode } from './net.js';
import { botFlight, planBot, cellsOf } from './bots.js';
import { drawWorld, drawGrain, biomeOf, preloadLayers } from './world.js';
import { audio } from './audio.js';
import { drawPart, drawPilot, drawParachute, KINS } from './art.js';
import { hostHTML, setHost, CARD, MAP, MAP_TOWNS, preloadMap } from './troupe.js';
import { decalURL } from './decals.js';
import { townOf, showTitle, headline } from './fiction.js';
import { initGuide, openGuide } from './guide.js';

/* ================= persistence ================= */
const KEY='rogueflight-1'; // storage keys keep the game's original id (RogueFlight) so saves survive the rename
const META0={runs:0,wins:0,bestStage:0,bestFlight:0,deepest:0,level:0};
// save.run: the main run; save.daily: a daily or random puzzle in progress; save.online: the run of the live room save.room
// arriving from the old address (see MOVED): take over the save (and the cloud-save login, so the device stays on its
// account) handed over in the URL fragment, unless this browser already has one here. The fragment never reaches any server.
{const m=location.hash.match(/^#move=(.+)$/);if(m){try{const d=JSON.parse(decodeURIComponent(escape(atob(m[1]))));
  for(const [k,v] of [[KEY,d.save],['rogueflight-client',d.client],['rogueflight-audio',d.audio],['rogueflight-auth',d.auth]])if(v&&!localStorage.getItem(k))localStorage.setItem(k,v)}catch(_){}
  history.replaceState(null,'',location.pathname+location.search)}}
// t: when this device last changed the save (cloud sync keeps the newer copy); cloud.rev: the server's revision we hold
let save=(()=>{try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&s.meta)return {meta:{...META0,...s.meta},run:s.run||null,daily:s.daily||null,online:s.online||null,room:s.room||null,t:s.t||0,cloud:s.cloud||{rev:0}}}catch(e){}return {meta:{...META0},run:null,daily:null,online:null,room:null}})();
if(save.daily&&save.daily.phase==='done')save.daily=null;
function persist(){save.t=Date.now();store();cloudSoon()}
const store=()=>{try{localStorage.setItem(KEY,JSON.stringify(save))}catch(e){}};

/* ---------- cloud save ----------
   The save also lives on the game server under this player's guest account (net.js, server/accounts.js), so it survives
   updates, new addresses, reinstalls (with a link code) and new devices. A few seconds after a change, and when the app
   goes to the background, it is uploaded; on start the newer copy (device or cloud) wins. Rooms stay on this device. */
const CLOUD={state:'idle',timer:0,busy:false,again:false};
const cloudCopy=()=>({meta:save.meta,run:save.run,daily:save.daily});
const hasProgress=s=>!!(s&&(s.run||s.daily||(s.meta&&(s.meta.runs||s.meta.bestFlight||s.meta.dailyEver))));
function cloudSoon(ms=4000){clearTimeout(CLOUD.timer);CLOUD.timer=setTimeout(()=>cloudPush(),ms)}
function setCloud(st){CLOUD.state=st;const el=document.getElementById('cloudState');if(el)el.textContent=cloudLabel()}
const cloudLabel=()=>({ok:'Saved to the cloud ✓',saving:'Saving…',off:'Offline: saved on this device',idle:'Connecting…'})[CLOUD.state]||'';
// take the cloud's save: it replaces this device's progress (rooms and the current flight stay as they are)
function adoptCloud(data,rev,t){
  save={...save,meta:{...META0,...(data.meta||{})},run:data.run||null,daily:data.daily||null,t:t||Date.now(),cloud:{rev}};
  if(slot!=='online')slot='run';store();
  if(!$('title').hidden)renderTitle();else if(!$('hangar').hidden&&R())renderHangar();
}
async function cloudPush(keepalive){
  if(CLOUD.busy){CLOUD.again=true;return}
  if(F&&!keepalive){cloudSoon(3000);return} // not mid-flight: the frame loop has the stage
  CLOUD.busy=true;setCloud('saving');
  try{
    let r=await cloudPut(cloudCopy(),save.cloud.rev,save.t,keepalive);
    if(r.status===409){
      // another device saved meanwhile: the newer copy wins
      if((r.t||0)>save.t&&!F){adoptCloud(r.save||{},r.rev,r.t);setCloud('ok');return}
      r=await cloudPut(cloudCopy(),r.rev,save.t,keepalive);
    }
    if(r.rev){save.cloud={rev:r.rev};store();setCloud('ok')}else setCloud('off');
  }catch(_){setCloud('off');cloudSoon(30000)}
  finally{CLOUD.busy=false;if(CLOUD.again){CLOUD.again=false;cloudSoon(500)}}
}
// on start: compare with the cloud copy and keep the newer one
async function cloudStart(){
  try{
    const c=await cloudGet();
    if(c.save&&(!hasProgress(save)||(c.t||0)>save.t))adoptCloud(c.save,c.rev,c.t);
    else{save.cloud={rev:c.rev||0};store();if(hasProgress(save))await cloudPush();}
    setCloud('ok');
  }catch(_){setCloud('off');setTimeout(cloudStart,60000)}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&save.t>0){clearTimeout(CLOUD.timer);cloudPush(true)}});

/* ================= formatting ================= */
const SUF=['','k','M','B','T','Qa','Qi','Sx','Sp','Oc','No','Dc'];
function fmt(n){n=Math.floor(n);if(n<1e4)return n.toLocaleString('en-US');let i=0,x=n;while(x>=1000&&i<SUF.length-1){x/=1000;i++}if(x>=1000)return n.toExponential(2).replace('+','');return (x<10?x.toFixed(2):x<100?x.toFixed(1):x.toFixed(0))+SUF[i]}
function fmtD(m){if(m<1000)return Math.floor(m)+' m';const km=m/1000;if(km<1000)return (km<10?km.toFixed(2):km<100?km.toFixed(1):km.toFixed(0))+' km';return fmt(km)+' km'}
function fmtV(v){const kmh=v*3.6;return (kmh<1e4?Math.round(kmh).toLocaleString('en-US'):fmt(kmh))+' km/h'+(v>343?' · Mach '+(v/343<100?(v/343).toFixed(1):fmt(v/343)):'')}
const mul=x=>x>=1000?fmt(x):x>=10?x.toFixed(1):x.toFixed(2);
const num=x=>{const r=Math.round(x*100)/100;return (r>=100?fmt(r):String(r))};
const plural=(n,w)=>n+' '+w+(n===1?'':'s');

/* ================= part drawing (art.js) ================= */
const ICON={};
// icons for every part, and for the rare variants ('wing+' etc.), which art.js draws with brass trim
for(const t of [...Object.keys(PARTS),...Object.keys(RARE).map(k=>k+'+')]){const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d');g.translate(48,48);g.scale(96,96);drawPart(g,t,.33,{frac:.7,lw:.055});ICON[t]=c.toDataURL()}
// the cockpit with another animal pilot (live rooms), and that pilot's face for player lists
const KICON={},KFACE={};
const kinIcon=k=>KICON[k]||(KICON[k]=(()=>{const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d');g.translate(48,48);g.scale(96,96);drawPart(g,'cockpit',.33,{lw:.055,kin:k});return c.toDataURL()})());
const kinFace=k=>KFACE[k]||(KFACE[k]=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.translate(32,37);g.scale(46,46);drawPilot(g,'idle',0,{lw:.05,kin:k,scarf:.4});return c.toDataURL()})());
const cellIcon=p=>p.type==='cockpit'&&slot==='online'&&ROOM?kinIcon(kinOf(clientId())):ICON[keyOf(p)];
// a part on the bench as its inventory key: rare ones are 'wing+' etc.
const keyOf=c=>c.rare?c.type+'+':c.type;
// the compact cell code used for telemetry and ghosts: type initial + column + row, upper case for rare parts
const cellCodeOf=cells=>cells.map(c=>{const l=c.type==='cockpit'?'c':c.type[0];return (c.rare?l.toUpperCase():l)+c.c+c.r}).join(' ');

const $=id=>document.getElementById(id);
const veil=$('veil'), sheet=$('sheet'), bench=$('bench');
function show(id){for(const s of ['title','hangar','flight'])$(s).hidden=s!==id;audio.music(id==='title'?'title':id==='hangar'?'hangar':'flight');if(id!=='hangar'){const d=$('dealer');d.classList.remove('open');d.hidden=true;tab='build'}}
// which run the hangar and flight are showing: 'run', 'daily' or 'online'
let slot='run';
const R=()=>save[slot];
// puzzles and rooms use the same shop pool for everyone (all unlocks), and never touch the player's records
const metaOf=r=>r&&r.mode&&r.mode!=='run'?{bestStage:CONTRACTS,level:0}:save.meta;
const esc=t=>String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let armAbandon=false;
function runCode(r){if(!r)return '';const L=t=>t==='cockpit'?'c':t[0];
  return JSON.stringify({lvl:r.level,cleared:r.stage,boons:r.boons||{},endless:!!r.endless,coins:r.coins,mods:r.mods.map(id=>{const L=modLevels(r)[id];return L>1?id+':'+L:id}),tune:r.tune,inv:r.inv,
    cells:cellCodeOf(r.cells),log:r.log.map(l=>[l.stage+1,l.flight,l.score,l.d,l.x,l.s||null]),ev:r.ev||[]})}
// telemetry: after every flight and when a run ends, the run goes to /api/run (a Pages Function storing it in D1, one row
// per run, updated in place) for balancing. Each flight carries a snapshot (build, score lines, height, speed, how it
// ended); ev lists purchases, sales, rerolls, packs and storm rewards. Anonymous: a random id per browser and the run code.
// Production builds only.
// the game's home: copies hosted elsewhere (itch.io, a future app) send telemetry and invite links here
// HOME: where copies hosted elsewhere (itch.io) send telemetry and invite links. MOVED: once wingnut-circus.com serves
// the game, set it here; the old addresses (OLD_HOSTS) then send players over with their save
const HOME='https://wingnut-circus.com', MOVED='https://wingnut-circus.com', OLD_HOSTS=['rogueflight.pages.dev','wingnut-circus.pages.dev','www.wingnut-circus.com'],
  ATHOME=/(^|\.)rogueflight\.pages\.dev$|(^|\.)wingnut-circus\.pages\.dev$|(^|\.)wingnut-circus\.com$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
const homeURL=p=>(ATHOME?location.origin:HOME)+p;
function clientId(){try{let id=localStorage.getItem('rogueflight-client');if(!id){id=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('rogueflight-client',id)}return id}catch(_){return ''}}
function reportRun(r,finished){
  if(!import.meta.env.PROD||!r||!r.log.length)return;
  try{const data={...JSON.parse(runCode(r)),weather:r.weather,seed:r.seed};const mode=r.mode||'run';
    // beacons cap at 64 KB: very long endless runs keep snapshots for their last 100 flights only
    if(JSON.stringify(data).length>55000)data.log=data.log.map((l,i,a)=>i<a.length-100?l.slice(0,5):l);
    const body=JSON.stringify({client:clientId(),run_id:clientId()+':'+mode+':'+r.seed,mode,version:__VERSION__+'+'+__BUILD__,level:r.level,cleared:r.stage,endless:!!r.endless,
      won:mode==='run'||mode==='team'?r.stage>=CONTRACTS:false,host:import.meta.env.MODE==='itch'?'itch':location.hostname,flights:r.log.length,finished:!!finished,data});
    const url=homeURL('/api/run');if(!(navigator.sendBeacon&&navigator.sendBeacon(url,body)))fetch(url,{method:'POST',body,keepalive:true,mode:ATHOME?'same-origin':'no-cors'}).catch(()=>{})}catch(_){}
}
function endRun(){if(slot!=='run'){leaveMode();return}reportRun(save.run,true);addHistory(save.run);save.meta.runs=(save.meta.runs||0)+1;save.run=null;persist();veil.hidden=true;armAbandon=false;show('title');renderTitle()}

/* ================= title ================= */
// a home card's header: title (and a hint line) beside the card's small picture
const cardHead=(label,hint,pic)=>`<div class="chead"><div><span class="label">${label}</span>${hint?`<p class="hint">${hint}</p>`:''}</div><img class="cpic" alt="" src="${pic}"></div>`;
let pickLevel=save.meta.level||0;
function renderTitle(){
  const m=save.meta, r=save.run;
  pickLevel=Math.min(pickLevel,m.level||0);
  let h='';
  if(r){
    const tw=townOf(r.seed,r.stage);
    h+=`<div class="card stack">${cardHead('Current run',`Contract ${r.stage+1}${r.endless?' (endless)':' of '+CONTRACTS}: <strong>${tw.town}</strong> · ${r.coins} coins · ${plural(r.mods.length,'mod')}${r.level?' · Difficulty '+r.level:''}`,CARD.run)}
      <button class="big" id="cont" type="button">Continue run</button>
      <button class="ghost${armAbandon?' armed':''}" id="aband" type="button">${armAbandon?'Tap again to abandon':'Abandon run'}</button></div>`;
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
    $('cont').onclick=()=>{armAbandon=false;slot='run';openHangar()};
    $('aband').onclick=()=>{if(!armAbandon){armAbandon=true;renderTitle();return}endRun()};
  }else{
    const lv=$('lvl');if(lv)lv.onclick=e=>{const b=e.target.closest('button');if(b){pickLevel=+b.dataset.l;renderTitle()}};
    $('start').onclick=()=>{slot='run';save.run=newRun(pickLevel,save.meta);persist();tab='build';sel='wing';openHangar()};
  }
}

// the title's hero: a little plane with the goat looping on a dashed brass contrail
let titleRaf=0;
function startTitleScene(){
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

/* ================= hangar ================= */
let tab='build', sel='wing', armClear=false, clearTimer=0, armSell=null;
const owned=t=>R().inv[t]||0, usedN=t=>R().cells.filter(x=>keyOf(x)===t).length, left=t=>Math.max(0,owned(t)-usedN(t));
// the palette: the six parts, then any rare variants you own
const palette=()=>[...PALETTE,...Object.keys(RARE).map(k=>k+'+').filter(k=>owned(k)||usedN(k))];
const curWx=()=>weatherOf(R(),R().stage);
const curStats=()=>flightStats(R());
function openHangar(){
  const r=R();if(!r){show('title');renderTitle();return}
  show('hangar');
  if(isOnline(r)){setTab(tab);if(ROOM&&ROOM.phase==='over')showRoomOver();return}
  if(r.phase==='won'){renderHangar();showVictory();return}
  if(r.phase==='over'){renderHangar();showRunOver();return}
  setTab(tab);
}
// tab: 'build' is the barn itself; 'shop' and 'mods' open the dealer drawer over it
const dealer=$('dealer'), dbody=$('dealerBody');
// WIDE (landscape screens, same query as the CSS): the hangar stays the phone layout on the left and the dealer is
// docked on the right, always showing the shop or the mods (side), switched by tabs
const WIDE=matchMedia('(min-width:640px) and (orientation:landscape)');
let side='shop';
// docked, the drawer lives inside the hangar as its right column (CSS grid); otherwise it goes back to overlay the page
function dock(){const wide=WIDE.matches,h=$('hangar');dealer.classList.toggle('docked',wide);
  if(wide&&dealer.parentNode!==h)h.insertBefore(dealer,h.querySelector('.hbar'));else if(!wide&&dealer.parentNode===h)document.body.insertBefore(dealer,h.nextSibling);
  return wide}
function setTab(t){const wide=dock();
  if(wide&&t==='build')t=side;if(t!=='build')side=t;
  tab=t;armSell=null;armAbandon=false;
  const open=t!=='build';
  if(wide){dealer.hidden=$('hangar').hidden;dealer.classList.add('open')}
  else if(open&&dealer.hidden){dealer.hidden=false;requestAnimationFrame(()=>dealer.classList.add('open'))}
  else if(!open&&!dealer.hidden){dealer.classList.remove('open');setTimeout(()=>{if(tab==='build')dealer.hidden=true},260)}
  $('dtShop').setAttribute('aria-pressed',t==='shop');$('dtMods').setAttribute('aria-pressed',t==='mods');
  renderHangar();const r=R();if(!r||r.phase==='won'||r.phase==='over')return;if(r.boonOffer)showBoons();else if(r.packs&&r.packs.length)showPacks()}
$('tShop').onclick=()=>setTab('shop');$('tMods').onclick=()=>setTab('mods');
$('dealerX').onclick=$('dealerScrim').onclick=()=>setTab('build');
$('dtShop').onclick=()=>setTab('shop');$('dtMods').onclick=()=>setTab('mods');
// turning a tablet or resizing the window: re-dock (going narrow closes the drawer)
WIDE.addEventListener('change',()=>{if($('hangar').hidden)return;if(!WIDE.matches){tab='build';dealer.classList.remove('open');dealer.hidden=true}setTab(tab)});
// one small pictogram per storm, drawn in the text colour
const WXI={headwind:'<path d="M3 8h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h7"/>',
  ceiling:'<path d="M7 14.5a4 4 0 0 1 .4-8A5 5 0 0 1 17 8a3.3 3.3 0 0 1 0 6.5z"/><path d="M12.5 15l-2.2 3.6h3L11 22"/>',
  thin:'<path d="M2.5 19l6.5-10 4 6 2.5-3.2L21.5 19z"/><path d="M5 5h.01M10 3.5h.01M17 5.5h.01"/>',
  gusts:'<path d="M3 9c2.5-3.5 5 3.5 7.5 0s5 3.5 7.5 0c1-1.4 2-1.4 3 0M3 15.5c2.5-3.5 5 3.5 7.5 0s5 3.5 7.5 0"/>',
  cargo:'<path d="M3.5 6.5h17v11h-17z"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  ration:'<path d="M7 4h7l4 4v12.5H7z"/><path d="M7 13.5h11"/><path d="M10 7.5h4"/>',
  short:'<path d="M3 19.5l8.5-7M14 10.5l2.5-2"/><path d="M3 19.5h18M6 19.5v-2"/>'};
const wxIcon=id=>WXI[id]?`<svg class="wxi" viewBox="0 0 24 24" aria-hidden="true">${WXI[id]}</svg>`:'';
function wxLine(id,s){return `<div class="wx"><b>${WEATHER[id].name}</b>${WEATHER[id].d(s)}</div>`}
// the season's route: eight towns along a dashed road, storm clouds over stormy towns (all forecast from the start, so
// builds can plan for them), done towns ticked, the plane over the current one
function routeStrip(r){
  if(r.endless)return forecast(r);
  const n=CONTRACTS,W=300,x=i=>14+i*(W-28)/(n-1),y=i=>24+Math.sin(i*1.3)*4;
  let road='';for(let i=0;i<n;i++)road+=(i?'L':'M')+x(i).toFixed(1)+' '+y(i).toFixed(1);
  let h=`<path d="${road}" class="rroad"/>`;
  for(let i=0;i<n;i++){const w=weatherOf(r,i),done=i<r.stage,cur=i===r.stage;
    h+=`<circle cx="${x(i)}" cy="${y(i)}" r="${cur?8:6}" class="rtown${done?' done':''}${cur?' cur':''}${w?' storm':''}"/>`;
    if(done)h+=`<path d="M${x(i)-3} ${y(i)}l2.4 2.6 4.4-5" class="rtick"/>`;
    if(w)h+=`<g class="rcloud" transform="translate(${x(i)} ${y(i)-15})"><title>${WEATHER[w].name}: ${WEATHER[w].d(severity(r,i))}</title><path d="M-8 3a4 4 0 0 1 2-7a5 5 0 0 1 9-1a4 4 0 0 1 5 5a3 3 0 0 1-1 3z"/><path d="M-1 4l-2 5 3-1-1 4" class="rbolt"/></g>`;}
  // tap the route to see what the storms are (phones have no hover)
  const names=[];for(let i=r.stage;i<n;i++){const w=weatherOf(r,i);if(w)names.push(`<b>${i+1}</b> ${wxIcon(w)}${WEATHER[w].name}: ${WEATHER[w].d(severity(r,i))}`)}
  return `<svg class="route" viewBox="0 0 ${W} 40" role="button" tabindex="0" aria-label="Route: contract ${r.stage+1} of ${n}. Tap for the map">${h}</svg>`;
}
// the season's tour map: a painted map with the eight towns (signposts with their names), storm clouds over the stormy
// ones, ticks on the towns done, and the troupe's plane. After a contract is cleared (moving) the plane flies on from
// the last town to the next along a dashed trail; from the route strip it just sits over the current town.
let PLANE='';
function planeURL(){if(PLANE)return PLANE;const c=document.createElement('canvas');c.width=192;c.height=144;const g=c.getContext('2d');
  g.translate(96,88);g.scale(52,52);for(const [t,x,y] of [['wing',0,-1],['frame',-1,0],['cockpit',0,0],['prop',1,0]]){g.save();g.translate(x,y);drawPart(g,t,.4,{lw:.06,mood:'grin',on:true});g.restore()}
  return PLANE=c.toDataURL()}
function showTour(r,moving){
  if(r.endless||r.stage>=CONTRACTS){veil.hidden=true;show('hangar');setTab('build');return}
  const at=r.stage, from=moving?Math.max(0,at-1):at, P=i=>MAP_TOWNS[i];
  let pins='';
  for(let i=0;i<CONTRACTS;i++){const [x,y]=P(i),w=weatherOf(r,i),done=i<at,cur=i===at;
    pins+=`<div class="tpin${done?' done':''}${cur?' cur':''}" style="left:${x}%;top:${y}%"><b>${done?'✓':i+1}</b><span>${townOf(r.seed,i).town}</span>${w?`<em title="${WEATHER[w].name}">${wxIcon(w)}</em>`:''}</div>`}
  const [x0,y0]=P(from),[x1,y1]=P(at);
  // the trail: from the start through every town done to the plane (SVG in the map's 100 x 150 space)
  let trail='';for(let i=0;i<=from;i++){const [x,y]=P(i);trail+=(i?'L':'M')+x+' '+y*1.5}
  const leg=`M${x0} ${y0*1.5}L${x1} ${y1*1.5}`;
  const storms=[];for(let i=at;i<CONTRACTS;i++){const w=weatherOf(r,i);if(w)storms.push(`<span><b>${i+1}</b>${wxIcon(w)}${WEATHER[w].name}: ${WEATHER[w].d(severity(r,i))}</span>`)}
  sheet.className='sheet toursheet';
  sheet.innerHTML=`<div class="tmap" style="--map:url(${MAP})">
      <svg viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true"><path d="${trail}" class="ttrail"/>${moving&&from!==at?`<path d="${leg}" class="tleg" pathLength="1"/>`:''}</svg>
      ${pins}
      <img class="tplane" alt="" src="${planeURL()}" style="left:${x0}%;top:${y0}%">
    </div>
    <div class="tfoot">${storms.length?`<div class="tstorms">${storms.join('')}</div>`:''}
    <button class="big" type="button" id="tourGo">${moving?`To ${townOf(r.seed,at).town}`:'Close'}</button></div>`;
  veil.hidden=false;veil.classList.add('tour');
  const pl=sheet.querySelector('.tplane');
  if(moving&&from!==at){sfx('thermal');const k=reduceMotion()?0:1;
    pl.animate([{left:x0+'%',top:y0+'%'},{left:x1+'%',top:y1+'%'}],{duration:1800*k,delay:500*k,easing:'cubic-bezier(.45,0,.3,1)',fill:'forwards'})
      .finished.then(()=>{if(sheet.contains(pl)){sfx('cheer',{intensity:.5});sheet.querySelector('.tpin.cur')?.classList.add('arrive')}})}
  else{pl.style.left=x1+'%';pl.style.top=y1+'%'}
  $('tourGo').onclick=()=>{veil.classList.remove('tour');sheet.className='sheet';veil.hidden=true;show('hangar');setTab('build')};
}
function forecast(r){const out=[];for(let i=r.stage+1;i<CONTRACTS;i++){const w=weatherOf(r,i);if(w)out.push(`<span title="${WEATHER[w].d(severity(r,i))}"><b>${i+1}</b>${wxIcon(w)}${WEATHER[w].name}</span>`)}
  return out.length?`<div class="fcast">${out.join('')}</div>`:''}
// the show poster: town, which show of the season, the crowd target with a thermometer, ticket stubs for flights left
function renderStrip(){
  const r=R(),q=quotaFor(r.stage,r.level),w=curWx(),t=townOf(r.seed,r.stage);
  if(isOnline(r)){$('cstrip').innerHTML=roomStrip(r);const rt=$('cstrip').querySelector('.route'),pn=$('cstrip').querySelector('.pnext');if(rt&&pn)rt.onclick=()=>{pn.hidden=!pn.hidden};return}
  if(r.mode==='daily'){const stubs=`<span class="fpips" aria-label="${FLIGHTS-r.flight} flights left">${Array.from({length:FLIGHTS},(_,i)=>`<i class="${i<r.flight?'used':''}"></i>`).join('')}</span>`;
    $('cstrip').innerHTML=`<div class="prow"><div class="ptown"><small>${r.ranked?'Daily #'+r.day:'Random puzzle'}</small>${t.town}</div>${stubs}</div><div class="cbar"><i style="transform:scaleX(0)"></i><span>Score ${fmt(r.score)}</span></div>`;return}
  const sub=`Contract ${r.stage+1}${r.endless?' · endless':' of '+CONTRACTS}`;
  const stubs=`<span class="fpips" aria-label="${FLIGHTS-r.flight} flights left">${Array.from({length:FLIGHTS},(_,i)=>`<i class="${i<r.flight?'used':''}"></i>`).join('')}</span>`;
  const storm=w?`<div class="pstorm"><b>${wxIcon(w)}${WEATHER[w].name}</b>${WEATHER[w].d(severity(r,r.stage))}</div>`:'';
  const p=r.phase==='shop'?0:Math.min(1,r.score/q);
  $('cstrip').innerHTML=`<div class="prow"><div class="ptown">${r.phase==='shop'?'<small>Next</small>':''}${t.town}</div>${r.phase==='shop'?'':stubs}</div>
    <div class="cbar"><i style="transform:scaleX(${p})"></i><span>Score ${r.phase==='shop'?'target '+fmt(q):fmt(r.score)+' / '+fmt(q)}</span></div>${storm}${routeStrip(r)}`;
  {const rt=$('cstrip').querySelector('.route');if(rt){rt.onclick=()=>showTour(r,false);rt.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showTour(r,false)}}}}
}
function renderHangar(){
  const r=R();if(!r)return;
  preloadLayers(r.stage); // this town's painted backdrop, so it is ready by launch
  $('hCeil').textContent='Difficulty '+r.level;$('hCeil').hidden=!r.level;
  $('hCoins').textContent=fmt(r.coins);
  $('tShop').classList.toggle('fresh',r.phase==='shop');
  $('tModsL').textContent=`Mods ${r.mods.length}/${modSlots(r)}`;
  $('dtMods').textContent=`Mods ${r.mods.length}/${modSlots(r)}`;$('dtShop').classList.toggle('fresh',r.phase==='shop');
  renderStrip();
  renderBuild();
  dbody.onclick=null;
  if(tab==='shop')renderShop();else if(tab==='mods')renderMods();
  $('launch').textContent=isOnline(r)?readyLabel():r.phase==='shop'?`START CONTRACT ${r.stage+1}`:'LAUNCH!';
  $('launch').classList.toggle('long',$('launch').textContent.length>10); // a smaller size keeps long labels on one line
  $('launch').disabled=isOnline(r)&&(!me()||!me().alive);
}

function renderBuild(){
  const r=R(), st=curStats(), K=makeCraft(r.cells,st);
  const link=linkage(r.cells), conn=link.seen;
  const blockedSet=new Set(K.parts.filter(p=>p.blocked).map(p=>p.gc+','+p.gr));
  const map=new Map(r.cells.map(x=>[x.c+','+x.r,x]));
  let cells='';
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const k=x+','+y,p=map.get(k);
    const cls='cell'+(p?' on':'')+(p&&!conn.has(k)?' loose':'')+(p&&p.type==='cockpit'?' cock':'')+(blockedSet.has(k)?' blocked':'');
    cells+=`<button class="${cls}" data-c="${x}" data-r="${y}" type="button" aria-label="${p?partName(keyOf(p)):'Empty'} at column ${x+1}, row ${y+1}">${p?`<img alt="" src="${cellIcon(p)}">`:''}</button>`}
  const W=K.m*G0*st.grav, n=K.counts;
  const propT=(K.propPow??n.prop)*st.prop*st.rhoMul/W, rockT=n.rocket*st.rocket/W;
  const burn=n.prop*st.propUse;
  const off=K.lift, balF=off==null?0:balanceOf(off);
  const lift=(K.wingLift??n.wing)*st.wing*st.rhoMul*2500*.56*balF/W;
  const bal=(K.balLift??n.balloon)*st.balloon*st.rhoMul/W;
  const ratio=x=>x>0?mul(x)+'× weight':'none';
  const lineOf=x=>x==null?null:Math.abs(x)<=GIMBAL?'in line':`${Math.abs(x).toFixed(2)} m ${x<0?'below':'above'} center`;
  let balTxt='',balCls='';
  if(off!=null){if(off>.1){balTxt='unstable';balCls='warn'}else if(off>=-.7){balTxt='good';balCls='ok'}else{balTxt='nose-heavy';balCls=off<-1.4?'warn':''}}
  const offLine=x=>x!=null&&Math.abs(x)>GIMBAL;
  const jointKey=new Set();for(const j of link.joints){const [dx,dy]=DIRS[j.e];jointKey.add(j.c+','+j.r+','+j.e);jointKey.add((j.c+dx)+','+(j.r+dy)+','+((j.e+2)%4))}
  const EM=[[1,.5],[.5,0],[0,.5],[.5,1]];
  let ov='';
  for(const p of r.cells){const live=conn.has(p.c+','+p.r);for(let e=0;e<4;e++){if(!SOCK[p.type][e])continue;const [ex,ey]=EM[e];const x=p.c+ex,y=p.r+ey;
    if(jointKey.has(p.c+','+p.r+','+e)&&live)ov+=`<ellipse cx="${x}" cy="${y}" rx=".09" ry=".09" class="bolt"/>`;
    else{const hz=e%2===0;ov+=`<rect x="${hz?x-(e===0?.07:0):x-.16}" y="${hz?y-.16:y-(e===3?.07:0)}" width="${hz?.07:.32}" height="${hz?.32:.07}" class="sock"/>`}}}
  // thrust lines: each engine's push runs along its row; it should pass through the mass marker
  for(const p of K.parts){if((p.type!=='prop'&&p.type!=='rocket')||p.blocked)continue;const y=p.gr+.5,bad=offLine(p.type==='prop'?K.propLine:K.rocketLine);
    ov+=`<line x1="0" y1="${y}" x2="7" y2="${y}" stroke="${bad?'#ff6b5b':'rgba(233,241,247,.28)'}" stroke-width=".05" stroke-dasharray=".14 .12"/>`}
  if(K.parts.length){const cx=K.com.x,cy=K.com.y;
    if(off!=null)ov+=`<g class="col"><line x1="${cx+off}" y1="${cy-.55}" x2="${cx+off}" y2="${cy+.1}"/><path d="M${cx+off-.14} ${cy-.4}L${cx+off} ${cy-.62}L${cx+off+.14} ${cy-.4}Z"/></g>`;
    ov+=`<g class="com"><ellipse cx="${cx}" cy="${cy}" rx=".17" ry=".17" class="c0"/><path d="M${cx} ${cy}L${cx+.17} ${cy}A.17 .17 0 0 1 ${cx} ${cy+.17}Z M${cx} ${cy}L${cx-.17} ${cy}A.17 .17 0 0 1 ${cx} ${cy-.17}Z" class="c1"/></g>`}
  const w=curWx();
  const warns=[];if(K.loose)warns.push(plural(K.loose,'loose part'));if(K.blocked)warns.push(K.blocked+' blocked engine'+(K.blocked>1?'s':''));
  if(offLine(K.propLine))warns.push('propeller off-center');if(offLine(K.rocketLine))warns.push('rocket off-center');
  const rows=[['Mass',mul(K.m)+' t','']];
  if(off!=null)rows.push(['Balance',balTxt,balCls]);
  if(n.prop)rows.push(['Thrust',ratio(propT),propT>.25?'ok':'']);
  if(n.rocket)rows.push(['Boost',ratio(rockT),'']);
  rows.push(['Fuel',mul(K.fuelMax)+(burn?` \u00b7 ${mul(K.fuelMax/burn)} s`:''),'']);
  if(n.wing)rows.push(['Lift',ratio(lift),lift>=1?'ok':'']);
  if(n.balloon)rows.push(['Balloons',ratio(bal),'']);
  bench.innerHTML=`
  <div class="card">
    <div class="row"><span class="label">Build</span><button class="ghost${armClear?' armed':''}" id="clear" type="button" ${r.cells.length<=1?'disabled':''}>${armClear?'Tap again':'Clear'}</button></div>
    <div class="grid" id="grid">${cells}<svg class="ov" viewBox="0 0 7 5" preserveAspectRatio="none" aria-hidden="true">${ov}</svg></div>
    <div class="legend"><span><i class="lg-com"></i>Mass</span><span><i class="lg-col"></i>Lift</span><span style="margin-left:auto">Nose \u2192</span></div>
    <div class="pal" id="pal">${palette().map(t=>`<button type="button" data-t="${t}" aria-pressed="${t===sel}"${isRare(t)?' class="rare"':''}><img alt="" src="${ICON[t]}"><span>${partName(t)}</span><small class="${left(t)?'':'none'}">${left(t)}/${owned(t)}</small></button>`).join('')}</div>
    <div class="blurb" id="blurb">${warns.length?`<span class="warn">${warns.join(' \u00b7 ')}</span>`:''}</div>
  </div>
  <div class="card">
    <span class="label">Craft</span>
    <dl class="stats">${rows.map(([a,b,c])=>`<dt>${a}</dt><dd class="${c}">${b}</dd>`).join('')}</dl>
  </div>`;
  $('grid').onclick=e=>{if(skipClick){skipClick=false;return}const b=e.target.closest('.cell');if(b)placeAt(+b.dataset.c,+b.dataset.r)};
  bindDrag($('grid'));
  $('pal').onclick=e=>{const b=e.target.closest('button');if(b){sel=b.dataset.t;armClear=false;renderBuild()}};
  if(isRare(sel)&&!warns.length)$('blurb').innerHTML=`<span class="rarenote">${partName(sel)}: ${RARE[baseOf(sel)].d}</span>`;
  $('clear').onclick=()=>{if(!armClear){armClear=true;renderBuild();clearTimeout(clearTimer);clearTimer=setTimeout(()=>{armClear=false;if(R())renderBuild()},3000);return}
    armClear=false;r.cells=r.cells.filter(x=>x.type==='cockpit');persist();renderBuild()};
}
// press and hold a part to pick it up; drop it on another square to move it there (swapping with whatever is there)
let drag=null,skipClick=false;
const cellAt=(x,y)=>{const el=document.elementFromPoint(x,y);return el&&el.closest?el.closest('#grid .cell'):null};
function bindDrag(G){
  G.onpointerdown=e=>{const b=e.target.closest('.cell');if(!b)return;const c=+b.dataset.c,r=+b.dataset.r;
    if(c===COCKPIT.c&&r===COCKPIT.r)return;const p=R().cells.find(x=>x.c===c&&x.r===r);if(!p)return;
    clearTimeout(drag&&drag.timer);
    drag={c,r,type:p.type,x0:e.clientX,y0:e.clientY,on:false,id:e.pointerId,timer:setTimeout(()=>{if(!drag)return;drag.on=true;
      b.classList.add('lift');const g=document.createElement('img');g.className='ghost-part';g.src=cellIcon(p);g.style.left=drag.x+'px';g.style.top=drag.y+'px';document.body.appendChild(g);drag.ghost=g;
      try{navigator.vibrate&&navigator.vibrate(12)}catch(_){}},280),x:e.clientX,y:e.clientY}};
  G.onpointermove=e=>{if(!drag)return;drag.x=e.clientX;drag.y=e.clientY;
    if(!drag.on){if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)>10){clearTimeout(drag.timer);drag=null}return}
    drag.ghost.style.left=e.clientX+'px';drag.ghost.style.top=e.clientY+'px';
    G.querySelectorAll('.cell.drop').forEach(x=>x.classList.remove('drop'));const t=cellAt(e.clientX,e.clientY);if(t)t.classList.add('drop')};
  const end=e=>{if(!drag)return;clearTimeout(drag.timer);const d=drag;drag=null;if(!d.on)return;
    skipClick=true;setTimeout(()=>{skipClick=false},400);d.ghost&&d.ghost.remove();
    const t=e.type==='pointerup'?cellAt(e.clientX,e.clientY):null;if(t)moveCell(d.c,d.r,+t.dataset.c,+t.dataset.r);else renderBuild()};
  G.onpointerup=end;G.onpointercancel=end;
  G.addEventListener('touchmove',e=>{if(drag&&drag.on)e.preventDefault()},{passive:false});
  G.addEventListener('contextmenu',e=>e.preventDefault());
}
function moveCell(c1,r1,c2,r2){const r=R();
  if((c2===COCKPIT.c&&r2===COCKPIT.r)||(c1===c2&&r1===r2)){renderBuild();return}
  const a=r.cells.find(x=>x.c===c1&&x.r===r1),b=r.cells.find(x=>x.c===c2&&x.r===r2);if(!a){renderBuild();return}
  a.c=c2;a.r=r2;if(b){b.c=c1;b.r=r1}persist();renderBuild()}
function placeAt(c,y){
  const r=R();
  if(c===COCKPIT.c&&y===COCKPIT.r)return;
  const i=r.cells.findIndex(x=>x.c===c&&x.r===y),type=baseOf(sel),rare=isRare(sel);
  if(i>=0&&keyOf(r.cells[i])===sel)r.cells.splice(i,1);
  else if(left(sel)<=0){$('blurb').innerHTML=`<span class="warn">No ${partName(sel)}${/s$/.test(partName(sel))?'':'s'} left</span>`;return}
  else if(i>=0){r.cells[i].type=type;if(rare)r.cells[i].rare=1;else delete r.cells[i].rare}
  else r.cells.push(rare?{c,r:y,type,rare:1}:{c,r:y,type});
  persist();renderBuild();
}

// L: the level shown (description and pips); up: shown as an upgrade offer
const pips=L=>`<span class="lvp" aria-label="Level ${L} of ${MODMAX}">${Array.from({length:MODMAX},(_,i)=>`<i class="${i<L?'on':''}"></i>`).join('')}</span>`;
function modCard(id,btn,L,up){const M=MODS[id];L=L||1;return `<div class="offer ${M.r}">${DECAL?`<img class="decal" alt="" src="${DECAL(id,96,L)}">`:`<div class="glyph ${M.r}" aria-hidden="true">${M.name[0]}</div>`}<div><span class="rar r-${M.r}">${up?'<b class="upg">Upgrade</b> · ':''}${RARITY[M.r].name} · ${M.tag}</span><h3>${M.name} ${pips(L)}<button class="qm" type="button" data-lib="${id}" aria-label="How ${M.name} works">?</button></h3><p>${modDesc(id,L)}</p></div>${btn}</div>`}
function renderShop(){
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
function buy(kind,i){
  const r=R(),S=r.shop;const o=kind==='pack'?S.pack:S[kind==='part'?'parts':kind==='tune'?'tunes':'mods'][i];if(!o)return;
  if(applyPurchase(r,kind,o)){sfx('buy');buzz(12);persist();if(kind==='pack'){setTab('build');showPacks()}else renderHangar()}else sfx('error')
}
function renderMods(){
  const r=R();
  const lv=modLevels(r);
  const slots=Array.from({length:modSlots(r)},(_,i)=>{const id=r.mods[i];if(!id)return `<div class="slot">Empty</div>`;const v=sellValue(id,lv[id]);
    return modCard(id,`<button class="buy sell${armSell===id?' armed':''}" type="button" data-sell="${id}">${armSell===id?'Sell?':'Sell +'+v}</button>`,lv[id])}).join('');
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
  <div class="card stack"><button class="ghost" id="libOpen" type="button">Mods library</button><button class="ghost${armAbandon?' armed':''}" id="aband2" type="button">${armAbandon?'Tap again':slot==='online'?'Leave room':slot==='daily'?'End puzzle':'Abandon run'}</button></div>`;
  dbody.onclick=e=>{
    const q=e.target.closest('[data-lib]');if(q){openLibrary(q.dataset.lib);return}
    if(e.target.closest('#libOpen')){openLibrary();return}
    const b=e.target.closest('[data-sell]');
    if(b){const id=b.dataset.sell;if(armSell!==id){armSell=id;renderMods();return}armSell=null;sfx('sell');sellMod(r,id);persist();renderHangar();return}
    if(e.target.closest('#aband2')){if(!armAbandon){armAbandon=true;renderMods();return}endRun()}
  };
}
$('launch').onclick=()=>{const r=R();if(!r)return;
  if(isOnline(r)){toggleReady();return}
  if(r.phase==='shop'){r.phase='contract';persist();setTab('build');return}
  if(r.phase==='contract')startFlight()};

initGuide(ICON,()=>{if(!save.meta.guideSeen){save.meta.guideSeen=true;persist();if(!$('title').hidden)renderTitle()}});
$('hHelp').onclick=openGuide;

/* ================= mods library ================= */
// every mod with its values at each level and one plain line on how to trigger it, plus the tricks the score mods refer to
const TRICKS=[['Loop','Turn a full circle in the air (hold NOSE UP over the top).','+0.5'],['Low pass','Fly under 4 m fast for a second, then climb above 8 m.','+0.25'],
  ['Thermal','Fly through a rising air column.','+0.1'],['Coin','Fly through a gold coin.','+0.05'],['Touchdown','Land and roll to a stop without crashing.','+0.5'],
  ['Altitude','Reach 100, 250, 500, 750, 1000 m … Land afterwards and each height adds to the distance score (a landing bonus).','+200 … +1000'],['Redline','Reach 500 km/h.','+1'],['Cloud nine','Climb to 5 km.','+2']];
const lib=$('library');let libTag='All';
function descAll(id){const M=MODS[id],j=a=>a.map(x=>String(Math.round(x*100)/100)).join(' / ');
  return M.d.replace('{v%}',M.v?M.v.map(x=>Math.round(x*100)).join(' / ')+'%':'').replace('{v}',M.v?j(M.v):'').replace('{w}',M.w?j(M.w):'')}
function renderLibrary(focus){
  const r=save[slot],lv=r?modLevels(r):{},meta=r?metaOf(r):save.meta;
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
function openLibrary(focus){
  if(focus)libTag='All';renderLibrary(focus);
  lib.hidden=false;requestAnimationFrame(()=>lib.classList.add('open'));
}
function closeLibrary(){lib.classList.remove('open');setTimeout(()=>{lib.hidden=true},260)}
$('libX').onclick=$('libScrim').onclick=closeLibrary;
$('libBody').onclick=e=>{const b=e.target.closest('.libtags button');if(b){libTag=b.dataset.t;renderLibrary()}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!lib.hidden)closeLibrary()});

/* ================= storm rewards ================= */
// after a cleared storm contract: pick 1 of 2 (rolled in sim and saved, so a reload shows the same pair)
const BOON_ICON={slot:'+',coins:'¢',upgrade:'↑',drag:'≋',grav:'↥',fuel:'▮',thermal:'≈',pass:'_',loop:'∞',coin:'●',land:'⌒'};
function showBoons(){
  const r=R();if(!r||!r.boonOffer)return;
  sheet.innerHTML=`<span class="label">Storm cleared</span><h2>Storm reward</h2>
    <div class="boons">${r.boonOffer.map((o,i)=>`<button class="boon" type="button" data-i="${i}" style="--i:${i}"><span class="bow" aria-hidden="true"></span><span class="bi" aria-hidden="true">${o.mod?`<img alt="" src="${decalURL(o.mod,64)}">`:BOON_ICON[o.id]||'★'}</span><b>${BOONS[o.id].name}</b><small>${boonDesc(o)}</small></button>`).join('')}</div>`;
  veil.hidden=false;
  sheet.querySelectorAll('.boon').forEach(b=>b.onclick=()=>{
    if(!pickBoon(r,+b.dataset.i))return;persist();sfx('gift');buzz(20);
    b.classList.add('picked');sheet.querySelectorAll('.boon').forEach(x=>{if(x!==b)x.classList.add('gone')});
    setTimeout(()=>{veil.hidden=true;setTab(tab)},reduceMotion()?0:420)});
}

/* ================= parts packs ================= */
// every contract starts with packs to open: shake, tear the top off, burst, the part pops out and flies to the tray
const BIG={};
function bigIcon(t){if(!BIG[t]){const c=document.createElement('canvas');c.width=c.height=240;const g=c.getContext('2d');g.translate(120,120);g.scale(210,210);drawPart(g,t,.33,{frac:1,lw:.035});BIG[t]=c.toDataURL()}return BIG[t]}
const isEngine=t=>t==='prop'||t==='rocket'||isRare(t); // gold rays for engines and every rare part
// the packet is two copies of one face: the cap above a jagged tear line and the body below it, so it looks whole until torn
const PW=178,PH=164,CAP=34,TEAR=3;
const zig=(n,y0,y1)=>Array.from({length:n+1},(_,i)=>`${PW*i/n}px ${i%2?y1:y0}px`);
const CLIP_CAP=`polygon(${[...zig(2,0,0),...zig(10,CAP,CAP+TEAR).reverse()].join(',')})`;
const CLIP_BODY=`polygon(${[...zig(10,CAP,CAP+TEAR),...zig(2,PH,PH).reverse()].join(',')})`;
// a parcel in kraft paper tied with string, closed with a red wax seal stamped with the goat; a rare part comes in
// purple paper with brass corners (packs are rolled when granted, so the wrapping can show it)
const SEAL='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 7.5C6.5 5 6.8 2.6 8.6 2.4c1 0 1.2 1.6 1.1 3.6M15.8 7.5c1.7-2.5 1.4-4.9-.4-5.1-1 0-1.2 1.6-1.1 3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M4.6 9.6l3.5.7M19.4 9.6l-3.5.7" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><path d="M7.8 8.3h8.4l-1 7.6c-.5 3.1-5.9 3.1-6.4 0z" fill="currentColor"/><path d="M10.4 18.6l1.6 3 1.6-3z" fill="currentColor"/></svg>';
const FACE=rare=>`<div class="pk-face${rare?' rare':''}"><i class="pk-str v"></i><i class="pk-str h"></i><div class="pk-seal">${SEAL}</div><div class="pk-sheen"></div></div>`;
const packLayers=rare=>`<div class="pk-layer pk-cap" style="clip-path:${CLIP_CAP};-webkit-clip-path:${CLIP_CAP}">${FACE(rare)}</div><div class="pk-layer pk-body" style="clip-path:${CLIP_BODY};-webkit-clip-path:${CLIP_BODY}">${FACE(rare)}</div>`;
let PK=null;
const pkStage=$('pkStage'), pkTray=$('pkTray');
const ms=t=>reduceMotion()?1:t;
const anim=(el,kf,o)=>el.animate(kf,{fill:'both',...o,duration:ms(o.duration),delay:ms(o.delay||0)});
function showPacks(){
  const r=R();if(PK||!r||!r.packs||!r.packs.length)return;
  PK={got:[],busy:false,state:'pack'};
  $('pkLabel').textContent=`Packs · ${townOf(r.seed,r.stage).town}`;
  pkTray.innerHTML=r.packs.map(()=>'<i></i>').join('');
  $('pkDone').hidden=true;$('pkSkip').hidden=false;pkTray.hidden=false;$('packs').hidden=false;
  dealPack();
}
function dealPack(){
  const P=R().packs,left=P.length;
  pkStage.className='pk-stage';
  pkStage.innerHTML=`<div class="pk-rays"><i></i></div><div class="pk-glow"></div>
    <div class="pk-pile">${Array.from({length:Math.min(2,left-1)},(_,i)=>`<div class="pk-back">${packLayers(isRare(P[i+1]))}</div>`).join('')}<button class="pack" type="button" aria-label="${isRare(P[0])?'Open rare pack':'Open pack'}">${packLayers(isRare(P[0]))}</button></div>
    <div class="pk-reveal" hidden><img alt=""><h3></h3><small></small></div>
    <span class="pk-hint">TAP</span><div class="pk-flash"></div>`;
  anim(pkStage.querySelector('.pk-pile'),[{transform:'translateY(-60px) scale(.8)',opacity:0},{transform:'none',opacity:1}],{duration:420,easing:'cubic-bezier(.2,1.5,.4,1)'});
  PK.state='pack';
}
function sparks(gold){
  const cols=gold?['#ffb020','#ffc23d','#fff1c2','#ff8a2a']:['#7fd3ff','#e9f1f7','#ffb020','#8fdcff'];
  for(let i=0;i<26;i++){const s=document.createElement('i');s.className='pk-spark';s.style.background=cols[i%cols.length];if(i%3===0)s.style.borderRadius='50%';
    pkStage.appendChild(s);const a=Math.random()*Math.PI*2,d=90+Math.random()*150,sz=.6+Math.random()*1.2;
    s.animate([{transform:`translate(0,0) scale(${sz})`,opacity:1},{transform:`translate(${Math.cos(a)*d}px,${Math.sin(a)*d+40}px) scale(0) rotate(${Math.random()*540}deg)`,opacity:0}],
      {duration:700+Math.random()*400,easing:'cubic-bezier(.1,.8,.3,1)',fill:'forwards'}).finished.then(()=>s.remove())}
}
async function tearPack(){
  if(PK.busy)return;PK.busy=true;
  const q=s=>pkStage.querySelector(s), pack=q('.pack');
  pack.style.animation='none';q('.pk-hint').hidden=true;sfx('crateShake');
  if(!reduceMotion())await pack.animate([{transform:'none'},{transform:'rotate(-3deg) translateX(-3px)'},{transform:'rotate(3deg) translateX(3px)'},{transform:'rotate(-5deg) translateX(-4px)'},
    {transform:'rotate(6deg) translateX(5px)'},{transform:'rotate(-8deg) translateX(-6px) scale(1.04)'},{transform:'rotate(8deg) translateX(6px) scale(1.06)'},{transform:'scale(1.08)'}],{duration:560,easing:'ease-in'}).finished;
  const r=R(),t=openPack(r);persist();PK.got.push(t);sfx('crateOpen');setTimeout(()=>sfx('reveal'),ms(260));
  const gold=isEngine(t);pkStage.classList.toggle('gold',gold);
  try{navigator.vibrate&&navigator.vibrate([20,40,30])}catch(_){}
  anim(pack.querySelector('.pk-cap'),[{transform:'scale(1.08)',opacity:1},{transform:'translate(70px,-190px) rotate(42deg)',opacity:0}],{duration:650,easing:'cubic-bezier(.2,.7,.3,1)'});
  anim(pack.querySelector('.pk-body'),[{transform:'scale(1.08)',opacity:1},{transform:'translateY(230px) rotate(-8deg)',opacity:0}],{duration:560,delay:130,easing:'cubic-bezier(.5,0,.8,.4)'});
  pkStage.querySelectorAll('.pk-back').forEach((b,i)=>anim(b,[{opacity:1},{opacity:0,transform:`translate(${i?40:-40}px,30px) rotate(${i?14:-14}deg)`}],{duration:300}));
  q('.pk-flash').animate([{opacity:0},{opacity:.9,offset:.15},{opacity:0}],{duration:ms(560)});
  anim(q('.pk-rays'),[{opacity:0,transform:'scale(.3)'},{opacity:1,transform:'scale(1)'}],{duration:600,easing:'cubic-bezier(.2,1.2,.4,1)'});
  anim(q('.pk-glow'),[{opacity:0,transform:'scale(.4)'},{opacity:1,transform:'scale(1)'}],{duration:500});
  if(!reduceMotion())sparks(gold);
  const rv=q('.pk-reveal'),img=rv.querySelector('img');
  img.src=bigIcon(t);rv.querySelector('h3').textContent=partName(t);rv.querySelector('small').textContent='×'+r.inv[t];rv.hidden=false;
  anim(rv.querySelector('h3'),[{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],{duration:300,delay:520});
  anim(rv.querySelector('small'),[{opacity:0},{opacity:1}],{duration:300,delay:640});
  await anim(img,[{transform:'translateY(70px) scale(.15) rotate(-30deg)',opacity:0},{transform:'translateY(-18px) scale(1.2) rotate(8deg)',opacity:1,offset:.6},{transform:'none',opacity:1}],
    {duration:760,delay:120,easing:'ease-out'}).finished;
  PK.state='reveal';PK.busy=false;
}
function fillSlot(i,t){const s=pkTray.children[i];if(!s)return;s.className='on'+(isEngine(t)?' gold':'');s.innerHTML=`<img alt="${partName(t)}" src="${ICON[t]}">`;
  s.animate([{transform:'scale(.4)'},{transform:'scale(1.25)'},{transform:'none'}],{duration:ms(320),easing:'ease-out'})}
async function collect(){
  if(PK.busy)return;PK.busy=true;
  const i=PK.got.length-1,t=PK.got[i],img=pkStage.querySelector('.pk-reveal img'),slot=pkTray.children[i];
  if(img&&slot){const a=img.getBoundingClientRect(),b=slot.getBoundingClientRect();
    pkStage.querySelectorAll('.pk-reveal h3,.pk-reveal small,.pk-rays,.pk-glow').forEach(el=>anim(el,[{opacity:1},{opacity:0}],{duration:220}));
    await anim(img,[{transform:'none'},{transform:`translate(${b.left+b.width/2-a.left-a.width/2}px,${b.top+b.height/2-a.top-a.height/2}px) scale(${44/a.width}) rotate(360deg)`}],{duration:460,easing:'cubic-bezier(.5,0,.3,1)'}).finished}
  fillSlot(i,t);PK.busy=false;
  if(R().packs.length)dealPack();else finishPacks();
}
// the haul: this batch grouped by part, popping in one after another
function finishPacks(){
  PK.state='done';$('pkSkip').hidden=true;$('pkDone').hidden=false;pkTray.hidden=true;
  const n={};for(const t of PK.got)n[t]=(n[t]||0)+1;
  pkStage.className='pk-stage';
  pkStage.innerHTML=`<div class="pk-sum">${Object.entries(n).map(([t,k])=>`<div class="${isEngine(t)?'gold':''}"><img alt="" src="${bigIcon(t)}"><b>${partName(t)}</b><small>+${k}</small></div>`).join('')}</div>`;
  pkStage.querySelectorAll('.pk-sum>div').forEach((el,i)=>anim(el,[{opacity:0,transform:'scale(.5) translateY(20px)'},{opacity:1,transform:'scale(1.1)',offset:.7},{opacity:1,transform:'none'}],{duration:420,delay:80+i*110,easing:'ease-out'}));
}
function openAll(){
  if(!PK||PK.busy||PK.state==='done')return;
  const r=R();
  while(r.packs.length)PK.got.push(openPack(r));
  persist();finishPacks();
}
pkStage.onclick=()=>{if(!PK)return;if(PK.state==='pack')tearPack();else if(PK.state==='reveal')collect()};
$('pkSkip').onclick=openAll;
$('pkDone').onclick=()=>{$('packs').hidden=true;PK=null;renderHangar()};

/* ================= flight ================= */
const cv=$('cv'), ctx=cv.getContext('2d');
let F=null, dpr=1, vw=0, vh=0, raf=0, last=0, RES=0;
const ctl={pitch:0,boost:false,throttle:1};
function resize(){const r=cv.getBoundingClientRect();vw=r.width;vh=r.height;dpr=Math.min(window.devicePixelRatio||1,2);cv.width=Math.round(vw*dpr);cv.height=Math.round(vh*dpr);
  RES=reserveTop()}
// --reserve is env(safe-area-inset-top), which getPropertyValue cannot resolve, so measure it with a probe
function reserveTop(){const p=document.createElement('div');p.style.cssText='position:fixed;top:0;height:0;visibility:hidden;padding-top:var(--reserve)';document.body.appendChild(p);const v=parseFloat(getComputedStyle(p).paddingTop)||0;p.remove();return v}
window.addEventListener('resize',()=>{if(F)resize()});
function hold(id,on,off){const b=$(id);
  const dn=e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId)}catch(_){}b.classList.add('held');on()};
  const up=()=>{b.classList.remove('held');off()};
  b.addEventListener('pointerdown',dn);['pointerup','pointercancel','lostpointercapture'].forEach(t=>b.addEventListener(t,up));
  b.addEventListener('contextmenu',e=>e.preventDefault());}
hold('bUp',()=>ctl.pitch=1,()=>{if(ctl.pitch===1)ctl.pitch=0});
hold('bDown',()=>ctl.pitch=-1,()=>{if(ctl.pitch===-1)ctl.pitch=0});
// throttle: one slider for every engine
function setThr(v){ctl.throttle=clamp(Math.round(v*100)/100,0,1);const p=Math.round(ctl.throttle*100);
  $('thrFill').style.height=p+'%';$('thrKnob').style.bottom=`calc(${p}% - ${p*.06}px)`;$('thrVal').textContent=p+'%';$('thr').setAttribute('aria-valuenow',p);if(F)F.idle=0}
{const T=$('thr');const at=e=>{const r=T.getBoundingClientRect();setThr(1-(e.clientY-r.top-6)/(r.height-12))};
  T.addEventListener('pointerdown',e=>{e.preventDefault();try{T.setPointerCapture(e.pointerId)}catch(_){}T.dragging=true;at(e)});
  T.addEventListener('pointermove',e=>{if(T.dragging)at(e)});
  ['pointerup','pointercancel','lostpointercapture'].forEach(t=>T.addEventListener(t,()=>{T.dragging=false}));
  T.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowRight'){setThr(ctl.throttle+.1);e.preventDefault()}if(e.key==='ArrowDown'||e.key==='ArrowLeft'){setThr(ctl.throttle-.1);e.preventDefault()}})}
// fast-forward: one tap on, one tap off; remembered between flights so players can simply leave it on
const FF_SPEED=2, FF_PITCH=.5, ffOn=()=>!!(save.meta.ff&&F&&!F.online);
function syncFF(){const b=$('bFF');b.classList.toggle('on',!!save.meta.ff);b.setAttribute('aria-pressed',String(!!save.meta.ff));b.style.visibility=F&&F.online?'hidden':'visible'}
$('bFF').addEventListener('click',()=>{save.meta.ff=!save.meta.ff;persist();syncFF();buzz(10)});
hold('bPop',()=>{if(F&&!F.S.burst&&F.K.counts.balloon){F.S.burst=true;F.S.events.push('burst')}},()=>{});
const keys={};
// keyboard (desktop, itch): arrows or W/S pitch, left/right or A/D throttle, Space pops balloons, F fast-forward.
// The throttle slider handles its own arrows while it has focus, so those are skipped here.
window.addEventListener('keydown',e=>{if(!F||e.metaKey||e.ctrlKey||e.altKey)return;keys[e.key]=1;sync(e);if(e.repeat&&e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
  const k=e.key.length===1?e.key.toLowerCase():e.key,onThr=document.activeElement===$('thr');
  if(!onThr&&(k==='ArrowRight'||k==='d')){setThr(ctl.throttle+.1);e.preventDefault()}
  else if(!onThr&&(k==='ArrowLeft'||k==='a')){setThr(ctl.throttle-.1);e.preventDefault()}
  else if(k===' '&&$('bPop').style.visibility!=='hidden'&&!F.S.burst&&F.K.counts.balloon){F.S.burst=true;F.S.events.push('burst')}
  else if(k==='f'&&!F.online)$('bFF').click()});
window.addEventListener('keyup',e=>{keys[e.key]=0;sync(e)});
function sync(e){if(!F)return;const up=keys.ArrowUp||keys.w||keys.W,dn=keys.ArrowDown||keys.s||keys.S;ctl.pitch=up?1:dn?-1:0;if(e&&[' ','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault()}

// o.online: a live room flight (no fast-forward, ghosts, spectating); o.watch: only watching (out of an elimination)
function startFlight(o={}){
  const r=R(),w=curWx(),st=curStats(),K=makeCraft(r.cells,st);
  F={st,K,S:newFlight(K,st),ts:1,online:!!o.online,watch:!!o.watch,flyCoins:[],pre:reduceMotion()?.3:1.1,stretch:0,debris:null,chute:null,idle:0,wx:w,cam:{x:0,y:20,sc:20},trail:[],parts:[],toasts:[],toastT:0,boom:-1,ended:false,coinFlash:0,endT:0,
    ctx:flightCtx(r),quota:r.mode==='daily'||o.online?null:quotaFor(r.stage,r.level),already:r.score,bestDist:r.bestDist||0};
  $('flight').classList.remove('watching');$('fSpec').hidden=true;
  ctl.pitch=0;ctl.boost=false;
  show('flight');setThr(1);$('thr').style.visibility=(K.counts.rocket||K.counts.prop)?'visible':'hidden';$('bPop').style.visibility=K.counts.balloon?'visible':'hidden';
  $('toast').innerHTML='';$('toast').style.opacity=0;syncFF();
  const fw=$('fWx');fw.hidden=!w;if(w)fw.innerHTML=wxIcon(w)+'Storm · '+WEATHER[w].name;
  resize();F.cam.sc=vh/40;
  try{navigator.wakeLock&&navigator.wakeLock.request('screen').catch(()=>{})}catch(_){}
  sfx('creak',{amount:1});
  last=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
}
const lerp=(a,b,t)=>a+(b-a)*t;
function mixHex(a,b,t){const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('')}
function toast(title,sub){F.toasts.push({title,sub});if(F.toasts.length>4)F.toasts.shift()}
function frame(now){
  if(!F)return;
  const dt=clamp((now-last)/1000,0,.05);last=now; // a frame stamped before startFlight's clock reading would run time backwards
  const {S,st}=F, lv=F.ctx.lv, has=k=>!!lv[k], mv=(k,key)=>modVal(lv,k,key);
  // what the n-th repeat of a trick adds, after the diminishing returns in scoreFlight
  const nth=(n,per)=>`+${num((repeats(n)-repeats(n-1))*per)} mult`;
  // the wind-up: the plane sits pulled back on the ramp, then the catapult fires
  if(F.pre>0){F.pre-=dt;if(F.pre<=0){F.stretch=1;F.cheer=1;sfx('launch');sfx('cheer',{intensity:.7});buzz(30);if(F.online){elT.style.opacity=0}}
    else if(F.online&&F.pre0>1.2){const c=Math.ceil(F.pre);if(c!==F.cd){F.cd=c;elT.innerHTML=c;elT.style.opacity=1;sfx('tap')}}
    updParts(dt);draw(now);hud(0);raf=requestAnimationFrame(frame);return}
  // a room flight goes on after I'm down: the bots keep flying and the camera follows the others
  if(F.online&&S.done){F.acc=(F.acc||0)+dt;const n=Math.min(600,Math.floor(F.acc/SIM_DT));F.acc-=n*SIM_DT;stepBots(n);F.specT=(F.specT||0)-dt;if(F.specT<=0){F.specT=.5;updSpec()}}
  F.stretch=Math.max(0,F.stretch-dt*5);
  if(F.debris)updDebris(dt);
  if(!S.done){
    // fast-forward is the player's toggle (2x, off in live rooms); the nose buttons are gentler while it is on, so
    // the craft turns about as fast on screen as at normal speed
    const ff=ffOn();F.ts=ff?FF_SPEED:1;
    const c=ff&&ctl.pitch?{...ctl,pitch:ctl.pitch*FF_PITCH}:ctl;
    // fixed physics steps (SIM_DT) fed from an accumulator, so the same inputs give the same flight at any frame rate
    const ts=F.ts;F.acc=(F.acc||0)+dt*ts;
    let n=Math.min(600,Math.floor(F.acc/SIM_DT));F.acc-=n*SIM_DT;if(n===600)F.acc=0;
    for(let i=0;i<n&&!S.done;i++){F.ticks=(F.ticks||0)+1;step(S,F.K,st,SIM_DT,c);
      if(S.burst&&!S.popped){const c=Math.cos(S.th),s=Math.sin(S.th);
        for(const p of F.K.parts)if(p.type==='balloon')for(let j=0;j<10;j++)F.parts.push({x:S.x+p.lx*c-p.ly*s,y:S.y+p.lx*s+p.ly*c,vx:S.vx*.5+(Math.random()-.5)*16,vy:S.vy*.5+(Math.random()-.5)*16,life:.8,r:.18,k:'pop'});
        F.K=popBalloons(S,F.K,st)}}
    if(F.online){stepBots(n);sendPos(dt)}
    for(const e of S.events){
      if(e==='coin'){F.coinStreak=(F.coinT>0?(F.coinStreak||0)+1:0);F.coinT=1.2;sfx('coin',{pitch:Math.pow(2,Math.min(12,F.coinStreak)/12)});F.coinFlash=1;for(let j=0;j<8;j++){const a=j/8*6.283;F.parts.push({x:S.x,y:S.y,vx:Math.cos(a)*7+S.vx*.6,vy:Math.sin(a)*7+S.vy*.6,life:.7,r:.22,k:'gold'})}}
      else if(e==='bounce')dust(S.x,S.y-1,8);
      else if(e==='loop')F.loopT=performance.now()/1000,F.cheer=1,sfx('loop'),sfx('cheer',{intensity:.5}),toast('Loop',nth(S.loops,has('stunt')?mv('stunt'):.5));
      else if(e==='pass')F.cheer=1,sfx('pass'),toast('Low pass',nth(S.passes,has('duster')?mv('duster'):.25));
      else if(e==='thermal')F.cheer=.6,sfx('thermal'),toast('Thermal',`+${num(has('thermal')?mv('thermal','w'):.1)} mult`);
      else if(e==='burst')sfx('pop'),toast('Balloons burst','');
      else if(e==='Redline'){F.boom=0;F.cheer=1;sfx('redline');sfx('cheer',{intensity:.9});buzz(40);toast('Redline',has('sonic')?`×${num(mv('sonic'))} score`:'+1 mult')}
      else if(e==='Cloud nine')F.cheer=1,sfx('cheer',{intensity:.9}),toast('Cloud nine',has('escape')?`×${num(mv('escape'))} score`:'+2 mult');
      else if(e==='Downdraft!')toast('Downdraft','The storm pushes you down');
      else if(e==='altitude'){const y=altReached(S.y);F.cheer=.7;sfx('pass');toast(`${y} m`,`+${fmt(altBonus(S.y))} landing bonus`)}
      else if(e==='touchgo'){if(has('touchgo'))F.cheer=.8,sfx('pass'),toast('Touch and go',nth(S.touchgos,mv('touchgo')))}
      else if(e==='combo'){if(has('showboat'))F.cheer=1,sfx('cheer',{intensity:.5}),toast('Combo',nth(S.combos,mv('showboat')))}
      else toast(e,'');
    }
    S.events.length=0;
    if(S.coinFx&&S.coinFx.length){for(const c of S.coinFx)F.flyCoins.push({x:c.x,y:c.y,t:0});S.coinFx.length=0}
    for(const c of F.flyCoins)c.t+=dt;F.flyCoins=F.flyCoins.filter(c=>c.t<.28);
    if(!F.trail.length||Math.hypot(S.x-F.trail[F.trail.length-1].x,S.y-F.trail[F.trail.length-1].y)*F.cam.sc>6)F.trail.push({x:S.x,y:S.y});
    if(F.trail.length>160)F.trail.shift();
    emit(dt);
  }else if(!F.ended){
    F.ended=true;audio.stopEngine();F.endT=now;F.toasts.length=0;F.toastT=0;
    if(S.crashed){breakApart();sfx('crash');sfx('ooh');buzz([60,40,80]);toast('Crashed',has('crashtest')?`+${num(mv('crashtest'))} mult`:'');dust(S.x,S.y,30,true)}
    else if(S.landed)sfx('touchdown'),sfx('cheer',{intensity:.6}),buzz(25),toast('Touchdown',has('greaser')?`×${num(mv('greaser'))} score`:'+0.5 mult');
    if(S.landed&&has('bullseye')&&onTarget(S.x))F.cheer=1,sfx('cheer',{intensity:.9}),toast('Bullseye',`×${num(mv('bullseye'))} score`);
  }
  updParts(dt);draw(now);hud(dt);
  if(F.ended&&now-F.endT>(S.crashed?2600:1300)){if(F.online){if(!F.settled)finishOnline()}else{finish();return}}
  raf=requestAnimationFrame(frame);
}
function emit(dt){
  const {S}=F,K=F.K;if(F.cam.sc<2)return;
  const c=Math.cos(S.th),s=Math.sin(S.th);
  for(const p of K.parts){
    if((p.type==='prop'&&S.propOn&&Math.random()<dt*14)||(p.type==='rocket'&&S.rocketOn&&Math.random()<dt*50)){
      const lx=p.lx-.6,wx=S.x+lx*c-p.ly*s,wy=S.y+lx*s+p.ly*c;
      F.parts.push({x:wx,y:wy,vx:S.vx*.2-c*4+(Math.random()-.5)*2,vy:S.vy*.2-s*4+(Math.random()-.5)*2,life:1,r:p.type==='rocket'?.5:.3,k:p.type==='rocket'?'fire':'smoke'})}}
}
function dust(x,y,n,debris){for(let i=0;i<n;i++)F.parts.push({x,y,vx:(Math.random()-.5)*14,vy:Math.random()*9,life:1,r:debris?.25:.5,k:debris?'debris':'dust',g:1})}
function updParts(dt){for(const p of F.parts){p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.g)p.vy-=12*dt;p.life-=dt*(p.k==='fire'?2.2:p.k==='pop'||p.k==='gold'?1.6:.9);p.r+=dt*(p.k==='smoke'?1.2:p.k==='fire'?.8:0)}F.parts=F.parts.filter(p=>p.life>0);if(F.parts.length>500)F.parts.splice(0,F.parts.length-500)}

// the goat's face is the feedback channel: it reads the flight before the numbers do
function pilotMood(){
  const S=F.S,v=Math.hypot(S.vx,S.vy),t=performance.now()/1000;
  if(S.crashed)return 'crash';
  if(F.pre>0)return 'focus';
  if(S.done)return S.landed?'bow':'sad';
  if(F.loopT&&t-F.loopT<1.6&&S.loops>=2)return 'dizzy';
  if((F.cheer||0)>.5)return 'cheer';
  if(!S.touch&&((v<11&&S.vy<-4)||(S.y<14&&S.vy<-11)))return 'scared';
  if(v>45)return 'grin';
  if(ctl.pitch)return 'focus';
  return 'idle';
}
// crash: every part becomes a tumbling piece of debris, and the pilot pops out on a parachute
function breakApart(){
  const {S}=F,K=F.K,c=Math.cos(S.th),s=Math.sin(S.th);
  F.debris=K.parts.map(p=>({type:p.type,rare:p.rare,x:S.x+p.lx*c-p.ly*s,y:S.y+p.lx*s+p.ly*c+.3,vx:S.vx*.35+(Math.random()-.5)*9+p.lx*3,vy:4+Math.random()*7,th:S.th,w:(Math.random()-.5)*14}));
  F.chute={x:S.x,y:S.y+1,vx:S.vx*.15+1.5,vy:11,t:0};
}
function updDebris(dt){
  for(const d of F.debris){d.vy-=14*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.th+=d.w*dt;
    if(d.y<.5){d.y=.5;if(d.vy<-2){d.vy=-d.vy*.35;d.w*=.6}else d.vy=0;d.vx*=Math.pow(.15,dt);d.w*=Math.pow(.2,dt)}}
  const p=F.chute;if(p){p.t+=dt;p.vy=Math.max(p.vy-14*dt,-2.2);p.vx*=Math.pow(.6,dt);p.x+=p.vx*dt;p.y=Math.max(.6,p.y+p.vy*dt)}
}
function drawDebris(X,Y,sc,now){
  const ds=Math.max(sc,14);
  for(const d of F.debris){ctx.save();ctx.translate(X(d.x),Y(d.y));ctx.scale(ds,ds);ctx.rotate(-d.th);drawPart(ctx,d.type,now/1000,{frac:0,lw:2.5/ds,mood:'crash',rare:d.rare});ctx.restore()}
  const p=F.chute;if(!p)return;
  const sway=Math.sin(p.t*2.2)*.25;ctx.save();ctx.translate(X(p.x),Y(p.y));ctx.scale(ds*1.4,ds*1.4);ctx.rotate(sway);
  if(ART&&ART.drawParachute)ART.drawParachute(ctx,now/1000,{lw:2.5/(ds*1.4),open:clamp(p.t*3,0,1)});
  else{ctx.lineWidth=2.5/(ds*1.4);ctx.strokeStyle='#22283a';ctx.fillStyle='#d2402f';ctx.beginPath();ctx.arc(0,-1.6,1.1*clamp(p.t*3,.2,1),Math.PI,0);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(-1,-1.6);ctx.lineTo(0,0);ctx.lineTo(1,-1.6);ctx.stroke();ctx.fillStyle='#fbf5e8';ctx.beginPath();ctx.arc(0,.1,.32,0,7);ctx.fill();ctx.stroke()}
  ctx.restore();
}
function draw(now){
  const {S,st}=F,K=F.K, cam=F.cam;
  const list=F.online?(F.fl=flyers()):null, fo=list&&(F.settled||F.watch)&&F.pre<=0?focusOf(list):null, T=fo||S;
  const v=Math.hypot(T.vx,T.vy);
  const pre=F.pre>0;
  // F.cine (set by the trailer capture): a close camera on the craft instead of keeping the ground in view
  const viewH=pre?(F.cine?34:50):F.cine?Math.max(20,v*.55):Math.max(30,T.y*1.25+16,v*1.3);
  cam.sc=Math.exp(lerp(Math.log(cam.sc),Math.log(vh/viewH),pre?.25:.08));
  const sc=cam.sc;
  const tx=pre?-10:T.x+.16*vw/sc;
  cam.x=F.camSet?lerp(cam.x,tx,pre?1:fo?.2:Math.min(1,.06+S.t*.5)):tx;F.camSet=1;
  cam.y=Math.max(T.y+RES*.5/sc,.35*vh/sc);
  const X=wx=>vw/2+(wx-cam.x)*sc, Y=wy=>vh/2-(wy-cam.y)*sc;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const left=cam.x-vw/2/sc, right=cam.x+vw/2/sc;
  // the crowd cheers for tricks and records and gets livelier as the flight's hype builds
  F.cheer=Math.max(0,(F.cheer||0)-1/60*1.5);
  drawWorld(ctx,{targets:F.ctx.lv.bullseye?TARGET_EVERY:0,vw,vh,sc,X,Y,camX:cam.x,camY:cam.y,left,right,now,RES,stage:R()?R().stage:0,town:R()?townOf(R().seed,R().stage).town:'',wx:F.wx,st,best:F.bestDist,hype:F.hype||0,cheer:F.cheer,pull:pre?Math.pow(clamp((1-F.pre/1.1)*1.3,0,1),2):0,launchT:pre?-1:S.t});
  const mag=st.magnetR>1;
  if(mag&&!S.done){const R0=COINR*st.magnetR*sc;ctx.save();ctx.strokeStyle='rgba(255,196,60,.45)';ctx.lineWidth=1.5;ctx.setLineDash([5,6]);ctx.lineDashOffset=-now/40;
    ctx.beginPath();ctx.arc(X(S.x),Y(S.y),R0,0,7);ctx.stroke();ctx.restore()}
  if((right-left)/COINSEG<700){
    // coins sit where the sim has them, so whatever is inside the magnet ring really is collected
    for(let k=Math.floor(left/COINSEG)-1;k<=Math.ceil(right/COINSEG)+1;k++){if(S.got.has(k))continue;const cn=coinAt(k);if(!cn)continue;
      const px=X(cn.x),py=Y(cn.y);if(py<-20||py>vh+20)continue;
      const r=Math.max(3,.8*sc),sq=Math.abs(Math.cos(now/300+k));
      ctx.fillStyle='#ffb020';ctx.beginPath();ctx.ellipse(px,py,r*(.35+.65*sq),r,0,0,7);ctx.fill();ctx.strokeStyle='#b87300';ctx.lineWidth=Math.max(1,r*.18);ctx.stroke()}}
  // collected coins fly from where they were into the craft (the magnet's pull, made visible)
  for(const c of F.flyCoins){const k=Math.min(1,c.t/.28),e=k*k,px=X(c.x+(S.x-c.x)*e),py=Y(c.y+(S.y-c.y)*e),r=Math.max(3,.8*sc)*(1-.5*k);
    ctx.fillStyle='#ffb020';ctx.beginPath();ctx.arc(px,py,r,0,7);ctx.fill();ctx.strokeStyle='#b87300';ctx.lineWidth=Math.max(1,r*.18);ctx.stroke()}
  if(F.trail.length>1){ctx.lineCap='round';for(let i=1;i<F.trail.length;i++){const a=F.trail[i-1],b=F.trail[i];ctx.strokeStyle='rgba(255,255,255,'+(.5*i/F.trail.length)+')';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(X(a.x),Y(a.y));ctx.lineTo(X(b.x),Y(b.y));ctx.stroke()}}
  for(const p of F.parts){const px=X(p.x),py=Y(p.y),r=Math.max(1,p.r*sc);
    ctx.fillStyle=p.k==='fire'?`rgba(255,${Math.round(140+100*p.life)},60,${p.life})`:p.k==='debris'?`rgba(90,70,50,${p.life})`:p.k==='pop'?`rgba(255,90,78,${p.life})`:p.k==='gold'?`rgba(255,196,60,${p.life})`:`rgba(240,240,240,${p.life*.5})`;
    ctx.beginPath();ctx.arc(px,py,r,0,7);ctx.fill()}
  const cx=X(S.x),cy=Y(S.y);
  // Redline: a brass shockwave with a white ring behind it and speed streaks flying out
  if(F.boom>=0){F.boom+=1/60;const b=F.boom,R2=24+b*340,a=Math.max(0,1-b*1.3);
    ctx.save();ctx.lineCap='round';
    ctx.strokeStyle=`rgba(233,169,59,${a})`;ctx.lineWidth=Math.max(1,9*(1-b));ctx.beginPath();ctx.arc(cx,cy,R2,0,7);ctx.stroke();
    ctx.strokeStyle=`rgba(255,250,235,${a*.8})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,R2*.72,0,7);ctx.stroke();
    ctx.strokeStyle=`rgba(255,236,190,${a})`;ctx.lineWidth=2.5;ctx.beginPath();
    for(let i=0;i<14;i++){const ang=i/14*6.283+.2,r0=R2*.8,r1=R2*1.15;ctx.moveTo(cx+Math.cos(ang)*r0,cy+Math.sin(ang)*r0);ctx.lineTo(cx+Math.cos(ang)*r1,cy+Math.sin(ang)*r1)}
    ctx.stroke();ctx.restore();if(b>.8)F.boom=-1}
  if(F.debris)drawDebris(X,Y,sc,now);
  if(list)drawFlyers(list,X,Y,sc,now,fo);
  if(!S.crashed&&!F.watch){
    // zoomed far out the craft keeps a minimum on-screen size, with a soft halo so it stays easy to find
    let ext=.7;for(const p of K.parts)ext=Math.max(ext,Math.hypot(p.lx,p.ly)+.7);
    const ds=Math.max(sc,16/ext);
    if(ds>sc*1.05){const R=ext*ds*1.9,a=clamp(ds/sc/4,0,1)*.32,hg=ctx.createRadialGradient(cx,cy,0,cx,cy,R);
      hg.addColorStop(0,`rgba(255,255,255,${a})`);hg.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=hg;ctx.beginPath();ctx.arc(cx,cy,R,0,7);ctx.fill()}
    let px=cx,py=cy;
    if(F.pre>0){const k=1-F.pre/1.1,back=Math.pow(clamp(k*1.3,0,1),2)*1.4*sc;px-=Math.cos(S.th)*back;py+=Math.sin(S.th)*back}
    ctx.save();ctx.translate(px,py);ctx.scale(ds,ds);ctx.rotate(-S.th);
    if(F.stretch>0)ctx.scale(1+.18*F.stretch,1-.12*F.stretch);
    const frac=K.fuelMax?S.fuel/K.fuelMax:0, mood=pilotMood();
    for(const p of K.parts){ctx.save();ctx.translate(p.lx,-p.ly);drawPart(ctx,p.type,now/1000,{rare:p.rare,on:p.type==='rocket'?S.rocketOn:S.propOn,frac,lw:clamp(ds*.06,.9,2.5)/ds,mood,kin:F.online?kinOf(clientId()):0});ctx.restore()}
    ctx.restore()
  }
  drawGrain(ctx,vw,vh);
}
// the others in the sky: translucent planes with a name tag, or a tag at the screen edge pointing to them
function drawFlyers(list,X,Y,sc,now,fo){
  ctx.save();ctx.font='800 12px Nunito, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  const tag=(x,y,t,hot)=>{const w=ctx.measureText(t).width+14;x=clamp(x,w/2+4,vw-w/2-4);ctx.fillStyle=hot?'#e9a93b':'#f3e7ce';ctx.strokeStyle='#22283a';ctx.lineWidth=2;ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(x-w/2,y-10,w,20,10);else ctx.rect(x-w/2,y-10,w,20);ctx.fill();ctx.stroke();ctx.fillStyle='#22283a';ctx.fillText(t,x,y+.5)};
  for(const f of list){if(!f.K)continue;
    const px=X(f.x),py=Y(f.y);let ext=.7;for(const p of f.K.parts)ext=Math.max(ext,Math.hypot(p.lx,p.ly)+.7);
    const ds=Math.max(sc,12/ext),inView=px>-30&&px<vw+30&&py>RES+40&&py<vh+30;
    if(inView){ctx.save();ctx.globalAlpha=f.done?.35:.62;ctx.translate(px,py);ctx.scale(ds,ds);ctx.rotate(-f.th);
      for(const p of f.K.parts){ctx.save();ctx.translate(p.lx,-p.ly);drawPart(ctx,p.type,now/1000,{rare:p.rare,on:f.on,frac:.6,lw:clamp(ds*.06,.9,2.5)/ds,mood:f.mood,kin:kinOf(f.id)});ctx.restore()}
      ctx.restore();tag(px,py-ext*ds-14,f.name+(f.s?' · '+fmt(f.s):''),fo&&fo.id===f.id)}
    else if(!f.done){const ex=clamp(px,44,vw-44),ey=clamp(py,RES+110,vh-150);tag(ex,ey,(px<0?'◂ ':'')+f.name+(px>vw?' ▸':'')+(py<RES+40&&px>=0&&px<=vw?' ▴':''),false)}}
  ctx.restore();
}
const elD=$('fDist'),elA=$('fAlt'),elV=$('fSpd'),elF=$('fFuel'),elT=$('toast'),elS=$('fScore'),elM=$('fMult'),elN=$('fNeed'),elFF=$('fTs'),elTm=$('fTime');
function hud(dt){
  const {S}=F,K=F.K;
  // spectating: the distance, height and speed are the focused pilot's
  const fo=F.online&&(F.settled||F.watch)&&F.fl?focusOf(F.fl):null,P=fo||S;
  elD.textContent=fmtD(Math.max(0,P.x));
  elA.textContent='ALT '+fmtD(Math.max(0,P.y));
  elV.textContent=fmtV(Math.hypot(P.vx,P.vy));
  // flight clock: a flight ends at st.flightTime (5 min + Flight permits), so slow climbers can plan their descent
  {const rem=Math.max(0,Math.ceil(F.st.flightTime-S.t));elTm.lastChild.textContent=Math.floor(rem/60)+':'+String(rem%60).padStart(2,'0');elTm.className='ftime'+(rem<=20?' crit':rem<=60?' warn':'')}
  if(S.burst&&$('bPop').style.visibility!=='hidden')$('bPop').style.visibility='hidden';
  elFF.hidden=true;
  const sc=scoreFlight(summaryOf(S,K),F.ctx);F.live=sc.total;
  F.hype=clamp((sc.mult*sc.xm-1)/4,0,1);audio.hype(F.hype);
  if(!S.done&&F.pre<=0){const fr=K.fuelMax?S.fuel/K.fuelMax:0;audio.engine({prop:S.propOn?ctl.throttle:0,rocket:S.rocketOn?ctl.throttle:0,speed:Math.hypot(S.vx,S.vy),fuel:fr,alt:S.y})}F.coinT=Math.max(0,(F.coinT||0)-dt);
  // the score as its sum: distance points (+ the altitude landing bonus waiting for a landing) times the multiplier
  {const pend=!S.landed&&!S.done?altBonus(S.maxY):0,key=sc.base+'|'+pend;if(key!==F.scoreKey){F.scoreKey=key;
    elS.innerHTML=pend?`(${fmt(sc.base)} <i class="lb">+ ${fmt(pend)}</i>)`:fmt(sc.base)}}
  elM.textContent='×'+num(sc.mult*sc.xm);
  if(F.quota!=null){const need=F.quota-F.already-sc.total;elN.textContent=need>0?`${fmt(need)} to target`:'Target reached';elN.className='need'+(need>0?'':' ok')}
  else if(F.online&&ROOM&&ROOM.mode==='team'){let got=sc.total;for(const f of F.fl||[])got+=f.s||0;const need=ROOM.target-ROOM.teamScore-got;
    elN.textContent=need>0?`${fmt(need)} to team target`:'Team target reached';elN.className='need'+(need>0?'':' ok')}
  else if(F.online){elN.textContent=ROOM?'Round '+(ROOM.round):'';elN.className='need'}
  else{elN.textContent='Total '+fmt(F.already+sc.total);elN.className='need'}
  elS.style.color=F.coinFlash>0?'#ffb020':'';F.coinFlash=Math.max(0,F.coinFlash-dt*3);
  elF.style.transform='scaleX('+(K.fuelMax?S.fuel/K.fuelMax:0)+')';
  F.toastT-=dt;
  if(F.toastT<=0){if(F.toasts.length){const t=F.toasts.shift();elT.innerHTML=`${t.title}${t.sub?`<small>${t.sub}</small>`:''}`;elT.style.opacity=1;F.toastT=1.3}else elT.style.opacity=0}
}

/* ================= results ================= */
const reduceMotion=()=>window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
// sound hook: the audio module plugs in here (audio.js); every call is optional so the game runs silent without it
let AUDIO=audio, DECAL=decalURL, ART={drawParachute};
const sfx=(n,o)=>{try{AUDIO&&AUDIO.sfx(n,o)}catch(_){}};
// haptics only after the player has really touched the page (browsers refuse vibration before that)
const buzz=p=>{try{const ua=navigator.userActivation;if(navigator.vibrate&&(!ua||ua.hasBeenActive))navigator.vibrate(p)}catch(_){}};
function finish(){
  cancelAnimationFrame(raf);
  const r=R(),{S}=F,K=F.K;
  const f=summaryOf(S,K);
  const out=settleFlight(r,metaOf(r),f);
  if(out.dailyDone)completeDaily(r);
  persist();reportRun(r,!!(out.dailyDone||out.failed));
  showResults(out,S,f);
  F=null;
}
// which mod a score line came from, so the tally can show its decal
const lineMod=label=>Object.keys(MODS).find(id=>label.startsWith(MODS[id].name));
/* The score tally, staged like a show's encore: a stamp slams down, the seat counter rolls, every hype source pops in
   one after another (pitch rising), the multiply slams, the crowd bar fills, and a newspaper prints its headline.
   Tapping the card skips straight to the end. */
function showResults(out,S,f){
  const r=R(),sc=out.sc,town=townOf(r.seed,out.stage);
  const title=S.crashed?'Crashed':S.banked?'Landed early':S.landed?'Touchdown':S.becalmed?'Becalmed':'Out of time';
  const kind=S.crashed?'bad':S.landed?'good':'meh';
  const base=sc.lines.filter(l=>l.t==='b'), hype=sc.lines.filter(l=>l.t!=='b'), extra=base.filter(l=>!l.dist);
  const q=out.quota, p0=Math.min(1,out.prevScore/q), p1=Math.min(1,out.contractScore/q);
  const barT=v=>isFinite(q)?`Score ${fmt(v)} / ${fmt(q)}`:`Total ${fmt(v)}`;
  let btn='',next='',result='';
  // one result line: sold out (with the bonus), or what is still needed; the gate cash rides along
  if(out.cleared){btn=out.won?'Continue':'Next contract';next=out.won?'won':'shop';preloadMap();
    result=`<div id="tySold" class="soldout" hidden>Contract cleared! <small>+${out.reward+out.interest+out.pay+(out.over||0)} coins</small></div>`+(out.unlocks&&out.unlocks.length?`<p class="hint">Unlocked: <strong>${out.unlocks.join(', ')}</strong></p>`:'');}
  else if(out.failed){btn='Run summary';next='over';result=`<p class="tres warn">No flights left · +${out.pay} coins</p>`}
  else if(out.dailyDone){btn='See results';next='daily';result=`<p class="tres">Puzzle complete · +${out.pay} coins</p>`}
  else{const left=FLIGHTS-out.flightNo;btn='Continue';next='hangar';result=`<p class="tres">${isFinite(q)?fmt(q-out.contractScore)+' to target · ':''}${plural(left,'flight')} left · +${out.pay} coins</p>`}
  const news=headline({...f,cleared:!!out.cleared},{town:town.town,pilot:'Goat'},r.seed+out.stage*7+out.flightNo);
  sheet.className='sheet tallysheet';
  sheet.innerHTML=`${hostHTML('announcer',S.crashed?'worried':out.cleared||S.landed&&(!Number.isFinite(q)||sc.total>=q/FLIGHTS)?'happy':'calm','peek')}<div class="stamp ${kind}">${title}</div>
    <span class="label">${town.town} · flight ${out.flightNo} of ${FLIGHTS}</span>
    <div class="eqn"><span class="drum" id="tyBase">0</span><i>×</i><span id="tyM">1</span><i>=</i><b id="tyT">0</b></div>
    ${extra.length?`<div class="hype bpts">${extra.map(l=>`<span class="hc b in">${l.label}<b>+${fmt(l.v)}</b></span>`).join('')}</div>`:''}
    <div class="hype" id="tyHype">${hype.map((l,k)=>{const m=lineMod(l.label);return `<span class="hc ${l.t}" data-k="${k}">${m&&DECAL?`<img alt="" src="${DECAL(m,48,modLevels(r)[m]||1)}">`:''}${l.label}<b>${l.t==='x'?'×':'+'}${num(l.v)}</b></span>`}).join('')||'<span class="hc none">No stunts this time</span>'}</div>
    <div class="cbar${out.cleared?' done':''}"><i id="rbar" style="transform:scaleX(${p0})"></i><span id="rbarT">${barT(out.prevScore)}</span></div>
    ${result}
    <div class="clip" id="tyNews" hidden><small>The ${town.town} Gazette</small>${news}</div>
    <button class="big" type="button" id="next">${btn}</button>`;
  veil.hidden=false;veil.classList.add('tally');
  const el=id=>$(id), rm=reduceMotion();
  // roll a number up over d ms, ticking digits like a mechanical counter
  const roll=(node,to,d,fmtf=fmt)=>new Promise(res=>{if(rm||skip){node.textContent=fmtf(to);return res()}const t0=performance.now();
    const tick=t=>{const k=Math.min(1,(t-t0)/d);node.textContent=fmtf(to*(1-Math.pow(1-k,3)));if(k<1&&!skip)requestAnimationFrame(tick);else{node.textContent=fmtf(to);res()}};requestAnimationFrame(tick)});
  const wait=ms=>new Promise(res=>setTimeout(res,rm||skip?0:ms));
  let skip=false, done=false;
  const finishNow=()=>{skip=true;sheet.querySelectorAll('.hc').forEach(c=>c.classList.add('in'));el('tyM').textContent=num(sc.mult*sc.xm);el('tyT').textContent=fmt(sc.total);el('tyBase').textContent=fmt(sc.base)+(base.length===1?' m':'');
    el('rbar').style.transform=`scaleX(${p1})`;el('rbarT').textContent=barT(out.contractScore);el('tyNews').hidden=false;if(out.cleared){el('tySold').hidden=false;setHost(sheet.querySelector('.host'),'ringmaster','happy')}};
  sheet.onclick=e=>{if(!e.target.closest('button')&&!done)finishNow()};
  (async()=>{
    sfx('stamp');buzz(15);
    await wait(350);
    await roll(el('tyBase'),sc.base,650,x=>fmt(x)+(base.length===1?' m':''));
    let m=1,x=1;
    const chips=[...sheet.querySelectorAll('.hc[data-k]')];
    for(let k=0;k<chips.length;k++){if(skip)break;const l=hype[k];
      if(l.t==='x')x*=l.v;else m+=l.v;chips[k].classList.add('in');el('tyM').textContent=num(m*x);sfx('multStep',{step:k});buzz(6);await wait(230)}
    if(!skip){await wait(150);sfx('slam');buzz([30,40,30]);sheet.classList.add('kick');setTimeout(()=>sheet.classList.remove('kick'),300)}
    el('tyM').textContent=num(sc.mult*sc.xm);
    await roll(el('tyT'),sc.total,450);
    await wait(200);
    el('rbar').style.transform=`scaleX(${p1})`;el('rbarT').textContent=barT(out.contractScore);
    if(out.cleared){await wait(700);el('tySold').hidden=false;setHost(sheet.querySelector('.host'),'ringmaster','happy');sfx('fireworks');sfx('fanfare');buzz([20,60,20,60,40]);confetti()}
    await wait(400);el('tyNews').hidden=false;done=true;
  })();
  $('next').onclick=()=>{
    veil.classList.remove('tally');sheet.className='sheet';sheet.onclick=null;
    if(next==='won'){showVictory();return}
    if(next==='daily'){showDailyEnd();return}
    if(next==='over'){showRunOver();return}
    if(next==='shop'&&slot==='run'){showTour(R(),true);return}
    veil.hidden=true;show('hangar');setTab('build');
  };
}
// paper confetti over the sheet for a sold-out show
function confetti(){
  if(reduceMotion())return;
  const box=document.createElement('div');box.className='confetti';document.body.appendChild(box);
  const cols=['#d2402f','#e9a93b','#3b9aa6','#fbf5e8','#4fa35b','#7a4fa0'];
  for(let i=0;i<60;i++){const c=document.createElement('i');c.style.background=cols[i%cols.length];c.style.left=Math.random()*100+'%';
    const dx=(Math.random()-.5)*160,rot=Math.random()*720-360,d=1400+Math.random()*1200;box.appendChild(c);
    c.animate([{transform:'translate(0,-20px) rotate(0)',opacity:1},{transform:`translate(${dx}px,${window.innerHeight*.9}px) rotate(${rot}deg)`,opacity:.9}],{duration:d,delay:Math.random()*300,easing:'cubic-bezier(.3,.6,.5,1)',fill:'forwards'})}
  setTimeout(()=>box.remove(),3200);
}
function runStats(r){return `<dl class="stats"><dt>Total score</dt><dd>${fmt(r.total)}</dd><dt>Best flight</dt><dd>${fmt(r.best)}</dd><dt>Longest flight</dt><dd>${fmtD(r.bestDist||0)}</dd><dt>Flights</dt><dd>${r.log.length}</dd></dl>`}
// end of a season: a won season is a sold-out poster with confetti; a lost one is the torn "tour cancelled" poster
function showVictory(){
  const r=R(),m=save.meta;
  sheet.className='sheet endsheet win';
  sheet.innerHTML=`${hostHTML('ringmaster','happy','lg')}<span class="label">${r.level?'Difficulty '+r.level:'Run'}</span>
    <h2>Run complete!</h2>
    <p class="note">All ${CONTRACTS} contracts cleared.</p>
    ${runStats(r)}
    ${r.unlocks.length?`<p class="note">Unlocked: <b>${r.unlocks.join(', ')}</b></p>`:''}
    ${m.level>r.level?`<p class="note">Difficulty <b>${r.level+1}</b> unlocked</p>`:''}
    <button class="big win" type="button" id="endless">Endless mode</button>
    <button class="big alt" type="button" id="retire">Retire</button>`;
  veil.hidden=false;sfx('fanfare');sfx('cheer',{intensity:1});confetti();
  $('endless').onclick=()=>{sheet.className='sheet';r.endless=true;r.phase='shop';r.shop=genShop(r,m);weatherOf(r,r.stage);grantPacks(r);persist();veil.hidden=true;show('hangar');setTab('build')};
  $('retire').onclick=()=>{sheet.className='sheet';endRun()};
}
function showRunOver(){
  const r=R();
  const n=r.stage;
  sheet.className='sheet endsheet lose';
  sheet.innerHTML=`${hostHTML('ringmaster','worried','lg')}<span class="label">${r.level?'Difficulty '+r.level:'Run'}</span>
    <h2>${r.endless?'Endless run over':'Run over'}</h2>
    <p class="note">Contracts cleared: <b>${n}${r.endless?'':' / '+CONTRACTS}</b></p>
    ${runStats(r)}
    ${r.unlocks.length?`<p class="note">Unlocked: <b>${r.unlocks.join(', ')}</b></p>`:''}
    <button class="big" type="button" id="again">New run</button>`;
  veil.hidden=false;sfx('sad');
  $('again').onclick=()=>{sheet.className='sheet';endRun()};
}

/* ================= daily puzzle ================= */
// one contract, three flights, 100 coins, no storms: the same seed for everyone each day, ranked on the first try.
// Random puzzles (any seed, unranked) open up after the first finished daily.
function dailyCard(){
  const n=dailyNumber(),m=save.meta,d=save.daily,rec=(m.daily||{})[n];
  let t,b;
  if(d)t=`${d.ranked?'Daily #'+d.day:'Random puzzle'} · flight ${d.flight+1} of ${FLIGHTS} · score ${fmt(d.total)}`,b=`<button class="big alt" id="dCont" type="button">Continue puzzle</button>`;
  else if(rec)t=`Your score <b>${fmt(rec.score)}</b>${rec.rank?` · #${rec.rank} of ${rec.total}`:''}`,b=`<div class="row2"><button class="ghost" id="dBoard" type="button">Leaderboard</button><button class="ghost" id="dRandom" type="button">Random puzzle</button></div>`;
  else t=`${DAILY_COINS} coins · ${FLIGHTS} flights · no storms. Highest score wins.`,b=`<button class="big alt" id="dPlay" type="button">Play daily #${n}</button>${m.dailyEver?'<button class="ghost" id="dRandom" type="button">Random puzzle</button>':''}`;
  return `<div class="card stack">${cardHead(`Daily puzzle #${n}`,t,CARD.daily)}${b}</div>`;
}
function roomCard(){
  if(save.room)return `<div class="card stack">${cardHead('Play with friends',`Room <b>${esc(save.room)}</b>`,CARD.rooms)}<button class="big alt" id="rRejoin" type="button">Rejoin room</button><button class="ghost" id="rQuit" type="button">Leave room</button></div>`;
  return `<div class="card stack">${cardHead('Play with friends','',CARD.rooms)}<button class="big alt" id="rNew" type="button">Create room</button>
    <div class="joinrow"><input id="rCode" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code"><button class="ghost" id="rJoin" type="button">Join</button></div></div>`;
}
function bindModeCards(){
  const on=(id,f)=>{const b=$(id);if(b)b.onclick=f};
  on('dCont',()=>{slot='daily';tab='build';openHangar()});
  on('dPlay',()=>startPuzzle(true));
  on('dRandom',()=>startPuzzle(false));
  on('dBoard',()=>showBoard(dailyNumber()));
  on('rNew',async()=>{const b=$('rNew');b.disabled=true;try{joinRoom(await newRoomCode())}catch(e){b.disabled=false;notice('Could not reach the server. Try again in a moment.')}});
  on('rJoin',()=>{const c=($('rCode').value||'').toUpperCase().replace(/[^A-Z]/g,'');if(c.length===4)joinRoom(c);else $('rCode').focus()});
  {const i=$('rCode');if(i)i.onkeydown=e=>{if(e.key==='Enter')$('rJoin').click()}}
  on('rRejoin',()=>joinRoom(save.room));
  on('rQuit',()=>leaveRoom());
  retryDaily();
}
function startPuzzle(ranked){
  const n=dailyNumber();
  const r=newRun(0,metaOf({mode:'daily'}),{mode:'daily',seed:ranked?dailySeed(n):undefined});
  r.ranked=ranked;r.day=n;save.daily=r;slot='daily';persist();tab='build';sel='wing';openHangar();
}
// the third flight is in: record it (and send it, if ranked) before the player even sees the tally
function completeDaily(r){
  const m=save.meta;
  if(r.ranked){m.daily=m.daily||{};m.daily[r.day]={score:r.total};m.dailyEver=true;
    const keys=Object.keys(m.daily).map(Number).sort((a,b)=>b-a);for(const k of keys.slice(7))delete m.daily[k];
    m.dailyPending={day:r.day,score:r.total,data:JSON.parse(runCode(r))}}
  persist();
}
// a ranked score waits in meta.dailyPending until the server has it (offline phones send it later)
async function retryDaily(){
  const p=save.meta.dailyPending;if(!p||!save.meta.name||retryDaily.busy)return null;retryDaily.busy=true;
  try{const res=await postDaily({...p,client:clientId(),name:save.meta.name});save.meta.dailyPending=null;
    const rec=(save.meta.daily||{})[p.day];if(rec&&res.me){rec.rank=res.me.rank;rec.total=res.total}persist();return res}
  catch(_){return null}finally{retryDaily.busy=false}
}
function boardHTML(res){
  if(!res||!res.top.length)return '<p class="hint">No scores yet.</p>';
  const mine=res.me&&res.top.findIndex(t=>t.name===res.me.name&&t.score===res.me.score);
  return `<ol class="board">${res.top.map((t,i)=>`<li class="${i===mine?'me':''}"><i>${i+1}</i><span>${esc(t.name)}</span><b>${fmt(t.score)}</b></li>`).join('')}</ol>
    ${res.me?`<p class="hint">You: #${res.me.rank} of ${res.total}</p>`:`<p class="hint">${plural(res.total,'pilot')}</p>`}`;
}
async function showBoard(day){
  sheet.className='sheet';
  sheet.innerHTML=`<span class="label">Daily puzzle #${day}</span><h2>Leaderboard</h2><div id="bBox"><p class="hint">Loading…</p></div><button class="big" id="bOk" type="button">Close</button>`;
  veil.hidden=false;$('bOk').onclick=()=>{veil.hidden=true;renderTitle()};
  try{const res=await getDaily(day,clientId());const rec=(save.meta.daily||{})[day];if(rec&&res.me){rec.rank=res.me.rank;rec.total=res.total;persist()}
    if($('bBox'))$('bBox').innerHTML=boardHTML(res)}
  catch(_){if($('bBox'))$('bBox').innerHTML='<p class="hint warn">Could not load the leaderboard.</p>'}
}
// the end of a puzzle: the total, then (ranked) a name and the leaderboard
function showDailyEnd(){
  const r=save.daily;if(!r){veil.hidden=true;show('title');renderTitle();return}
  sheet.className='sheet endsheet win';
  const named=!!save.meta.name;
  sheet.innerHTML=`<span class="label">${r.ranked?'Daily puzzle #'+r.day:'Random puzzle'}</span>
    <h2>${fmt(r.total)}</h2><p class="note">Total of ${FLIGHTS} flights</p>${runStats(r)}
    ${r.ranked?`<div class="namerow"${named?' hidden':''}><input id="dName" maxlength="16" placeholder="Your name" autocomplete="nickname" value="${esc(save.meta.name||'')}"><button class="big" id="dSend" type="button">Submit</button></div><div id="bBox">${named?'<p class="hint">Sending…</p>':''}</div>`:''}
    <button class="${r.ranked?'ghost':'big'}" id="dDone" type="button">Done</button>${r.ranked?'':'<button class="ghost" id="dAgain" type="button">Another random puzzle</button>'}`;
  veil.hidden=false;sfx('fanfare');confetti();
  const send=async()=>{const res=await retryDaily();if(!$('bBox'))return;$('bBox').innerHTML=res?boardHTML(res):'<p class="hint warn">Offline: your score is sent next time.</p>'};
  if(r.ranked&&named)send();
  const ds=$('dSend');if(ds)ds.onclick=()=>{const n=($('dName').value||'').trim().slice(0,16);if(!n){$('dName').focus();return}save.meta.name=n;persist();sheet.querySelector('.namerow').hidden=true;$('bBox').innerHTML='<p class="hint">Sending…</p>';send()};
  $('dDone').onclick=()=>{sheet.className='sheet';leaveMode()};
  const da=$('dAgain');if(da)da.onclick=()=>{sheet.className='sheet';veil.hidden=true;save.daily=null;startPuzzle(false)};
}
// leave a puzzle or a room's run and go back to the title (the main run stays untouched)
function leaveMode(){
  if(slot==='daily'){const r=save.daily;if(r&&r.ranked&&r.log.length&&r.phase!=='done'){r.phase='done';completeDaily(r)}if(r&&r.phase!=='done')reportRun(r,true);addHistory(r);save.daily=null}
  else if(slot==='online'){leaveRoom();return}
  slot='run';persist();veil.hidden=true;armAbandon=false;show('title');renderTitle();
}
function notice(msg){sheet.className='sheet';sheet.innerHTML=`<p class="note">${esc(msg)}</p><button class="big" id="nOk" type="button">OK</button>`;veil.hidden=false;$('nOk').onclick=()=>{veil.hidden=true}}

/* ================= live rooms ================= */
// Everyone in a room plays the same seed and launches together. Each phone flies its own craft and streams its
// position; the others appear as ghosts. After landing you watch whoever is still flying.
let NET=null, ROOM=null;
const ghosts=new Map();
const me=()=>ROOM&&ROOM.players.find(p=>p.id===clientId());
const isBotP=p=>p&&p.bot>=0;
// in a room every pilot is a different animal with its own scarf colour, by seat (join order), the same on every phone
const kinOf=id=>{const i=ROOM?ROOM.players.findIndex(p=>p.id===id):-1;return i<0?0:i%KINS.length};
function joinRoom(code){
  if(NET&&NET.code!==code){NET.close();NET=null}
  if(save.room!==code){save.room=code;if(save.online&&save.online.room!==code)save.online=null;persist()}
  if(!NET)NET=connectRoom(code,clientId(),save.meta.name||'Pilot',{onState,onPos,onDone:onGhostDone,
    onError:msg=>{if(!ROOM||ROOM.phase==='lobby'&&!me()){leaveRoom();notice(msg)}},
    onStatus:ok=>{document.body.classList.toggle('offline',!ok)}});
  slot='online';
  if(!ROOM)lobbyLoading();
}
function leaveRoom(){
  if(NET){NET.close();NET=null}
  reportRun(save.online,true);
  ROOM=null;ghosts.clear();save.room=null;save.online=null;slot='run';persist();
  if(F&&F.online){cancelAnimationFrame(raf);audio.stopEngine();F=null}
  document.body.classList.remove('offline');veil.hidden=true;sheet.className='sheet';show('title');renderTitle();
}
function lobbyLoading(){sheet.className='sheet';sheet.innerHTML=`<span class="label">Room ${esc(save.room||'')}</span><p class="hint">Connecting…</p><button class="ghost" id="rCancel" type="button">Cancel</button>`;veil.hidden=false;$('rCancel').onclick=leaveRoom}
const roomName=p=>isBotP(p)?p.name+' (bot)':p.name;
function onState(room){
  ROOM=room;
  if(room.phase==='lobby'){
    if(save.online){reportRun(save.online,true);save.online=null;persist()}
    if(F&&F.online){cancelAnimationFrame(raf);audio.stopEngine();F=null}
    show('title');showLobby();return;
  }
  // a run for this room: everyone starts from the room's seed
  let r=save.online;
  if(!r||r.seed!==room.seed||r.room!==room.code){r=save.online=newRun(0,metaOf({mode:room.mode}),{mode:room.mode,seed:room.seed});r.room=room.code;r.applied=0;r.shown=0;persist()}
  slot='online';
  if(room.results&&room.results.round>r.applied)applyRound(r,room.results);
  const flying=F&&F.online;
  if(room.phase==='flight'){
    if(!flying||F.round!==room.round){veil.hidden=true;sheet.className='sheet';veil.classList.remove('tally');startOnlineFlight(room)}
    else updSpec();
    return;
  }
  // the round is over (build or over): leave the sky and show the round's results once
  if(flying){endOnlineFlight();return}
  if(room.results&&room.results.round>r.shown&&!$('hangar').hidden&&veil.hidden){showRound();return}
  if(room.results&&room.results.round>r.shown&&!$('title').hidden){show('hangar');showRound();return}
  if(room.phase==='over'){if(veil.hidden){show('hangar');renderHangar();showRoomOver()}return}
  if(!$('title').hidden){veil.hidden=true;tab='build';openHangar();return}
  if(!$('hangar').hidden)renderRoomBits();
}
// a room update while building: only the poster and the ready button change (a full redraw would break a drag)
function renderRoomBits(){const r=R();if(!r||!isOnline(r))return;renderStrip();$('launch').textContent=readyLabel();$('launch').disabled=!me()||!me().alive}
// the room's verdict on a round, applied to this phone's run once (results carry a round number)
function applyRound(r,res){
  r.applied=res.round;
  if(r.mode==='team'){
    if(res.cleared)r.lastClear=clearContract(r,metaOf(r),{});
    else if(res.failed)r.phase='over';
  }else{
    const out=(res.out||[]).includes(clientId());
    if(out)r.out=true;
    else if(!r.out)r.lastClear=clearContract(r,metaOf(r),{});
  }
  persist();
}
function showLobby(){
  const R0=ROOM,mine=me(),host=R0.host===clientId(),elim=R0.mode==='elim';
  const link=homeURL('/?room='+R0.code);
  sheet.className='sheet lobby';
  sheet.innerHTML=`<span class="label">Room</span><h2 class="rcode">${esc(R0.code)}</h2>
    <button class="ghost" id="rShare" type="button">Invite friends</button>
    <div class="seg" id="rMode">${[['team','Team'],['elim','Elimination']].map(([k,n])=>`<button type="button" data-m="${k}" aria-pressed="${R0.mode===k}" ${host?'':'disabled'}>${n}</button>`).join('')}</div>
    <p class="hint">${elim?'One flight per round. The lowest scores drop out until one pilot is left.':'A full run together: all your scores add up toward each target.'}</p>
    <ul class="plist">${R0.players.map((p,i)=>`<li class="${p.connected?'':'off'}"><img class="kin" alt="" src="${kinFace(i%KINS.length)}"><span>${esc(roomName(p))}</span>${p.id===R0.host?'<b>host</b>':''}${p.id===clientId()?'<i>you</i>':''}</li>`).join('')}</ul>
    ${host&&elim?`<div class="row2"><button class="ghost" id="rBot" type="button" ${R0.players.length>=8?'disabled':''}>+ Bot</button><button class="ghost" id="rKick" type="button" ${R0.players.some(isBotP)?'':'disabled'}>− Bot</button></div>`:''}
    <div class="namerow"><input id="rName" maxlength="16" placeholder="Your name" autocomplete="nickname" value="${esc(mine?mine.name:save.meta.name||'')}"></div>
    ${host?`<button class="big" id="rGo" type="button">Start</button>`:'<p class="hint">Waiting for the host to start…</p>'}
    <button class="ghost" id="rLeave" type="button">Leave</button>`;
  veil.hidden=false;
  $('rShare').onclick=()=>{const b=$('rShare');const done=()=>{b.textContent='Link copied'};
    try{if(navigator.share)navigator.share({title:'Wingnut Circus',text:'Fly with me! Room '+R0.code,url:link}).catch(()=>{});else navigator.clipboard.writeText(link).then(done,()=>{b.textContent=link})}catch(_){b.textContent=link}};
  $('rMode').onclick=e=>{const b=e.target.closest('button');if(b&&host)NET.send({t:'mode',mode:b.dataset.m})};
  const nm=$('rName');nm.onchange=()=>{const n=nm.value.trim().slice(0,16);if(!n)return;save.meta.name=n;persist();NET.send({t:'hello',id:clientId(),name:n})};
  if($('rBot'))$('rBot').onclick=()=>NET.send({t:'addbot'});
  if($('rKick'))$('rKick').onclick=()=>NET.send({t:'kickbot'});
  if($('rGo'))$('rGo').onclick=()=>NET.send({t:'start',mode:R0.mode});
  $('rLeave').onclick=leaveRoom;
}
// the poster in a room: team target or elimination round, plus who is ready
function roomStrip(r){
  const R0=ROOM;if(!R0)return '';
  const chips=R0.players.filter(p=>R0.mode==='team'||p.alive).map(p=>`<span class="rchip${p.ready?' ready':''}${p.connected?'':' off'}${p.id===clientId()?' me':''}"><img class="kin" alt="" src="${kinFace(kinOf(p.id))}">${p.ready?'✓ ':''}${esc(roomName(p))}</span>`).join('');
  const t=townOf(r.seed,r.stage);
  if(R0.mode==='team'){const q=R0.target||1,p=Math.min(1,R0.teamScore/q);
    const stubs=`<span class="fpips" aria-label="${FLIGHTS-R0.flight} flights left">${Array.from({length:FLIGHTS},(_,i)=>`<i class="${i<R0.flight?'used':''}"></i>`).join('')}</span>`;
    const w=curWx(),storm=w?`<div class="pstorm"><b>${WEATHER[w].name}</b>${WEATHER[w].d(severity(r,r.stage))}</div>`:'';
    return `<div class="prow"><div class="ptown"><small>Team</small>${t.town}</div>${stubs}</div>
      <div class="cbar"><i style="transform:scaleX(${p})"></i><span>Team ${fmt(R0.teamScore)} / ${fmt(q)}</span></div>${storm}<div class="rchips">${chips}</div>${routeStrip(r)}`}
  const alive=R0.players.filter(p=>p.alive).length;
  return `<div class="prow"><div class="ptown"><small>Round ${R0.round+1}</small>${t.town}</div><span class="hint">${alive} left</span></div><div class="rchips">${chips}</div>`;
}
function readyLabel(){const R0=ROOM,m=me();if(!R0||!m)return 'READY';if(!m.alive)return 'OUT · WATCHING';const act=R0.players.filter(p=>p.alive&&p.connected),n=act.filter(p=>p.ready).length;
  return m.ready?`WAITING ${n}/${act.length}`:'READY'}
function toggleReady(){const m=me(),r=R();if(!m||!ROOM||ROOM.phase!=='build'||!m.alive)return;NET.send({t:'ready',ready:!m.ready,cells:r.cells});sfx(m.ready?'tap':'buy')}

// position updates from the others: kept with their arrival time and extrapolated a little when drawn
function onPos(m){let g=ghosts.get(m.id);if(!g){g={};ghosts.set(m.id,g)}
  Object.assign(g,{x:m.x,y:m.y,th:m.th,vx:m.vx||0,vy:m.vy||0,s:m.s||0,on:m.on,mood:m.mood,at:performance.now(),round:ROOM?ROOM.round:0});
  if(g.dx==null){g.dx=m.x;g.dy=m.y;g.dth=m.th}
  if(m.k&&m.k!==g.code){g.code=m.k;try{g.K=makeCraft(cellsOf(m.k),ghostSt())}catch(_){g.K=null}}}
function onGhostDone(m){const g=ghosts.get(m.id);if(g){g.done=true;g.last=m.last}
  if(F&&F.online){const p=ROOM&&ROOM.players.find(q=>q.id===m.id);if(p&&m.id!==clientId())toast(`${roomName(p)}: ${fmt(m.last.score)}`,m.last.crashed?'crashed':m.last.landed?'landed':'');F.roundScores[m.id]=m.last.score;updSpec()}}
let GST=null;const ghostSt=()=>GST||(GST=stats({},{},weatherFx(null,0)));

function startOnlineFlight(room){
  const r=R(),m=me(),watch=!m||!m.alive||r.out;
  show('flight');startFlight({online:true,watch});
  F.round=room.round;F.roundScores={};F.sendT=0;F.sent=0;
  F.pre=F.pre0=watch?0:Math.max(.4,(room.launchAt-NET.now())/1000);
  ghosts.forEach(g=>{g.done=false;g.x=null;g.dx=null});
  for(const p of room.players)if(p.id!==clientId()&&!isBotP(p)){const g=ghosts.get(p.id)||{};ghosts.set(p.id,g);g.done=!p.alive;g.x=null;g.dx=null;g.name=p.name;if(p.cells){const code=cellCodeOf(p.cells);if(code!==g.code){g.code=code;try{g.K=makeCraft(p.cells,ghostSt())}catch(_){g.K=null}}}}
  // bots fly here too, from the room's seed, so every phone sees the same bot flight
  F.bots=room.players.filter(p=>isBotP(p)&&p.alive).map(p=>{const b=botFlight(room.seed,room.stage,p.bot,ONLINE_TIME);return {...b,id:p.id,name:roomName(p),S:newFlight(b.K,b.st)}});
  // each bot test-flies its pilot candidates first: one bot per tick during the countdown, so the phone never stalls.
  // A bot that finishes planning after launch catches up in stepBots, so every phone still flies the same bot flight.
  F.botT=0;{const round=F.round;let qi=0;const plan=()=>{if(!F||!F.online||F.round!==round)return;const b=F.bots[qi++];if(!b)return;planBot(b);b.S=newFlight(b.K,b.st);setTimeout(plan,0)};setTimeout(plan,0)}
  if(watch){F.S.done=true;F.ended=true;F.settled=true;F.pre=0;$('flight').classList.add('watching');F.focus=null;updSpec()}
}
// my flight is over: settle it locally, tell the room, and start watching whoever is still flying
function finishOnline(){
  if(F.settled)return;F.settled=true;
  const r=R(),{S}=F,K=F.K,f=summaryOf(S,K);
  const out=settleFlight(r,metaOf(r),f);persist();reportRun(r,false);
  F.myOut=out;F.myF=f;F.roundScores[clientId()]=out.sc.total;
  NET.send({t:'done',score:out.sc.total,dist:f.dist,crashed:!!S.crashed,landed:!!S.landed});
  $('flight').classList.add('watching');updSpec();
}
function stepBots(n){
  if(!F.bots)return;F.botT+=n*SIM_DT;
  for(const b of F.bots){if(!b.ctl||b.S.done)continue;
    // fly the bot up to the room's flight time (more steps than n if it was planned late)
    for(let k=0;k<2400&&!b.S.done&&b.S.t<F.botT;k++){step(b.S,b.K,b.st,SIM_DT,b.ctl(b.S));if(b.S.burst&&!b.S.popped)b.K=popBalloons(b.S,b.K,b.st)}
    if(b.S.done){const sc=scoreFlight(summaryOf(b.S,b.K),b.ctx).total;b.score=sc;F.roundScores[b.id]=sc;
      NET.send({t:'bot',id:b.id,round:F.round,score:sc,dist:b.S.x,crashed:!!b.S.crashed,landed:!!b.S.landed});updSpec()}}
}
function sendPos(dt){
  const S=F.S;if(S.done||F.pre>0)return;F.sendT-=dt;if(F.sendT>0)return;F.sendT=.1;F.sent++;
  const m={t:'pos',s:F.live||0,x:+S.x.toFixed(2),y:+S.y.toFixed(2),th:+S.th.toFixed(3),vx:+S.vx.toFixed(2),vy:+S.vy.toFixed(2),on:!!(S.propOn||S.rocketOn),mood:pilotMood()};
  if(F.sent%20===1)m.k=cellCodeOf(R().cells);
  NET.send(m);
}
// everything airborne except me: other players (ghosts) and bots, as {id,name,x,y,th,vx,vy,K,on,mood,done}
function flyers(){
  const out=[],now=performance.now();
  for(const [id,g] of ghosts){if(g.x==null||!g.K)continue;const p=ROOM&&ROOM.players.find(q=>q.id===id);if(!p)continue;
    const k=g.done?0:Math.min(.4,(now-g.at)/1000),tx=g.x+g.vx*k,ty=g.y+g.vy*k;
    g.dx+=(tx-g.dx)*.35;g.dy+=(ty-g.dy)*.35;g.dth+=(g.th-g.dth)*.35;
    out.push({id,name:p.name,s:g.done&&g.last?g.last.score:g.s||0,x:g.dx,y:Math.max(0,g.dy),th:g.dth,vx:g.vx,vy:g.vy,K:g.K,on:g.on&&!g.done,mood:g.mood||'idle',done:g.done})}
  for(const b of F.bots||[])out.push({id:b.id,name:b.name,s:b.score!=null?b.score:scoreFlight(summaryOf(b.S,b.K),b.ctx).total,x:b.S.x,y:b.S.y,th:b.S.th,vx:b.S.vx,vy:b.S.vy,K:b.K,on:!b.S.done&&(b.S.propOn||b.S.rocketOn),mood:b.S.crashed?'crash':'focus',done:b.S.done,bot:true});
  return out;
}
// who the camera follows once I'm down: the chosen pilot if still flying, else the one furthest along
function focusOf(list){
  const live=list.filter(f=>!f.done);if(!live.length)return null;
  const f=live.find(f=>f.id===F.focus)||live.slice().sort((a,b)=>b.x-a.x)[0];F.focus=f.id;return f;
}
function updSpec(){
  const el=$('fSpec');if(!F||!F.online){el.hidden=true;return}
  if(!F.settled&&!F.watch){el.hidden=true;return}
  const list=F.fl||flyers(),fo=focusOf(list),mine=F.myOut?`Your score <b>${fmt(F.myOut.sc.total)}</b>`:'Watching';
  el.hidden=false;
  el.innerHTML=`<span>${mine}</span>${fo?`<button type="button" id="specNext">${list.filter(f=>!f.done).length>1?'◂ ▸ ':''}${esc(fo.name)} · ${fmtD(Math.max(0,fo.x))}</button>`:'<span>Waiting for the others…</span>'}`;
  const b=$('specNext');if(b)b.onclick=()=>{const live=list.filter(f=>!f.done);if(live.length<2)return;const i=live.findIndex(f=>f.id===(fo&&fo.id));F.focus=live[(i+1)%live.length].id;updSpec()};
}
function endOnlineFlight(){
  if(!F)return;if(!F.settled&&!F.watch)finishOnline();
  cancelAnimationFrame(raf);audio.stopEngine();
  const keep={out:F.myOut,f:F.myF,S:F.S,scores:F.roundScores};F=null;$('flight').classList.remove('watching');$('fSpec').hidden=true;
  show('hangar');renderHangar();showRound(keep);
}
// the round's results: my own tally (if I flew) plus everyone's scores, then the room's verdict
function showRound(keep){
  const r=R(),res=ROOM&&ROOM.results;if(!r||!res){renderHangar();return}
  r.shown=res.round;persist();
  const list=res.scores.slice().sort((a,b)=>b.score-a.score);
  const outIds=res.out||[];
  const rows=list.map((s,i)=>{const p=ROOM.players.find(q=>q.id===s.id);return `<li class="${s.id===clientId()?'me':''}${outIds.includes(s.id)?' out':''}"><i>${i+1}</i><span>${esc(p?roomName(p):s.name)}</span><b>${fmt(s.score)}</b>${outIds.includes(s.id)?'<em>out</em>':''}</li>`}).join('');
  const team=r.mode==='team';
  let verdict='',btn='Continue',next='hangar';
  if(team){
    const before=res.teamScore-res.scores.reduce((t,s)=>t+s.score,0),q=res.target;
    verdict=`<div class="cbar${res.cleared?' done':''}"><i style="transform:scaleX(${Math.min(1,res.teamScore/q)})"></i><span>Team ${fmt(res.teamScore)} / ${fmt(q)}</span></div>`+
      (res.cleared?`<div class="soldout">Contract cleared!${r.lastClear?` <small>+${r.lastClear.reward+r.lastClear.interest} coins</small>`:''}</div>`:res.failed?'<p class="tres warn">No flights left</p>':`<p class="tres">${fmt(q-res.teamScore)} to target · ${plural(FLIGHTS-res.flight,'flight')} left</p>`);
    if(ROOM.phase==='over'){btn='Run summary';next='over'}
  }else{
    const iOut=outIds.includes(clientId()),win=ROOM.phase==='over'&&ROOM.over&&ROOM.over.winner===clientId();
    verdict=win?'<div class="soldout">You win!</div>':iOut?'<p class="tres warn">You are out</p>':r.out?'':`<p class="tres">You made the cut${r.lastClear?` · +${r.lastClear.reward+r.lastClear.interest} coins`:''}</p>`;
    if(ROOM.phase==='over'){btn='Final results';next='over'}else if(r.out){btn='Keep watching'}
  }
  sheet.className='sheet roundsheet';
  sheet.innerHTML=`<span class="label">${team?`${townOf(r.seed,res.stage).town} · flight ${res.flight} of ${FLIGHTS}`:'Round '+res.round}</span>
    ${keep&&keep.out?`<div class="eqn small"><span>${fmt(keep.out.sc.base)}${keep.out.sc.lines.filter(l=>l.t==='b').length===1?' m':''}</span><i>×</i><span>${num(keep.out.sc.mult*keep.out.sc.xm)}</span><i>=</i><b>${fmt(keep.out.sc.total)}</b></div>`:''}
    <ol class="board">${rows}</ol>${verdict}
    <button class="big" type="button" id="next">${btn}</button>`;
  veil.hidden=false;
  if(res.cleared||(!team&&ROOM.phase==='over'&&ROOM.over&&ROOM.over.winner===clientId())){sfx('fanfare');confetti()}
  $('next').onclick=()=>{sheet.className='sheet';
    if(next==='over'){showRoomOver();return}
    veil.hidden=true;show('hangar');setTab('build');
    if(ROOM&&ROOM.phase==='flight')onState(ROOM);
  };
}
function showRoomOver(){
  const R0=ROOM,r=R();if(!R0)return;
  const host=R0.host===clientId(),team=R0.mode==='team';
  const list=R0.players.slice().sort((a,b)=>(b.alive-a.alive)||(b.total-a.total));
  const win=team?R0.over&&R0.over.won:R0.over&&R0.over.winner===clientId();
  const wp=!team&&R0.over&&R0.players.find(p=>p.id===R0.over.winner);
  sheet.className='sheet endsheet '+(win?'win':'lose');
  sheet.innerHTML=`<span class="label">${team?'Team run':'Elimination'}</span>
    <h2>${team?(win?'Run complete!':'Run over'):(win?'You win!':wp?esc(roomName(wp))+' wins':'Game over')}</h2>
    ${team?`<p class="note">Contracts cleared: <b>${R0.over?R0.over.stage:r.stage} / ${CONTRACTS}</b></p>`:''}
    <ol class="board">${list.map((p,i)=>`<li class="${p.id===clientId()?'me':''}"><i>${i+1}</i><span>${esc(roomName(p))}</span><b>${fmt(p.total)}</b></li>`).join('')}</ol>
    ${host?'<button class="big" id="rAgain" type="button">Play again</button>':'<p class="hint">The host can start another game.</p>'}
    <button class="ghost" id="rLeave2" type="button">Leave room</button>`;
  veil.hidden=false;if(win){sfx('fanfare');confetti()}else sfx('sad');
  if($('rAgain'))$('rAgain').onclick=()=>NET.send({t:'again'});
  $('rLeave2').onclick=leaveRoom;
}

/* ================= sound wiring ================= */
const unlockAudio=()=>audio.unlock();
document.addEventListener('pointerup',unlockAudio,{capture:true});document.addEventListener('click',unlockAudio,{capture:true});
// a woody tap for plain buttons; buttons with their own sound (buy, launch, gifts) skip it
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled||b.matches('.buy,#launch,.boon,.pack,#bUp,#bDown,#bPop'))return;sfx('tap')},{capture:true});
function syncSound(){const b=$('hSound');b.classList.toggle('off',audio.muted);b.setAttribute('aria-label',audio.muted?'Sound off':'Sound on');b.setAttribute('aria-pressed',String(!audio.muted))}
$('hSound').onclick=()=>{audio.setMuted(!audio.muted);syncSound()};
syncSound();

// dev only: inspect the running flight from the console (stripped from production builds)
if(import.meta.env.DEV)window.__rf={F:()=>F,R,frame:n=>frame(n),ctl,tour:m=>showTour(R(),m),results:(o,S,f)=>showResults(o,S,f)}; // ctl: tools/ and dev pages drive flights (e.g. the trailer capture)

/* ---------- history: finished runs and puzzles ----------
   save.meta.history, newest first, at most HIST_MAX (it rides along in the cloud save). Each entry keeps the build, mods
   and tunings of the last flight, and the result: contract reached and best single flight for a run, total for a puzzle. */
const HIST_MAX=40;
function addHistory(r){
  if(!r||!r.log||!r.log.length)return;
  const s=r.log[r.log.length-1].s||{}, daily=r.mode==='daily';
  const e={k:daily?(r.ranked?'daily':'puzzle'):'run',t:Date.now(),cells:s.cells||'c22',mods:s.mods||[],tune:s.tune||{},flights:r.log.length};
  if(daily){e.day=r.day;e.total=r.total||r.score||0}
  else Object.assign(e,{lv:r.level||0,cleared:r.stage,endless:!!r.endless,best:Math.max(...r.log.map(l=>l.score)),town:townOf(r.seed,r.stage).town,lost:r.phase==='over'});
  const h=save.meta.history=save.meta.history||[];h.unshift(e);if(h.length>HIST_MAX)h.length=HIST_MAX;
}
// the craft cropped to its parts, drawn with the bench icons
function miniCraft(code){
  const cells=cellsOf(code),xs=cells.map(c=>c.c),ys=cells.map(c=>c.r),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0+1,h=Math.max(...ys)-y0+1;
  return `<div class="hcraft" style="grid-template-columns:repeat(${w},1fr);grid-template-rows:repeat(${h},1fr);width:${Math.min(132,w*26)}px">${cells.map(c=>
    `<img alt="" src="${ICON[c.type+(c.rare?'+':'')]}" style="grid-column:${c.c-x0+1};grid-row:${c.r-y0+1}">`).join('')}</div>`;
}
function histEntry(e){
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
function showHistory(){
  const h=save.meta.history||[];
  sheet.className='sheet';sheet.innerHTML=`<span class="label">History</span><div class="hlist">${h.map(histEntry).join('')}</div><button class="big" id="hOk" type="button">Close</button>`;
  veil.hidden=false;$('hOk').onclick=()=>{veil.hidden=true};
}

/* ---------- profile ---------- */
const PENCIL='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-5L16 4l4 4L9 19z M14 6l4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>';
const GEAR='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2 2.6 3.2-.6.7 3.2 2.9 1.5-1.4 3 1.4 3-2.9 1.5-.7 3.2-3.2-.6-2 2.6-2-2.6-3.2.6-.7-3.2-2.9-1.5 1.4-3-1.4-3 2.9-1.5.7-3.2 3.2.6z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
let AVATAR='';
function avatarURL(){if(AVATAR)return AVATAR;const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');
  g.translate(64,74);g.scale(92,92);drawPilot(g,'grin',0,{lw:.045});return AVATAR=c.toDataURL()}
function editName(){
  sheet.className='sheet';sheet.innerHTML=`<span class="label">Your name</span>
    <div class="namerow"><input id="pName" maxlength="16" placeholder="Pilot" autocomplete="nickname" value="${esc(save.meta.name||'')}"><button class="big" id="pOk" type="button">Save</button></div>
    <p class="hint">Shown on the daily leaderboard and in live rooms.</p><button class="ghost" id="pNo" type="button">Cancel</button>`;
  veil.hidden=false;const inp=$('pName');inp.focus();$('pNo').onclick=()=>{veil.hidden=true};
  const ok=()=>{const n=inp.value.trim().slice(0,16);if(!n){inp.focus();return}save.meta.name=n;persist();veil.hidden=true;renderTitle()};
  $('pOk').onclick=ok;inp.onkeydown=e=>{if(e.key==='Enter')ok()};
}
function showSettings(){
  sheet.className='sheet';sheet.innerHTML=`<span class="label">Your progress</span><p class="hint" id="cloudState">${cloudLabel()}</p>
    <div class="row2"><button class="ghost" id="cloudOut" type="button">Use on another device</button><button class="ghost" id="cloudIn" type="button">Enter a code</button></div>
    <button class="big" id="sOk" type="button">Done</button>`;
  veil.hidden=false;$('sOk').onclick=()=>{veil.hidden=true};$('cloudOut').onclick=showLinkCode;$('cloudIn').onclick=showClaim;
}

// a code for another device: it signs that device into this account (10 minutes, single use)
async function showLinkCode(){
  sheet.className='sheet';sheet.innerHTML=`<span class="label">Use on another device</span><h2 class="rcode" id="lcode">…</h2>
    <p class="hint">On the other device: Profile → ⚙ → Enter a code. Valid for 10 minutes.</p><button class="big" id="lOk" type="button">Done</button>`;
  veil.hidden=false;$('lOk').onclick=()=>{veil.hidden=true};
  try{await cloudPush();const {code}=await linkCode();if($('lcode'))$('lcode').textContent=code.slice(0,4)+'-'+code.slice(4)}
  catch(_){if($('lcode'))$('lcode').textContent='Offline'}
}
function showClaim(){
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

/* ================= boot ================= */
// moving house: the old address sends players to the new one, carrying their save in the URL fragment
if(MOVED&&OLD_HOSTS.includes(location.hostname)&&location.hostname!==new URL(MOVED).hostname){let p='';try{p=btoa(unescape(encodeURIComponent(JSON.stringify({save:localStorage.getItem(KEY),
  client:localStorage.getItem('rogueflight-client'),audio:localStorage.getItem('rogueflight-audio'),auth:localStorage.getItem('rogueflight-auth')}))))}catch(_){}location.replace(MOVED+'/'+location.search+(p?'#move='+p:''))}
show('title');renderTitle();
cloudStart();
// an invite link (?room=CODE) drops straight into that room's lobby
{const q=new URLSearchParams(location.search).get('room');if(q&&/^[A-Za-z]{4}$/.test(q)){history.replaceState(null,'',location.pathname);joinRoom(q.toUpperCase())}}
