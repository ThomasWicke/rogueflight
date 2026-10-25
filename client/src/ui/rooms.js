// Live rooms (Team and Elimination): joining, the lobby, room state from the server, ghosts of the other pilots,
// bots flown on every phone, spectating, and the round / game results.
import { KINS } from '../art.js';
import { botFlight, cellsOf, planBot } from '../bots.js';
import { townOf } from '../fiction.js';
import { connectRoom } from '../net.js';
import {
  CONTRACTS, FLIGHTS, ONLINE_TIME, SIM_DT, WEATHER, clearContract, isOnline, makeCraft, newFlight, newRun, popBalloons, scoreFlight,
  settleFlight, severity, stats, step, summaryOf, weatherFx,
} from '../sim.js';
import { CARD } from '../troupe.js';
import {
  $, R, cellCodeOf, clientId, confetti, curWx, esc, fmt, fmtD, homeURL, kinFace, metaOf,
  notice, num, persist, plural, reportRun, save, sfx, sheet, show, ui, veil,
} from './core.js';
import { F, dropFlight, pilotMood, startFlight, toast } from './flight.js';
import { openHangar, renderHangar, renderStrip, routeStrip, setTab } from './hangar.js';
import { cardHead, renderTitle } from './title.js';

export function roomCard(){
  if(save.room)return `<div class="card stack">${cardHead('Play with friends',`Room <b>${esc(save.room)}</b>`,CARD.rooms)}<button class="big alt" id="rRejoin" type="button">Rejoin room</button><button class="ghost" id="rQuit" type="button">Leave room</button></div>`;
  return `<div class="card stack">${cardHead('Play with friends','',CARD.rooms)}<button class="big alt" id="rNew" type="button">Create room</button>
    <div class="joinrow"><input id="rCode" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code"><button class="ghost" id="rJoin" type="button">Join</button></div></div>`;
}
/* ================= live rooms ================= */
// Everyone in a room plays the same seed and launches together. Each phone flies its own craft and streams its
// position; the others appear as ghosts. After landing you watch whoever is still flying.
export let NET=null, ROOM=null;
export const ghosts=new Map();
export const me=()=>ROOM&&ROOM.players.find(p=>p.id===clientId());
export const isBotP=p=>p&&p.bot>=0;
// in a room every pilot is a different animal with its own scarf colour, by seat (join order), the same on every phone
export const kinOf=id=>{const i=ROOM?ROOM.players.findIndex(p=>p.id===id):-1;return i<0?0:i%KINS.length};
export function joinRoom(code){
  if(NET&&NET.code!==code){NET.close();NET=null}
  if(save.room!==code){save.room=code;if(save.online&&save.online.room!==code)save.online=null;persist()}
  if(!NET)NET=connectRoom(code,clientId(),save.meta.name||'Pilot',{onState,onPos,onDone:onGhostDone,
    onError:msg=>{if(!ROOM||ROOM.phase==='lobby'&&!me()){leaveRoom();notice(msg)}},
    onStatus:ok=>{document.body.classList.toggle('offline',!ok)}});
  ui.slot='online';
  if(!ROOM)lobbyLoading();
}
export function leaveRoom(){
  if(NET){NET.close();NET=null}
  reportRun(save.online,true);
  ROOM=null;ghosts.clear();save.room=null;save.online=null;ui.slot='run';persist();
  if(F&&F.online)dropFlight();
  document.body.classList.remove('offline');veil.hidden=true;sheet.className='sheet';show('title');renderTitle();
}
export function lobbyLoading(){sheet.className='sheet';sheet.innerHTML=`<span class="label">Room ${esc(save.room||'')}</span><p class="hint">Connecting…</p><button class="ghost" id="rCancel" type="button">Cancel</button>`;veil.hidden=false;$('rCancel').onclick=leaveRoom}
export const roomName=p=>isBotP(p)?p.name+' (bot)':p.name;
export function onState(room){
  ROOM=room;
  if(room.phase==='lobby'){
    if(save.online){reportRun(save.online,true);save.online=null;persist()}
    if(F&&F.online)dropFlight();
    show('title');showLobby();return;
  }
  // a run for this room: everyone starts from the room's seed
  let r=save.online;
  if(!r||r.seed!==room.seed||r.room!==room.code){r=save.online=newRun(0,metaOf({mode:room.mode}),{mode:room.mode,seed:room.seed});r.room=room.code;r.applied=0;r.shown=0;persist()}
  ui.slot='online';
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
  if(!$('title').hidden){veil.hidden=true;ui.tab='build';openHangar();return}
  if(!$('hangar').hidden)renderRoomBits();
}
// a room update while building: only the poster and the ready button change (a full redraw would break a drag)
export function renderRoomBits(){const r=R();if(!r||!isOnline(r))return;renderStrip();$('launch').textContent=readyLabel();$('launch').disabled=!me()||!me().alive}
// the room's verdict on a round, applied to this phone's run once (results carry a round number)
export function applyRound(r,res){
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
export function showLobby(){
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
export function roomStrip(r){
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
export function readyLabel(){const R0=ROOM,m=me();if(!R0||!m)return 'READY';if(!m.alive)return 'OUT · WATCHING';const act=R0.players.filter(p=>p.alive&&p.connected),n=act.filter(p=>p.ready).length;
  return m.ready?`WAITING ${n}/${act.length}`:'READY'}
export function toggleReady(){const m=me(),r=R();if(!m||!ROOM||ROOM.phase!=='build'||!m.alive)return;NET.send({t:'ready',ready:!m.ready,cells:r.cells});sfx(m.ready?'tap':'buy')}

// position updates from the others: kept with their arrival time and extrapolated a little when drawn
export function onPos(m){let g=ghosts.get(m.id);if(!g){g={};ghosts.set(m.id,g)}
  Object.assign(g,{x:m.x,y:m.y,th:m.th,vx:m.vx||0,vy:m.vy||0,s:m.s||0,on:m.on,mood:m.mood,at:performance.now(),round:ROOM?ROOM.round:0});
  if(g.dx==null){g.dx=m.x;g.dy=m.y;g.dth=m.th}
  if(m.k&&m.k!==g.code){g.code=m.k;try{g.K=makeCraft(cellsOf(m.k),ghostSt())}catch(_){g.K=null}}}
export function onGhostDone(m){const g=ghosts.get(m.id);if(g){g.done=true;g.last=m.last}
  if(F&&F.online){const p=ROOM&&ROOM.players.find(q=>q.id===m.id);if(p&&m.id!==clientId())toast(`${roomName(p)}: ${fmt(m.last.score)}`,m.last.crashed?'crashed':m.last.landed?'landed':'');F.roundScores[m.id]=m.last.score;updSpec()}}
export let GST=null;const ghostSt=()=>GST||(GST=stats({},{},weatherFx(null,0)));

export function startOnlineFlight(room){
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
export function finishOnline(){
  if(F.settled)return;F.settled=true;
  const r=R(),{S}=F,K=F.K,f=summaryOf(S,K);
  const out=settleFlight(r,metaOf(r),f);persist();reportRun(r,false);
  F.myOut=out;F.myF=f;F.roundScores[clientId()]=out.sc.total;
  NET.send({t:'done',score:out.sc.total,dist:f.dist,crashed:!!S.crashed,landed:!!S.landed});
  $('flight').classList.add('watching');updSpec();
}
export function stepBots(n){
  if(!F.bots)return;F.botT+=n*SIM_DT;
  for(const b of F.bots){if(!b.ctl||b.S.done)continue;
    // fly the bot up to the room's flight time (more steps than n if it was planned late)
    for(let k=0;k<2400&&!b.S.done&&b.S.t<F.botT;k++){step(b.S,b.K,b.st,SIM_DT,b.ctl(b.S));if(b.S.burst&&!b.S.popped)b.K=popBalloons(b.S,b.K,b.st)}
    if(b.S.done){const sc=scoreFlight(summaryOf(b.S,b.K),b.ctx).total;b.score=sc;F.roundScores[b.id]=sc;
      NET.send({t:'bot',id:b.id,round:F.round,score:sc,dist:b.S.x,crashed:!!b.S.crashed,landed:!!b.S.landed});updSpec()}}
}
export function sendPos(dt){
  const S=F.S;if(S.done||F.pre>0)return;F.sendT-=dt;if(F.sendT>0)return;F.sendT=.1;F.sent++;
  const m={t:'pos',s:F.live||0,x:+S.x.toFixed(2),y:+S.y.toFixed(2),th:+S.th.toFixed(3),vx:+S.vx.toFixed(2),vy:+S.vy.toFixed(2),on:!!(S.propOn||S.rocketOn),mood:pilotMood()};
  if(F.sent%20===1)m.k=cellCodeOf(R().cells);
  NET.send(m);
}
// everything airborne except me: other players (ghosts) and bots, as {id,name,x,y,th,vx,vy,K,on,mood,done}
export function flyers(){
  const out=[],now=performance.now();
  for(const [id,g] of ghosts){if(g.x==null||!g.K)continue;const p=ROOM&&ROOM.players.find(q=>q.id===id);if(!p)continue;
    const k=g.done?0:Math.min(.4,(now-g.at)/1000),tx=g.x+g.vx*k,ty=g.y+g.vy*k;
    g.dx+=(tx-g.dx)*.35;g.dy+=(ty-g.dy)*.35;g.dth+=(g.th-g.dth)*.35;
    out.push({id,name:p.name,s:g.done&&g.last?g.last.score:g.s||0,x:g.dx,y:Math.max(0,g.dy),th:g.dth,vx:g.vx,vy:g.vy,K:g.K,on:g.on&&!g.done,mood:g.mood||'idle',done:g.done})}
  for(const b of F.bots||[])out.push({id:b.id,name:b.name,s:b.score!=null?b.score:scoreFlight(summaryOf(b.S,b.K),b.ctx).total,x:b.S.x,y:b.S.y,th:b.S.th,vx:b.S.vx,vy:b.S.vy,K:b.K,on:!b.S.done&&(b.S.propOn||b.S.rocketOn),mood:b.S.crashed?'crash':'focus',done:b.S.done,bot:true});
  return out;
}
// who the camera follows once I'm down: the chosen pilot if still flying, else the one furthest along
export function focusOf(list){
  const live=list.filter(f=>!f.done);if(!live.length)return null;
  const f=live.find(f=>f.id===F.focus)||live.slice().sort((a,b)=>b.x-a.x)[0];F.focus=f.id;return f;
}
export function updSpec(){
  const el=$('fSpec');if(!F||!F.online){el.hidden=true;return}
  if(!F.settled&&!F.watch){el.hidden=true;return}
  const list=F.fl||flyers(),fo=focusOf(list),mine=F.myOut?`Your score <b>${fmt(F.myOut.sc.total)}</b>`:'Watching';
  el.hidden=false;
  el.innerHTML=`<span>${mine}</span>${fo?`<button type="button" id="specNext">${list.filter(f=>!f.done).length>1?'◂ ▸ ':''}${esc(fo.name)} · ${fmtD(Math.max(0,fo.x))}</button>`:'<span>Waiting for the others…</span>'}`;
  const b=$('specNext');if(b)b.onclick=()=>{const live=list.filter(f=>!f.done);if(live.length<2)return;const i=live.findIndex(f=>f.id===(fo&&fo.id));F.focus=live[(i+1)%live.length].id;updSpec()};
}
export function endOnlineFlight(){
  if(!F)return;if(!F.settled&&!F.watch)finishOnline();
  const keep={out:F.myOut,f:F.myF,S:F.S,scores:F.roundScores};dropFlight();$('flight').classList.remove('watching');$('fSpec').hidden=true;
  show('hangar');renderHangar();showRound(keep);
}
// the round's results: my own tally (if I flew) plus everyone's scores, then the room's verdict
export function showRound(keep){
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
      (res.cleared?`<div class="soldout">Contract cleared!${r.lastClear?` <small>+${r.lastClear.reward} coins</small>`:''}</div>`:res.failed?'<p class="tres warn">No flights left</p>':`<p class="tres">${fmt(q-res.teamScore)} to target · ${plural(FLIGHTS-res.flight,'flight')} left</p>`);
    if(ROOM.phase==='over'){btn='Run summary';next='over'}
  }else{
    const iOut=outIds.includes(clientId()),win=ROOM.phase==='over'&&ROOM.over&&ROOM.over.winner===clientId();
    verdict=win?'<div class="soldout">You win!</div>':iOut?'<p class="tres warn">You are out</p>':r.out?'':`<p class="tres">You made the cut${r.lastClear?` · +${r.lastClear.reward} coins`:''}</p>`;
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
export function showRoomOver(){
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
