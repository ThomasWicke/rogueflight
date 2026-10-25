// The flight screen: input (buttons, throttle, keyboard), the frame loop that steps the sim, drawing the craft,
// coins, particles and other pilots over drawWorld, the HUD, and settling the flight when it ends.
import { drawPart } from '../art.js';
import { audio } from '../audio.js';
import { townOf } from '../fiction.js';
import {
  COINR, COINSEG, SIM_DT, WEATHER, altBonus, altReached, clamp, coinAt, distBonus, distReached, flightCtx, kick,
  landingShare, makeCraft, modVal, newFlight, popBalloons, quotaFor, repeats, scoreFlight, settleFlight, step, summaryOf, trickVal,
} from '../sim.js';
import { drawGrain, drawWorld } from '../world.js';
import {
  $, ART, R, buzz, clientId, curStats, curWx, fmt, fmtD, fmtV, metaOf, num,
  persist, reduceMotion, reportRun, save, setAppH, sfx, show, themeTint, wxIcon,
} from './core.js';
import { completeDaily } from './daily.js';
import { showResults } from './results.js';
import { ROOM, finishOnline, flyers, focusOf, kinOf, sendPos, stepBots, updSpec } from './rooms.js';

/* ================= flight ================= */
export const cv=$('cv'), ctx=cv.getContext('2d');
export let F=null, dpr=1, vw=0, vh=0, raf=0, last=0, RES=0;
export const ctl={pitch:0,boost:false,throttle:1};
export function resize(){const r=cv.getBoundingClientRect();vw=r.width;vh=r.height;dpr=Math.min(window.devicePixelRatio||1,2);cv.width=Math.round(vw*dpr);cv.height=Math.round(vh*dpr);
  RES=reserveTop()}
// --reserve is env(safe-area-inset-top), which getPropertyValue cannot resolve, so measure it with a probe
export function reserveTop(){const p=document.createElement('div');p.style.cssText='position:fixed;top:0;height:0;visibility:hidden;padding-top:var(--reserve)';document.body.appendChild(p);const v=parseFloat(getComputedStyle(p).paddingTop)||0;p.remove();return v}
window.addEventListener('resize',()=>{if(F)resize()});
export function hold(id,on,off){const b=$(id);
  const dn=e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId)}catch(_){}b.classList.add('held');on()};
  const up=()=>{b.classList.remove('held');off()};
  b.addEventListener('pointerdown',dn);['pointerup','pointercancel','lostpointercapture'].forEach(t=>b.addEventListener(t,up));
  b.addEventListener('contextmenu',e=>e.preventDefault());}
