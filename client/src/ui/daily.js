// Daily and random puzzles: the title card, starting, recording and sending a ranked score, the leaderboard.
import { getDaily, newRoomCode, postDaily } from '../net.js';
import { DAILY_COINS, FLIGHTS, dailyNumber, dailySeed, newRun } from '../sim.js';
import { CARD } from '../troupe.js';
import {
  $, clientId, confetti, esc, fmt, metaOf, notice, persist, plural, reportRun, runCode, save,
  sfx, sheet, show, ui, veil,
} from './core.js';
import { openHangar } from './hangar.js';
import { addHistory } from './profile.js';
import { runStats } from './results.js';
import { joinRoom, leaveRoom } from './rooms.js';
import { cardHead, renderTitle } from './title.js';

/* ================= daily puzzle ================= */
// one contract, three flights, 100 coins, no storms: the same seed for everyone each day, ranked on the first try.
// Random puzzles (any seed, unranked) open up after the first finished daily.
export function dailyCard(){
  const n=dailyNumber(),m=save.meta,d=save.daily,rec=(m.daily||{})[n];
  let t,b;
  if(d)t=`${d.ranked?'Daily #'+d.day:'Random puzzle'} · flight ${d.flight+1} of ${FLIGHTS} · score ${fmt(d.total)}`,b=`<button class="big alt" id="dCont" type="button">Continue puzzle</button>`;
  else if(rec)t=`Your score <b>${fmt(rec.score)}</b>${rec.rank?` · #${rec.rank} of ${rec.total}`:''}`,b=`<div class="row2"><button class="ghost" id="dBoard" type="button">Leaderboard</button><button class="ghost" id="dRandom" type="button">Random puzzle</button></div>`;
  else t=`${DAILY_COINS} coins · ${FLIGHTS} flights · no storms. Highest score wins.`,b=`<button class="big alt" id="dPlay" type="button">Play daily #${n}</button>${m.dailyEver?'<button class="ghost" id="dRandom" type="button">Random puzzle</button>':''}`;
  return `<div class="card stack">${cardHead(`Daily puzzle #${n}`,t,CARD.daily)}${b}</div>`;
}
export function bindModeCards(){
  const on=(id,f)=>{const b=$(id);if(b)b.onclick=f};
  on('dCont',()=>{ui.slot='daily';ui.tab='build';openHangar()});
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
export function startPuzzle(ranked){
  const n=dailyNumber();
  const r=newRun(0,metaOf({mode:'daily'}),{mode:'daily',seed:ranked?dailySeed(n):undefined});
  r.ranked=ranked;r.day=n;save.daily=r;ui.slot='daily';persist();ui.tab='build';ui.sel='wing';openHangar();
}
// the third flight is in: record it (and send it, if ranked) before the player even sees the tally
export function completeDaily(r){
  const m=save.meta;
  if(r.ranked){m.daily=m.daily||{};m.daily[r.day]={score:r.total};m.dailyEver=true;
    const keys=Object.keys(m.daily).map(Number).sort((a,b)=>b-a);for(const k of keys.slice(7))delete m.daily[k];
    m.dailyPending={day:r.day,score:r.total,data:JSON.parse(runCode(r))}}
  persist();
}
// a ranked score waits in meta.dailyPending until the server has it (offline phones send it later)
export async function retryDaily(){
  const p=save.meta.dailyPending;if(!p||!save.meta.name||retryDaily.busy)return null;retryDaily.busy=true;
  try{const res=await postDaily({...p,client:clientId(),name:save.meta.name});save.meta.dailyPending=null;
    const rec=(save.meta.daily||{})[p.day];if(rec&&res.me){rec.rank=res.me.rank;rec.total=res.total}persist();return res}
  catch(_){return null}finally{retryDaily.busy=false}
}
export function boardHTML(res){
  if(!res||!res.top.length)return '<p class="hint">No scores yet.</p>';
  const mine=res.me&&res.top.findIndex(t=>t.name===res.me.name&&t.score===res.me.score);
  return `<ol class="board">${res.top.map((t,i)=>`<li class="${i===mine?'me':''}"><i>${i+1}</i><span>${esc(t.name)}</span><b>${fmt(t.score)}</b></li>`).join('')}</ol>
    ${res.me?`<p class="hint">You: #${res.me.rank} of ${res.total}</p>`:`<p class="hint">${plural(res.total,'pilot')}</p>`}`;
}
export async function showBoard(day){
  sheet.className='sheet';
  sheet.innerHTML=`<span class="label">Daily puzzle #${day}</span><h2>Leaderboard</h2><div id="bBox"><p class="hint">Loading…</p></div><button class="big" id="bOk" type="button">Close</button>`;
  veil.hidden=false;$('bOk').onclick=()=>{veil.hidden=true;renderTitle()};
  try{const res=await getDaily(day,clientId());const rec=(save.meta.daily||{})[day];if(rec&&res.me){rec.rank=res.me.rank;rec.total=res.total;persist()}
    if($('bBox'))$('bBox').innerHTML=boardHTML(res)}
  catch(_){if($('bBox'))$('bBox').innerHTML='<p class="hint warn">Could not load the leaderboard.</p>'}
}
// the end of a puzzle: the total, then (ranked) a name and the leaderboard
export function showDailyEnd(){
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
export function leaveMode(){
  if(ui.slot==='daily'){const r=save.daily;if(r&&r.ranked&&r.log.length&&r.phase!=='done'){r.phase='done';completeDaily(r)}if(r&&r.phase!=='done')reportRun(r,true);addHistory(r);save.daily=null}
  else if(ui.slot==='online'){leaveRoom();return}
  ui.slot='run';persist();veil.hidden=true;ui.armAbandon=false;show('title');renderTitle();
}
