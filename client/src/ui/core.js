// Shared by every screen: the save (localStorage + cloud sync), screen state (ui), formatting, part icons, the
// sheet/veil modal, telemetry, sound and haptics helpers. Imports no other ui module (screens reach back through hooks).
import { drawParachute, drawPart, drawPilot } from '../art.js';
import { audio } from '../audio.js';
import { decalURL } from '../decals.js';
import { cloudGet, cloudPut } from '../net.js';
import { CONTRACTS, PARTS, RARE, WEATHER, dropRemovedMods, flightStats, modLevels, weatherOf } from '../sim.js';

/* ================= persistence ================= */
export const KEY='rogueflight-1'; // storage keys keep the game's original id (RogueFlight) so saves survive the rename
export const META0={runs:0,wins:0,bestStage:0,bestFlight:0,deepest:0,level:0};
// save.run: the main run; save.daily: a daily or random puzzle in progress; save.online: the run of the live room save.room
// arriving from the old address (see MOVED): take over the save (and the cloud-save login, so the device stays on its
// account) handed over in the URL fragment, unless this browser already has one here. The fragment never reaches any server.
{const m=location.hash.match(/^#move=(.+)$/);if(m){try{const d=JSON.parse(decodeURIComponent(escape(atob(m[1]))));
  for(const [k,v] of [[KEY,d.save],['rogueflight-client',d.client],['rogueflight-audio',d.audio],['rogueflight-auth',d.auth]])if(v&&!localStorage.getItem(k))localStorage.setItem(k,v)}catch(_){}
  history.replaceState(null,'',location.pathname+location.search)}}
// t: when this device last changed the save (cloud sync keeps the newer copy); cloud.rev: the server's revision we hold
export let save=(()=>{try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&s.meta)return {meta:{...META0,...s.meta},run:s.run||null,daily:s.daily||null,online:s.online||null,room:s.room||null,t:s.t||0,cloud:s.cloud||{rev:0}}}catch(e){}return {meta:{...META0},run:null,daily:null,online:null,room:null}})();
// mods taken out of the game are removed (and refunded) from saved runs
for(const k of ['run','daily','online'])dropRemovedMods(save[k]);
if(save.daily&&save.daily.phase==='done')save.daily=null;
export function persist(){save.t=Date.now();store();cloudSoon()}
export const store=()=>{try{localStorage.setItem(KEY,JSON.stringify(save))}catch(e){}};

/* ---------- cloud save ----------
   The save also lives on the game server under this player's guest account (net.js, server/accounts.js), so it survives
   updates, new addresses, reinstalls (with a link code) and new devices. A few seconds after a change, and when the app
   goes to the background, it is uploaded; on start the newer copy (device or cloud) wins. Rooms stay on this device. */
export const CLOUD={state:'idle',timer:0,busy:false,again:false};
export const cloudCopy=()=>({meta:save.meta,run:save.run,daily:save.daily});
export const hasProgress=s=>!!(s&&(s.run||s.daily||(s.meta&&(s.meta.runs||s.meta.bestFlight||s.meta.dailyEver))));
export function cloudSoon(ms=4000){clearTimeout(CLOUD.timer);CLOUD.timer=setTimeout(()=>cloudPush(),ms)}
export function setCloud(st){CLOUD.state=st;const el=document.getElementById('cloudState');if(el)el.textContent=cloudLabel()}
export const cloudLabel=()=>({ok:'Saved to the cloud ✓',saving:'Saving…',off:'Offline: saved on this device',idle:'Connecting…'})[CLOUD.state]||'';
// take the cloud's save: it replaces this device's progress (rooms and the current flight stay as they are)
export function adoptCloud(data,rev,t){
  save={...save,meta:{...META0,...(data.meta||{})},run:data.run||null,daily:data.daily||null,t:t||Date.now(),cloud:{rev}};
  dropRemovedMods(save.run);dropRemovedMods(save.daily);
  if(ui.slot!=='online')ui.slot='run';store();
  hooks.refresh();
}
export async function cloudPush(keepalive){
  if(CLOUD.busy){CLOUD.again=true;return}
  if(hooks.flying()&&!keepalive){cloudSoon(3000);return} // not mid-flight: the frame loop has the stage
  CLOUD.busy=true;setCloud('saving');
  try{
    let r=await cloudPut(cloudCopy(),save.cloud.rev,save.t,keepalive);
    if(r.status===409){
      // another device saved meanwhile: the newer copy wins
      if((r.t||0)>save.t&&!hooks.flying()){adoptCloud(r.save||{},r.rev,r.t);setCloud('ok');return}
      r=await cloudPut(cloudCopy(),r.rev,save.t,keepalive);
    }
    if(r.rev){save.cloud={rev:r.rev};store();setCloud('ok')}else setCloud('off');
  }catch(_){setCloud('off');cloudSoon(30000)}
  finally{CLOUD.busy=false;if(CLOUD.again){CLOUD.again=false;cloudSoon(500)}}
}
// on start: compare with the cloud copy and keep the newer one
export async function cloudStart(){
  try{
    const c=await cloudGet();
    if(c.save&&(!hasProgress(save)||(c.t||0)>save.t))adoptCloud(c.save,c.rev,c.t);
    else{save.cloud={rev:c.rev||0};store();if(hasProgress(save))await cloudPush();}
    setCloud('ok');
  }catch(_){setCloud('off');setTimeout(cloudStart,60000)}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&save.t>0){clearTimeout(CLOUD.timer);cloudPush(true)}});