hold('bUp',()=>ctl.pitch=1,()=>{if(ctl.pitch===1)ctl.pitch=0});
hold('bDown',()=>ctl.pitch=-1,()=>{if(ctl.pitch===-1)ctl.pitch=0});
// throttle: one slider for every engine
export function setThr(v){ctl.throttle=clamp(Math.round(v*100)/100,0,1);const p=Math.round(ctl.throttle*100);
  $('thrFill').style.height=p+'%';$('thrKnob').style.bottom=`calc(${p}% - ${p*.06}px)`;$('thrVal').textContent=p+'%';$('thr').setAttribute('aria-valuenow',p);if(F)F.idle=0}
{const T=$('thr');const at=e=>{const r=T.getBoundingClientRect();setThr(1-(e.clientY-r.top-6)/(r.height-12))};
  T.addEventListener('pointerdown',e=>{e.preventDefault();try{T.setPointerCapture(e.pointerId)}catch(_){}T.dragging=true;at(e)});
  T.addEventListener('pointermove',e=>{if(T.dragging)at(e)});
  ['pointerup','pointercancel','lostpointercapture'].forEach(t=>T.addEventListener(t,()=>{T.dragging=false}));
  T.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowRight'){setThr(ctl.throttle+.1);e.preventDefault()}if(e.key==='ArrowDown'||e.key==='ArrowLeft'){setThr(ctl.throttle-.1);e.preventDefault()}})}
// fast-forward: one tap on, one tap off; remembered between flights so players can simply leave it on
export const FF_SPEED=2, FF_PITCH=.5, ffOn=()=>!!(save.meta.ff&&F&&!F.online);
export function syncFF(){const b=$('bFF');b.classList.toggle('on',!!save.meta.ff);b.setAttribute('aria-pressed',String(!!save.meta.ff));b.style.visibility=F&&F.online?'hidden':'visible'}
$('bFF').addEventListener('click',()=>{save.meta.ff=!save.meta.ff;persist();syncFF();buzz(10)});
// the right-hand action button: POP while balloons are up, then KICK once with Slingshot (a catapult shove in the air)
export const POP_HTML=$('bPop').innerHTML, KICK_HTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M9 6h9v9"/><path d="M3 12l3-3M12 21l3-3"/></svg>KICK<kbd class="kcap" aria-hidden="true">Space</kbd>';
export function act(){if(!F)return;if(F.K.counts.balloon&&!F.S.burst){F.S.burst=true;F.S.events.push('burst')}else if(F.pre<=0)kick(F.S,F.st)}
export function syncAct(){const b=$('bPop'),pop=F.K.counts.balloon&&!F.S.burst,m=pop?'pop':F.st.kick&&!F.S.kicked&&!F.S.done?'kick':'';
  if(m===b.dataset.m)return;b.dataset.m=m;b.style.visibility=m?'visible':'hidden';if(m){b.innerHTML=m==='pop'?POP_HTML:KICK_HTML;b.setAttribute('aria-label',m==='pop'?'Pop balloons':'Kick')}}
hold('bPop',act,()=>{});
export const keys={};
// keyboard (desktop, itch): arrows or W/S pitch, left/right or A/D throttle, Space pops balloons (or kicks), F fast-forward.
// The throttle slider handles its own arrows while it has focus, so those are skipped here.
window.addEventListener('keydown',e=>{if(!F||e.metaKey||e.ctrlKey||e.altKey)return;keys[e.key]=1;sync(e);if(e.repeat&&e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
  const k=e.key.length===1?e.key.toLowerCase():e.key,onThr=document.activeElement===$('thr');
  if(!onThr&&(k==='ArrowRight'||k==='d')){setThr(ctl.throttle+.1);e.preventDefault()}
  else if(!onThr&&(k==='ArrowLeft'||k==='a')){setThr(ctl.throttle-.1);e.preventDefault()}
  else if(k===' '&&$('bPop').style.visibility!=='hidden')act()
  else if(k==='f'&&!F.online)$('bFF').click()});
window.addEventListener('keyup',e=>{keys[e.key]=0;sync(e)});
export function sync(e){if(!F)return;const up=keys.ArrowUp||keys.w||keys.W,dn=keys.ArrowDown||keys.s||keys.S;ctl.pitch=up?1:dn?-1:0;if(e&&[' ','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault()}

// o.online: a live room flight (no fast-forward, ghosts, spectating); o.watch: only watching (out of an elimination)
export function startFlight(o={}){
  const r=R(),w=curWx(),st=curStats(),K=makeCraft(r.cells,st);
  F={st,K,S:newFlight(K,st),ts:1,online:!!o.online,watch:!!o.watch,flyCoins:[],pre:reduceMotion()?.3:1.1,stretch:0,debris:null,chute:null,idle:0,wx:w,cam:{x:0,y:20,sc:20},trail:[],parts:[],toasts:[],toastT:0,boom:-1,ended:false,coinFlash:0,endT:0,
    ctx:flightCtx(r),quota:r.mode==='daily'||o.online?null:quotaFor(r.stage,r.level),already:r.score,bestDist:r.bestDist||0};
  $('flight').classList.remove('watching');$('fSpec').hidden=true;
  ctl.pitch=0;ctl.boost=false;
  show('flight');setThr(1);$('thr').style.visibility=(K.counts.rocket||K.counts.prop)?'visible':'hidden';$('bPop').dataset.m='-';syncAct();$('fMark').hidden=!F.ctx.lv.frugal;
  $('toast').innerHTML='';$('toast').style.opacity=0;syncFF();
  const fw=$('fWx');fw.hidden=!w;if(w)fw.innerHTML=wxIcon(w)+'Storm · '+WEATHER[w].name;
  resize();F.cam.sc=vh/40;
  try{navigator.wakeLock&&navigator.wakeLock.request('screen').catch(()=>{})}catch(_){}
  sfx('creak',{amount:1});
  last=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
}
export const lerp=(a,b,t)=>a+(b-a)*t;
export function mixHex(a,b,t){const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('')}
export function toast(title,sub){F.toasts.push({title,sub});if(F.toasts.length>4)F.toasts.shift()}
export function frame(now){
  if(!F)return;
  // turning the phone mid-flight: iOS can fire 'resize' before the layout has its new size, so the canvas kept the old
  // shape and the picture was stretched; check the canvas against its box every frame instead
  if(Math.abs(cv.clientWidth-vw)>1||Math.abs(cv.clientHeight-vh)>1){resize();setAppH()}
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
      else if(e==='loop')F.loopT=performance.now()/1000,F.cheer=1,sfx('loop'),sfx('cheer',{intensity:.5}),toast('Loop',nth(S.loops,trickVal(F.ctx,'loop')));
      else if(e==='pass')F.cheer=1,sfx('pass'),toast('Low pass',nth(S.passes,trickVal(F.ctx,'pass')));
      else if(e==='thermal')F.cheer=.6,sfx('thermal'),toast('Thermal',`+${num(trickVal(F.ctx,'thermal'))} mult`);
      else if(e==='burst')sfx('pop'),toast('Balloons burst','');
      else if(e==='kick'){F.cheer=.6;sfx('launch');buzz(20);toast('Kick','');for(let j=0;j<10;j++)F.parts.push({x:S.x,y:S.y,vx:-S.vx*.2+(Math.random()-.5)*8,vy:-S.vy*.2+(Math.random()-.5)*8,life:.7,r:.3,k:'smoke'})}
      else if(e==='Redline'){F.boom=0;F.cheer=1;sfx('redline');sfx('cheer',{intensity:.9});buzz(40);toast('Redline',has('sonic')?`×${num(mv('sonic'))} score`:'+1 mult')}
      else if(e==='Cloud nine')F.cheer=1,sfx('cheer',{intensity:.9}),toast('Cloud nine',has('escape')?`×${num(mv('escape'))} score`:'+2 mult');
      else if(e==='Downdraft!')toast('Downdraft','The storm pushes you down');
      else if(e==='altitude'){const y=altReached(S.y);F.cheer=.7;sfx('pass');toast(`${y} m`,`+${fmt(altBonus(S.y))} landing bonus`)}
      else if(e==='distance'){F.cheer=.7;sfx('pass');toast(fmtD(distReached(S.maxX)),`+${fmt(distBonus(S.maxX))} landing bonus`)}
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
    else if(S.landed)sfx('touchdown'),sfx('cheer',{intensity:.6}),buzz(25),toast('Touchdown',(has('greaser')?`×${num(mv('greaser'))} score`:'+0.5 mult')+(F.ctx.boons&&F.ctx.boons.land?` · +${num(.25*F.ctx.boons.land)} mult`:''));
  }
  updParts(dt);draw(now);hud(dt);
  if(F.ended&&now-F.endT>(S.crashed?2600:1300)){if(F.online){if(!F.settled)finishOnline()}else{finish();return}}
  raf=requestAnimationFrame(frame);
}
export function emit(dt){
  const {S}=F,K=F.K;if(F.cam.sc<2)return;
  const c=Math.cos(S.th),s=Math.sin(S.th);
  for(const p of K.parts){
    if((p.type==='prop'&&S.propOn&&Math.random()<dt*14)||(p.type==='rocket'&&S.rocketOn&&Math.random()<dt*50)){
      const lx=p.lx-.6,wx=S.x+lx*c-p.ly*s,wy=S.y+lx*s+p.ly*c;
      F.parts.push({x:wx,y:wy,vx:S.vx*.2-c*4+(Math.random()-.5)*2,vy:S.vy*.2-s*4+(Math.random()-.5)*2,life:1,r:p.type==='rocket'?.5:.3,k:p.type==='rocket'?'fire':'smoke'})}}
}
export function dust(x,y,n,debris){for(let i=0;i<n;i++)F.parts.push({x,y,vx:(Math.random()-.5)*14,vy:Math.random()*9,life:1,r:debris?.25:.5,k:debris?'debris':'dust',g:1})}
export function updParts(dt){for(const p of F.parts){p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.g)p.vy-=12*dt;p.life-=dt*(p.k==='fire'?2.2:p.k==='pop'||p.k==='gold'?1.6:.9);p.r+=dt*(p.k==='smoke'?1.2:p.k==='fire'?.8:0)}F.parts=F.parts.filter(p=>p.life>0);if(F.parts.length>500)F.parts.splice(0,F.parts.length-500)}

// the goat's face is the feedback channel: it reads the flight before the numbers do
export function pilotMood(){
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
export function breakApart(){
  const {S}=F,K=F.K,c=Math.cos(S.th),s=Math.sin(S.th);
  F.debris=K.parts.map(p=>({type:p.type,rare:p.rare,x:S.x+p.lx*c-p.ly*s,y:S.y+p.lx*s+p.ly*c+.3,vx:S.vx*.35+(Math.random()-.5)*9+p.lx*3,vy:4+Math.random()*7,th:S.th,w:(Math.random()-.5)*14}));
  F.chute={x:S.x,y:S.y+1,vx:S.vx*.15+1.5,vy:11,t:0};
}
export function updDebris(dt){
  for(const d of F.debris){d.vy-=14*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.th+=d.w*dt;
    if(d.y<.5){d.y=.5;if(d.vy<-2){d.vy=-d.vy*.35;d.w*=.6}else d.vy=0;d.vx*=Math.pow(.15,dt);d.w*=Math.pow(.2,dt)}}
  const p=F.chute;if(p){p.t+=dt;p.vy=Math.max(p.vy-14*dt,-2.2);p.vx*=Math.pow(.6,dt);p.x+=p.vx*dt;p.y=Math.max(.6,p.y+p.vy*dt)}
}
export function drawDebris(X,Y,sc,now){
  const ds=Math.max(sc,14);
  for(const d of F.debris){ctx.save();ctx.translate(X(d.x),Y(d.y));ctx.scale(ds,ds);ctx.rotate(-d.th);drawPart(ctx,d.type,now/1000,{frac:0,lw:2.5/ds,mood:'crash',rare:d.rare});ctx.restore()}
  const p=F.chute;if(!p)return;
  const sway=Math.sin(p.t*2.2)*.25;ctx.save();ctx.translate(X(p.x),Y(p.y));ctx.scale(ds*1.4,ds*1.4);ctx.rotate(sway);
  if(ART&&ART.drawParachute)ART.drawParachute(ctx,now/1000,{lw:2.5/(ds*1.4),open:clamp(p.t*3,0,1)});
  else{ctx.lineWidth=2.5/(ds*1.4);ctx.strokeStyle='#22283a';ctx.fillStyle='#d2402f';ctx.beginPath();ctx.arc(0,-1.6,1.1*clamp(p.t*3,.2,1),Math.PI,0);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(-1,-1.6);ctx.lineTo(0,0);ctx.lineTo(1,-1.6);ctx.stroke();ctx.fillStyle='#fbf5e8';ctx.beginPath();ctx.arc(0,.1,.32,0,7);ctx.fill();ctx.stroke()}
  ctx.restore();
}
export function draw(now){
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
  const wv={vw,vh,sc,X,Y,camX:cam.x,camY:cam.y,left,right,now,RES,stage:R()?R().stage:0,town:R()?townOf(R().seed,R().stage).town:'',wx:F.wx,st,best:F.bestDist,hype:F.hype||0,cheer:F.cheer,pull:pre?Math.pow(clamp((1-F.pre/1.1)*1.3,0,1),2):0,launchT:pre?-1:S.t};drawWorld(ctx,wv);
  // the strip behind the phone's status bar shows the flight screen's background and theme-color: match the sky
  if(wv.skyTop!==F.skyTop){F.skyTop=wv.skyTop;$('flight').style.backgroundColor=wv.skyTop;themeTint(wv.skyTop)}
  const mag=st.magnetR>1;
  if(mag&&!S.done){const R0=COINR*st.magnetR*sc;ctx.save();ctx.strokeStyle='rgba(255,196,60,.45)';ctx.lineWidth=1.5;ctx.setLineDash([5,6]);ctx.lineDashOffset=-now/40;
    ctx.beginPath();ctx.arc(X(S.x),Y(S.y),R0,0,7);ctx.stroke();ctx.restore()}
  if((right-left)/COINSEG<700){
    // coins sit where the sim has them, so whatever is inside the magnet ring really is collected
    for(let k=Math.floor(left/COINSEG)-1;k<=Math.ceil(right/COINSEG)+1;k++){if(S.got.has(k))continue;const cn=coinAt(k,st.coinSalt||0);if(!cn)continue;
      const px=X(cn.x),py=Y(cn.y);if(py<-20||py>vh+20)continue;
      drawCoin(px,py,Math.max(3.5,.8*sc),Math.abs(Math.cos(now/300+k)),now/1000+k)}}
  // collected coins fly from where they were into the craft (the magnet's pull, made visible)
  for(const c of F.flyCoins){const k=Math.min(1,c.t/.28),e=k*k,px=X(c.x+(S.x-c.x)*e),py=Y(c.y+(S.y-c.y)*e),r=Math.max(3,.8*sc)*(1-.5*k);
    drawCoin(px,py,r,1,0,true)}
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
// a coin, spinning (sq = 1 face on, 0 edge on): a soft cream halo so it reads on golden fields and busy painted towns,
// an ink outline like everything else, a gold face with a darker rim and a white glint (until 0.12.3: amber on amber,
// which vanished over the meadow's wheat)
export function drawCoin(px,py,r,sq,t,bare){
  const rx=r*(.35+.65*sq);
  if(!bare){const R=r*2.3,g=ctx.createRadialGradient(px,py,r*.6,px,py,R);g.addColorStop(0,`rgba(255,248,225,${.55+.15*Math.sin(t*4)})`);g.addColorStop(1,'rgba(255,248,225,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(px,py,R,0,7);ctx.fill()}
  ctx.beginPath();ctx.ellipse(px,py,rx,r,0,0,7);ctx.fillStyle='#b97d1c';ctx.fill();
  ctx.beginPath();ctx.ellipse(px-rx*.08,py-r*.08,rx*.82,r*.82,0,0,7);ctx.fillStyle='#ffc93c';ctx.fill();
  ctx.beginPath();ctx.ellipse(px,py,rx,r,0,0,7);ctx.strokeStyle='#22283a';ctx.lineWidth=Math.max(1.5,r*.22);ctx.stroke();
  if(sq>.35&&r>4){ctx.beginPath();ctx.ellipse(px-rx*.35,py-r*.38,rx*.18,r*.24,.5,0,7);ctx.fillStyle='rgba(255,255,255,.85)';ctx.fill()}
}
// the others in the sky: translucent planes with a name tag, or a tag at the screen edge pointing to them
export function drawFlyers(list,X,Y,sc,now,fo){
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
export const elD=$('fDist'),elA=$('fAlt'),elV=$('fSpd'),elF=$('fFuel'),elT=$('toast'),elS=$('fScore'),elM=$('fMult'),elN=$('fNeed'),elFF=$('fTs'),elTm=$('fTime');
export function hud(dt){
  const {S}=F,K=F.K;
  // spectating: the distance, height and speed are the focused pilot's
  const fo=F.online&&(F.settled||F.watch)&&F.fl?focusOf(F.fl):null,P=fo||S;
  elD.textContent=fmtD(Math.max(0,P.x));
  elA.textContent='ALT '+fmtD(Math.max(0,P.y));
  elV.textContent=fmtV(Math.hypot(P.vx,P.vy));
  // flight clock: a flight ends at st.flightTime (5 min + Flight permits), so slow climbers can plan their descent
  {const rem=Math.max(0,Math.ceil(F.st.flightTime-S.t));elTm.lastChild.textContent=Math.floor(rem/60)+':'+String(rem%60).padStart(2,'0');elTm.className='ftime'+(rem<=20?' crit':rem<=60?' warn':'')}
  syncAct();
  elFF.hidden=true;
  const sum=summaryOf(S,K),sc=scoreFlight(sum,F.ctx);F.live=sc.total;
  F.hype=clamp((sc.mult*sc.xm-1)/4,0,1);audio.hype(F.hype);
  if(!S.done&&F.pre<=0){const fr=K.fuelMax?S.fuel/K.fuelMax:0;audio.engine({prop:S.propOn?ctl.throttle:0,rocket:S.rocketOn?ctl.throttle:0,speed:Math.hypot(S.vx,S.vy),fuel:fr,alt:S.y})}F.coinT=Math.max(0,(F.coinT||0)-dt);
  // the score as its sum: distance points (+ the altitude and distance landing bonus waiting for a landing; the part
  // Golden Parachute already counts in the air is in the base) times the multiplier
  const pend=!S.landed&&!S.done?Math.round((altBonus(sum.maxY)+distBonus(sum.dist))*(1-landingShare(sum,F.ctx))):0;
  {const key=sc.base+'|'+pend;if(key!==F.scoreKey){F.scoreKey=key;
    elS.innerHTML=pend?`(${fmt(sc.base)} <i class="lb">+ ${fmt(pend)}</i>)`:fmt(sc.base)}}
  elM.textContent='×'+num(sc.mult*sc.xm);
  // what is still missing counts the landing bonus waiting in the air, as the score line shows it
  const withPend=pend?Math.round((sc.base+pend)*sc.mult*sc.xm):sc.total;
  if(F.quota!=null){const need=F.quota-F.already-withPend;elN.textContent=need>0?`${fmt(need)} to target`:'Target reached';elN.className='need'+(need>0?'':' ok')}
  else if(F.online&&ROOM&&ROOM.mode==='team'){let got=withPend;for(const f of F.fl||[])got+=f.s||0;const need=ROOM.target-ROOM.teamScore-got;
    elN.textContent=need>0?`${fmt(need)} to team target`:'Team target reached';elN.className='need'+(need>0?'':' ok')}
  else if(F.online){elN.textContent=ROOM?'Round '+(ROOM.round):'';elN.className='need'}
  else{elN.textContent='Total '+fmt(F.already+sc.total);elN.className='need'}
  elS.style.color=F.coinFlash>0?'#ffb020':'';F.coinFlash=Math.max(0,F.coinFlash-dt*3);
  elF.style.transform='scaleX('+(K.fuelMax?S.fuel/K.fuelMax:0)+')';
  F.toastT-=dt;
  if(F.toastT<=0){if(F.toasts.length){const t=F.toasts.shift();elT.innerHTML=`${t.title}${t.sub?`<small>${t.sub}</small>`:''}`;elT.style.opacity=1;F.toastT=1.3}else elT.style.opacity=0}
}
export function finish(){
  cancelAnimationFrame(raf);
  const r=R(),{S}=F,K=F.K;
  const f=summaryOf(S,K);
  const out=settleFlight(r,metaOf(r),f);
  if(out.dailyDone)completeDaily(r);
  persist();reportRun(r,!!(out.dailyDone||out.failed));
  showResults(out,S,f);
  F=null;
}
// leave the flight screen's loop: stop drawing and the engine sound, forget the flight (live rooms leaving mid-flight)
export function dropFlight(){cancelAnimationFrame(raf);audio.stopEngine();F=null}
