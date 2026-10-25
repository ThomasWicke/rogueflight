// Wingnut Circus UI entry: loads every screen module in ./ui/, connects core's hooks, wires the sound button, boots.
// core.js loads first and imports no other ui module; every other module only defines functions and binds its own
// buttons at load time, so the screens can import each other freely (see "UI modules" in CLAUDE.md).
import { $, KEY, MOVED, OLD_HOSTS, R, cloudStart, hooks, sfx, show } from './ui/core.js';
import { audio } from './audio.js';
import { F, ctl, frame } from './ui/flight.js';
import { renderHangar, showTour } from './ui/hangar.js';
import { showResults } from './ui/results.js';
import { joinRoom } from './ui/rooms.js';
import { renderTitle } from './ui/title.js';
import './ui/shop.js';
import './ui/library.js';
import './ui/rewards.js';
import './ui/daily.js';
import './ui/profile.js';

// core.js calls back into the screens through these (cloud save: skip uploads mid-flight, redraw after adopting a save)
hooks.flying=()=>!!F;
hooks.refresh=()=>{if(!$('title').hidden)renderTitle();else if(!$('hangar').hidden&&R())renderHangar()};

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

/* ================= boot ================= */
// moving house: the old address sends players to the new one, carrying their save in the URL fragment
if(MOVED&&OLD_HOSTS.includes(location.hostname)&&location.hostname!==new URL(MOVED).hostname){let p='';try{p=btoa(unescape(encodeURIComponent(JSON.stringify({save:localStorage.getItem(KEY),
  client:localStorage.getItem('rogueflight-client'),audio:localStorage.getItem('rogueflight-audio'),auth:localStorage.getItem('rogueflight-auth')}))))}catch(_){}location.replace(MOVED+'/'+location.search+(p?'#move='+p:''))}
show('title');renderTitle();
cloudStart();
// an invite link (?room=CODE) drops straight into that room's lobby
{const q=new URLSearchParams(location.search).get('room');if(q&&/^[A-Za-z]{4}$/.test(q)){history.replaceState(null,'',location.pathname);joinRoom(q.toUpperCase())}}