/* ================= formatting ================= */
export const SUF=['','k','M','B','T','Qa','Qi','Sx','Sp','Oc','No','Dc'];
export function fmt(n){n=Math.floor(n);if(n<1e4)return n.toLocaleString('en-US');let i=0,x=n;while(x>=1000&&i<SUF.length-1){x/=1000;i++}if(x>=1000)return n.toExponential(2).replace('+','');return (x<10?x.toFixed(2):x<100?x.toFixed(1):x.toFixed(0))+SUF[i]}
export function fmtD(m){if(m<1000)return Math.floor(m)+' m';const km=m/1000;if(km<1000)return (km<10?km.toFixed(2):km<100?km.toFixed(1):km.toFixed(0))+' km';return fmt(km)+' km'}
export function fmtV(v){const kmh=v*3.6;return (kmh<1e4?Math.round(kmh).toLocaleString('en-US'):fmt(kmh))+' km/h'+(v>343?' · Mach '+(v/343<100?(v/343).toFixed(1):fmt(v/343)):'')}
export const mul=x=>x>=1000?fmt(x):x>=10?x.toFixed(1):x.toFixed(2);
export const num=x=>{const r=Math.round(x*100)/100;return (r>=100?fmt(r):String(r))};
export const plural=(n,w)=>n+' '+w+(n===1?'':'s');

/* ================= part drawing (art.js) ================= */
export const ICON={};
// icons for every part, and for the rare variants ('wing+' etc.), which art.js draws with brass trim
for(const t of [...Object.keys(PARTS),...Object.keys(RARE).map(k=>k+'+')]){const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d');g.translate(48,48);g.scale(96,96);drawPart(g,t,.33,{frac:.7,lw:.055});ICON[t]=c.toDataURL()}
// the cockpit with another animal pilot (live rooms), and that pilot's face for player lists
export const KICON={},KFACE={};
export const kinIcon=k=>KICON[k]||(KICON[k]=(()=>{const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d');g.translate(48,48);g.scale(96,96);drawPart(g,'cockpit',.33,{lw:.055,kin:k});return c.toDataURL()})());
export const kinFace=k=>KFACE[k]||(KFACE[k]=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.translate(32,37);g.scale(46,46);drawPilot(g,'idle',0,{lw:.05,kin:k,scarf:.4});return c.toDataURL()})());
// a part on the bench as its inventory key: rare ones are 'wing+' etc.
export const keyOf=c=>c.rare?c.type+'+':c.type;
// the compact cell code used for telemetry and ghosts: type initial + column + row, upper case for rare parts
export const cellCodeOf=cells=>cells.map(c=>{const l=c.type==='cockpit'?'c':c.type[0];return (c.rare?l.toUpperCase():l)+c.c+c.r}).join(' ');

export const $=id=>document.getElementById(id);
export const veil=$('veil'), sheet=$('sheet'), bench=$('bench');
export const THEME=document.querySelector('meta[name=theme-color]'),THEME0=THEME&&THEME.content;
export const themeTint=c=>{if(THEME)THEME.content=c};
export function show(id){for(const s of ['title','hangar','flight'])$(s).hidden=s!==id;if(id!=='flight')themeTint(THEME0);audio.music(id==='title'?'title':id==='hangar'?'hangar':'flight');if(id!=='hangar'){const d=$('dealer');d.classList.remove('open');d.hidden=true;ui.tab='build'}}
// which run the hangar and flight are showing: 'run', 'daily' or 'online'
// screen state shared by the ui modules (one object, so any module can change it): which run the hangar and flight
// show (slot: 'run', 'daily' or 'online'), the hangar tab ('build', 'shop', 'mods'), the selected palette part (sel),
// whether an Abandon button is armed and which mod's Sell button is armed (the second tap confirms)
export const ui={slot:'run',tab:'build',sel:'wing',armAbandon:false,armSell:null};
// calls from core into the screens, filled in by ui.js at boot, so core.js imports no other ui module
export const hooks={flying:()=>false,refresh:()=>{}};
export const R=()=>save[ui.slot];
// puzzles and rooms use the same shop pool for everyone (all unlocks), and never touch the player's records
export const metaOf=r=>r&&r.mode&&r.mode!=='run'?{bestStage:CONTRACTS,level:0}:save.meta;
export const esc=t=>String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function runCode(r){if(!r)return '';const L=t=>t==='cockpit'?'c':t[0];
  return JSON.stringify({lvl:r.level,cleared:r.stage,boons:r.boons||{},endless:!!r.endless,coins:r.coins,mods:r.mods.map(id=>{const L=modLevels(r)[id];return L>1?id+':'+L:id}),tune:r.tune,inv:r.inv,
    cells:cellCodeOf(r.cells),log:r.log.map(l=>[l.stage+1,l.flight,l.score,l.d,l.x,l.s||null]),ev:r.ev||[]})}
// telemetry: after every flight and when a run ends, the run goes to /api/run (a Pages Function storing it in D1, one row
// per run, updated in place) for balancing. Each flight carries a snapshot (build, score lines, height, speed, how it
// ended); ev lists purchases, sales, rerolls, packs and storm rewards. Anonymous: a random id per browser and the run code.
// Production builds only.
// the game's home: copies hosted elsewhere (itch.io, a future app) send telemetry and invite links here
// HOME: where copies hosted elsewhere (itch.io) send telemetry and invite links. MOVED: once wingnut-circus.com serves
// the game, set it here; the old addresses (OLD_HOSTS) then send players over with their save
export const HOME='https://wingnut-circus.com', MOVED='https://wingnut-circus.com', OLD_HOSTS=['rogueflight.pages.dev','wingnut-circus.pages.dev','www.wingnut-circus.com'],
  ATHOME=/(^|\.)rogueflight\.pages\.dev$|(^|\.)wingnut-circus\.pages\.dev$|(^|\.)wingnut-circus\.com$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
export const homeURL=p=>(ATHOME?location.origin:HOME)+p;
export function clientId(){try{let id=localStorage.getItem('rogueflight-client');if(!id){id=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('rogueflight-client',id)}return id}catch(_){return ''}}
export function reportRun(r,finished){
  if(!import.meta.env.PROD||!r||!r.log.length)return;
  try{const data={...JSON.parse(runCode(r)),weather:r.weather,seed:r.seed};const mode=r.mode||'run';
    // beacons cap at 64 KB: very long endless runs keep snapshots for their last 100 flights only
    if(JSON.stringify(data).length>55000)data.log=data.log.map((l,i,a)=>i<a.length-100?l.slice(0,5):l);
    const body=JSON.stringify({client:clientId(),run_id:clientId()+':'+mode+':'+r.seed,mode,version:__VERSION__+'+'+__BUILD__,level:r.level,cleared:r.stage,endless:!!r.endless,
      won:mode==='run'||mode==='team'?r.stage>=CONTRACTS:false,host:import.meta.env.MODE==='itch'?'itch':location.hostname,flights:r.log.length,finished:!!finished,data});
    const url=homeURL('/api/run');if(!(navigator.sendBeacon&&navigator.sendBeacon(url,body)))fetch(url,{method:'POST',body,keepalive:true,mode:ATHOME?'same-origin':'no-cors'}).catch(()=>{})}catch(_){}
}
export const curWx=()=>weatherOf(R(),R().stage);
export const curStats=()=>flightStats(R());
// one small pictogram per storm, drawn in the text colour
export const WXI={headwind:'<path d="M3 8h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h7"/>',
  ceiling:'<path d="M7 14.5a4 4 0 0 1 .4-8A5 5 0 0 1 17 8a3.3 3.3 0 0 1 0 6.5z"/><path d="M12.5 15l-2.2 3.6h3L11 22"/>',
  thin:'<path d="M2.5 19l6.5-10 4 6 2.5-3.2L21.5 19z"/><path d="M5 5h.01M10 3.5h.01M17 5.5h.01"/>',
  gusts:'<path d="M3 9c2.5-3.5 5 3.5 7.5 0s5 3.5 7.5 0c1-1.4 2-1.4 3 0M3 15.5c2.5-3.5 5 3.5 7.5 0s5 3.5 7.5 0"/>',
  cargo:'<path d="M3.5 6.5h17v11h-17z"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  ration:'<path d="M7 4h7l4 4v12.5H7z"/><path d="M7 13.5h11"/><path d="M10 7.5h4"/>',
  short:'<path d="M3 19.5l8.5-7M14 10.5l2.5-2"/><path d="M3 19.5h18M6 19.5v-2"/>'};
export const wxIcon=id=>WXI[id]?`<svg class="wxi" viewBox="0 0 24 24" aria-hidden="true">${WXI[id]}</svg>`:'';
export function wxLine(id,s){return `<div class="wx"><b>${WEATHER[id].name}</b>${WEATHER[id].d(s)}</div>`}
// iOS home-screen apps can keep the portrait 100dvh after the phone turns, so sheets sized from it ran off a landscape
// screen: measure the height instead (--app-h; the CSS falls back to 100dvh)
export const setAppH=()=>document.documentElement.style.setProperty('--app-h',window.innerHeight+'px');setAppH();
window.addEventListener('resize',setAppH);window.addEventListener('orientationchange',()=>{setAppH();setTimeout(setAppH,350)});if(window.visualViewport)visualViewport.addEventListener('resize',setAppH);
export const reduceMotion=()=>window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
// sound hook: the audio module plugs in here (audio.js); every call is optional so the game runs silent without it
export let AUDIO=audio, DECAL=decalURL, ART={drawParachute};
export const sfx=(n,o)=>{try{AUDIO&&AUDIO.sfx(n,o)}catch(_){}};
// haptics only after the player has really touched the page (browsers refuse vibration before that)
export const buzz=p=>{try{const ua=navigator.userActivation;if(navigator.vibrate&&(!ua||ua.hasBeenActive))navigator.vibrate(p)}catch(_){}};
// paper confetti over the sheet for a sold-out show
export function confetti(){
  if(reduceMotion())return;
  const box=document.createElement('div');box.className='confetti';document.body.appendChild(box);
  const cols=['#d2402f','#e9a93b','#3b9aa6','#fbf5e8','#4fa35b','#7a4fa0'];
  for(let i=0;i<60;i++){const c=document.createElement('i');c.style.background=cols[i%cols.length];c.style.left=Math.random()*100+'%';
    const dx=(Math.random()-.5)*160,rot=Math.random()*720-360,d=1400+Math.random()*1200;box.appendChild(c);
    c.animate([{transform:'translate(0,-20px) rotate(0)',opacity:1},{transform:`translate(${dx}px,${window.innerHeight*.9}px) rotate(${rot}deg)`,opacity:.9}],{duration:d,delay:Math.random()*300,easing:'cubic-bezier(.3,.6,.5,1)',fill:'forwards'})}
  setTimeout(()=>box.remove(),3200);
}
export function notice(msg){sheet.className='sheet';sheet.innerHTML=`<p class="note">${esc(msg)}</p><button class="big" id="nOk" type="button">OK</button>`;veil.hidden=false;$('nOk').onclick=()=>{veil.hidden=true}}
