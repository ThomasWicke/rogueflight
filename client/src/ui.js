// rogueflight UI: hangar (build / shop / mods), flight rendering + input, results and run screens.
import {
  GIMBAL, NEUT, PAR, VAC, VAC2, C_LIGHT, G0, COLS,
  ROWS, COCKPIT, MAXMODS, FLIGHTS, CONTRACTS, FLIGHT_TIME, clamp, PARTS, PALETTE,
  TUNES, tuneCost, RARITY, MODS, WEATHER, weatherFx, START, UNLOCKS,
  modUnlocked, QUOTA, quotaFor, isStorm, weatherOf, stats, DIRS,
  SOCK, STRUCT, linkage, connected, balanceOf, makeCraft, hs, groundY,
  COINSEG, COINR, thermalSeg, coinAt, newFlight, segDist, flag, step,
  popBalloons, summaryOf, scoreFlight, wpick, PART_W, rollMods, rollTunes, genShop,
  rerollShop, priceOf, offerPrice, rerollCost, sellValue, newRun, craftCounts, settleFlight,
  PACKS, FIRST_PACKS, rollPacks, grantPacks, openPack,
  MODMAX, modLevels, modVal, modDesc, modPrice, canBuy, applyPurchase, sellMod, flightStats, repeats, severity,
  MAX_CEILING, CEILING_RULES, ceilingRules, REDLINE, CLOUD9,
  BOONS, rollBoons, boonDesc, pickBoon, modSlots,
} from './sim.js';
import { drawWorld, drawGrain, biomeOf } from './world.js';
import { audio } from './audio.js';
import { drawPart, drawPilot, drawParachute } from './art.js';
import { decalURL } from './decals.js';
import { townOf, showTitle, headline } from './fiction.js';
import { initGuide, openGuide } from './guide.js';

/* ================= persistence ================= */
const KEY='rogueflight-1';
const META0={runs:0,wins:0,bestStage:0,bestFlight:0,deepest:0,level:0};
let save=(()=>{try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&s.meta)return {meta:{...META0,...s.meta},run:s.run||null}}catch(e){}return {meta:{...META0},run:null}})();
function persist(){try{localStorage.setItem(KEY,JSON.stringify(save))}catch(e){}}

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
for(const t of Object.keys(PARTS)){const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d');g.translate(48,48);g.scale(96,96);drawPart(g,t,.33,{frac:.7,lw:.055});ICON[t]=c.toDataURL()}

const $=id=>document.getElementById(id);
const veil=$('veil'), sheet=$('sheet'), bench=$('bench');
function show(id){for(const s of ['title','hangar','flight'])$(s).hidden=s!==id;audio.music(id==='title'?'title':id==='hangar'?'hangar':'flight');if(id!=='hangar'){const d=$('dealer');d.classList.remove('open');d.hidden=true;tab='build'}}
const R=()=>save.run;
let armAbandon=false;
function runCode(r){if(!r)return '';const L=t=>t==='cockpit'?'c':t[0];
  return 'ROGUEFLIGHT '+JSON.stringify({lvl:r.level,cleared:r.stage,boons:r.boons||{},endless:!!r.endless,coins:r.coins,mods:r.mods.map(id=>{const L=modLevels(r)[id];return L>1?id+':'+L:id}),tune:r.tune,inv:r.inv,
    cells:r.cells.map(c=>L(c.type)+c.c+c.r).join(' '),log:r.log.map(l=>[l.stage+1,l.flight,l.score,l.d,l.x])})}
function copyRun(r,btn){const txt=runCode(r);const ok=()=>{if(btn){btn.textContent='Copied';setTimeout(()=>{btn.textContent='Copy run'},1500)}};
  const fall=()=>{const d=document.createElement('div');d.className='copybox';d.innerHTML='<textarea readonly></textarea><button class="big" type="button">Close</button>';
    d.querySelector('textarea').value=txt;d.querySelector('button').onclick=()=>d.remove();document.body.appendChild(d);const t=d.querySelector('textarea');t.focus();t.select()};
  try{navigator.clipboard.writeText(txt).then(ok,fall)}catch(_){fall()}}
document.addEventListener('click',e=>{const b=e.target.closest('[data-copyrun]');if(!b)return;copyRun(b.dataset.copyrun==='last'?save.meta.lastRun:R(),b)});
// telemetry: every finished or abandoned run goes to /api/run (a Pages Function storing it in D1) for balancing.
// Anonymous: a random id per browser and the run code, nothing else. Production builds only.
function clientId(){try{let id=localStorage.getItem('rogueflight-client');if(!id){id=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('rogueflight-client',id)}return id}catch(_){return ''}}
function reportRun(r){
  if(!import.meta.env.PROD||!r||!r.log.length)return;
  try{const data={...JSON.parse(runCode(r).slice('ROGUEFLIGHT '.length)),weather:r.weather};
    const body=JSON.stringify({client:clientId(),version:__BUILD__,level:r.level,cleared:r.stage,endless:!!r.endless,won:r.stage>=CONTRACTS,data});
    if(!(navigator.sendBeacon&&navigator.sendBeacon('/api/run',body)))fetch('/api/run',{method:'POST',body,keepalive:true}).catch(()=>{})}catch(_){}
}
function endRun(){reportRun(save.run);if(save.run)save.meta.lastRun={...JSON.parse(JSON.stringify(save.run)),shop:null};save.meta.runs=(save.meta.runs||0)+1;save.run=null;persist();veil.hidden=true;armAbandon=false;show('title');renderTitle()}

/* ================= title ================= */
let pickLevel=save.meta.level||0;
function renderTitle(){
  const m=save.meta, r=save.run;
  pickLevel=Math.min(pickLevel,m.level||0);
  let h='';
  if(r){
    const tw=townOf(r.seed,r.stage);
    h+=`<div class="card stack"><span class="label">On tour</span>
      <p class="hint">Show ${r.stage+1}${r.endless?' (encore tour)':' of '+CONTRACTS}: <strong>${tw.town}</strong> · ${r.coins} cash · ${plural(r.mods.length,'decal')}${r.level?' · Ceiling '+r.level:''}</p>
      <button class="big" id="cont" type="button">Back on the road</button>
      <button class="ghost${armAbandon?' armed':''}" id="aband" type="button">${armAbandon?'Tap again to cancel':'Cancel the tour'}</button></div>`;
  }else{
    h+=`<div class="card"><span class="label">A new season</span>
      ${m.level>0?`<div style="margin-top:12px"><div class="row" style="margin-bottom:6px"><span class="label">Ceiling</span></div><div class="seg" id="lvl">${Array.from({length:m.level+1},(_,i)=>`<button type="button" data-l="${i}" aria-pressed="${i===pickLevel}">${i}</button>`).join('')}</div>
        ${pickLevel?`<div class="crules"><span>+${pickLevel*25}% crowd targets</span>${ceilingRules(pickLevel).map(t=>`<span>${t}</span>`).join('')}</div>`:''}</div>`:''}
      <div style="margin-top:12px"><button class="big" id="start" type="button">Start the tour</button></div></div>`;
  }
  h+=`<div><button class="ghost howto${m.guideSeen?'':' new'}" id="howto" type="button">How to play</button></div>`;
  h+=`<div class="card"><span class="label">Scrapbook</span>
    <dl class="stats"><dt>Tours</dt><dd>${m.runs}</dd><dt>Seasons won</dt><dd>${m.wins}</dd><dt>Most shows in a tour</dt><dd>${m.deepest||m.bestStage}</dd><dt>Biggest crowd</dt><dd>${fmt(m.bestFlight)}</dd>${m.level?`<dt>Highest Ceiling</dt><dd>${m.level}</dd>`:''}</dl>
    <div class="row" style="margin-top:12px"><span class="label">Unlocks</span><span class="hint">shows in one tour</span></div>
    <ul class="unl">${UNLOCKS.map(u=>{const d=m.bestStage>=u.at;return `<li class="${d?'done':''}"><i>${d?'\u2713':u.at}</i><span>${u.text}</span></li>`}).join('')}</ul>${m.lastRun?'<div style="margin-top:12px"><button class="ghost" type="button" data-copyrun="last">Copy last run</button></div>':''}</div>`;
  $('titleBody').innerHTML=h;
  startTitleScene();
  $('howto').onclick=openGuide;
  if(r){
    $('cont').onclick=()=>{armAbandon=false;openHangar()};
    $('aband').onclick=()=>{if(!armAbandon){armAbandon=true;renderTitle();return}endRun()};
  }else{
    const lv=$('lvl');if(lv)lv.onclick=e=>{const b=e.target.closest('button');if(b){pickLevel=+b.dataset.l;renderTitle()}};
    $('start').onclick=()=>{save.run=newRun(pickLevel,save.meta);persist();tab='shop';sel='wing';openHangar()};
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
    g.strokeStyle='#e9a93b';g.lineWidth=5;g.lineCap='round';g.setLineDash([2,11]);g.beginPath();
    const u0=(t*.12)%1;for(let i=0;i<=60;i++){const [x,y]=pt(u0-i/60*.55);i?g.lineTo(x,y):g.moveTo(x,y)}g.stroke();g.setLineDash([]);
    const [x,y]=pt(u0),[x2,y2]=pt(u0+.005),ang=Math.atan2(y2-y,x2-x),s=Math.min(30,w/11);
    g.save();g.translate(x,y);g.rotate(ang);g.scale(s,s);
    for(const [type,lx,ly] of [['cockpit',0,0],['frame',1,0],['prop',2,0],['wing',0,-1],['wing',1,-1]]){g.save();g.translate(lx-.6,ly);drawPart(g,type,t,{on:true,frac:.8,lw:2.5/s,mood:'grin'});g.restore()}
    g.restore();
    titleRaf=requestAnimationFrame(draw);
  };
  titleRaf=requestAnimationFrame(draw);
}

/* ================= hangar ================= */
let tab='build', sel='wing', armClear=false, clearTimer=0, armSell=null;
const owned=t=>R().inv[t]||0, usedN=t=>R().cells.filter(x=>x.type===t).length, left=t=>Math.max(0,owned(t)-usedN(t));
const curWx=()=>weatherOf(R(),R().stage);
const curStats=()=>flightStats(R());
function openHangar(){
  const r=R();if(!r){show('title');renderTitle();return}
  show('hangar');
  if(r.phase==='won'){renderHangar();showVictory();return}
  if(r.phase==='over'){renderHangar();showRunOver();return}
  if(r.phase==='shop'&&tab==='build')tab='shop';
  setTab(tab);
}
// tab: 'build' is the barn itself; 'shop' and 'mods' open the dealer drawer over it
const dealer=$('dealer'), dbody=$('dealerBody');
function setTab(t){tab=t;armSell=null;armAbandon=false;
  const open=t!=='build';
  if(open&&dealer.hidden){dealer.hidden=false;requestAnimationFrame(()=>dealer.classList.add('open'))}
  else if(!open&&!dealer.hidden){dealer.classList.remove('open');setTimeout(()=>{if(tab==='build')dealer.hidden=true},260)}
  renderHangar();const r=R();if(!r||r.phase==='won'||r.phase==='over')return;if(r.boonOffer)showBoons();else if(r.packs&&r.packs.length)showPacks()}
$('tShop').onclick=()=>setTab('shop');$('tMods').onclick=()=>setTab('mods');
$('dealerX').onclick=$('dealerScrim').onclick=()=>setTab('build');
function wxLine(id,s){return `<div class="wx"><b>${WEATHER[id].name}</b>${WEATHER[id].d(s)}</div>`}
// the season's route: eight towns along a dashed road, storm clouds over stormy towns (all forecast from the start, so
// builds can plan for them), done towns ticked, the plane over the current one
function routeStrip(r){
  if(r.endless)return forecast(r);
  const n=CONTRACTS,W=300,x=i=>14+i*(W-28)/(n-1),y=i=>24+Math.sin(i*1.3)*5;
  let road='';for(let i=0;i<n;i++)road+=(i?'L':'M')+x(i).toFixed(1)+' '+y(i).toFixed(1);
  let h=`<path d="${road}" class="rroad"/>`;
  for(let i=0;i<n;i++){const w=weatherOf(r,i),done=i<r.stage,cur=i===r.stage;
    h+=`<circle cx="${x(i)}" cy="${y(i)}" r="${cur?8:6}" class="rtown${done?' done':''}${cur?' cur':''}${w?' storm':''}"/>`;
    if(done)h+=`<path d="M${x(i)-3} ${y(i)}l2.4 2.6 4.4-5" class="rtick"/>`;
    if(w)h+=`<g class="rcloud" transform="translate(${x(i)} ${y(i)-15})"><path d="M-8 3a4 4 0 0 1 2-7a5 5 0 0 1 9-1a4 4 0 0 1 5 5a3 3 0 0 1-1 3z"/><path d="M-1 4l-2 5 3-1-1 4" class="rbolt"/></g>`;
    if(cur)h+=`<g transform="translate(${x(i)} ${y(i)+14})"><path d="M-6 0h12M0 -4v8" class="rplane"/></g>`}
  const names=[];for(let i=r.stage+1;i<n;i++){const w=weatherOf(r,i);if(w)names.push(`<span title="${WEATHER[w].d(severity(r,i))}"><b>${i+1}</b>${WEATHER[w].name}</span>`)}
  return `<svg class="route" viewBox="0 0 ${W} 46" role="img" aria-label="Tour route: show ${r.stage+1} of ${n}">${h}</svg>${names.length?`<div class="fcast">${names.join('')}</div>`:''}`;
}
function forecast(r){const out=[];for(let i=r.stage+1;i<CONTRACTS;i++){const w=weatherOf(r,i);if(w)out.push(`<span title="${WEATHER[w].d(severity(r,i))}"><b>${i+1}</b>${WEATHER[w].name}</span>`)}
  return out.length?`<div class="fcast">${out.join('')}</div>`:''}
// the show poster: town, which show of the season, the crowd target with a thermometer, ticket stubs for flights left
function renderStrip(){
  const r=R(),q=quotaFor(r.stage,r.level),w=curWx(),t=townOf(r.seed,r.stage);
  const sub=`Show ${r.stage+1}${r.endless?' · encore tour':' of '+CONTRACTS}`;
  const stubs=`<span class="fpips" aria-label="${FLIGHTS-r.flight} flights left">${Array.from({length:FLIGHTS},(_,i)=>`<i class="${i<r.flight?'used':''}"></i>`).join('')}</span>`;
  const storm=w?`<div class="pstorm"><b>${WEATHER[w].name}</b>${WEATHER[w].d(severity(r,r.stage))}</div>`:'';
  const p=r.phase==='shop'?0:Math.min(1,r.score/q);
  $('cstrip').innerHTML=`<div class="prow"><span class="psub">${r.phase==='shop'?'Next · ':''}${sub}</span>${r.phase==='shop'?'':stubs}</div>
    <div class="ptown">${t.town}<small>${t.show==='Grand Finale'?'Grand Finale':t.show}</small></div>
    <div class="cbar"><i style="transform:scaleX(${p})"></i><span>Crowd ${r.phase==='shop'?'target '+fmt(q):fmt(r.score)+' / '+fmt(q)}</span></div>${storm}${routeStrip(r)}`;
}
function renderHangar(){
  const r=R();if(!r)return;
  $('hCeil').textContent='Ceiling '+r.level;$('hCeil').hidden=!r.level;
  $('hCoins').textContent=fmt(r.coins);
  $('tShop').classList.toggle('fresh',r.phase==='shop');
  $('tModsL').textContent=`Decals ${r.mods.length}/${modSlots(r)}`;
  renderStrip();
  renderBuild();
  dbody.onclick=null;
  if(tab==='shop')renderShop();else if(tab==='mods')renderMods();
  $('launch').textContent=r.phase==='shop'?`START SHOW ${r.stage+1}`:'LAUNCH!';
}

function renderBuild(){
  const r=R(), st=curStats(), K=makeCraft(r.cells,st);
  const link=linkage(r.cells), conn=link.seen;
  const blockedSet=new Set(K.parts.filter(p=>p.blocked).map(p=>p.gc+','+p.gr));
  const map=new Map(r.cells.map(x=>[x.c+','+x.r,x]));
  let cells='';
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const k=x+','+y,p=map.get(k);
    const cls='cell'+(p?' on':'')+(p&&!conn.has(k)?' loose':'')+(p&&p.type==='cockpit'?' cock':'')+(blockedSet.has(k)?' blocked':'');
    cells+=`<button class="${cls}" data-c="${x}" data-r="${y}" type="button" aria-label="${p?PARTS[p.type].name:'Empty'} at column ${x+1}, row ${y+1}">${p?`<img alt="" src="${ICON[p.type]}">`:''}</button>`}
  const W=K.m*G0*st.grav, n=K.counts;
  const propT=n.prop*st.prop*st.rhoMul/W, rockT=n.rocket*st.rocket/W;
  const burn=n.prop*st.propUse;
  const off=K.lift, balF=off==null?0:balanceOf(off);
  const lift=n.wing*st.wing*st.rhoMul*2500*.56*balF/W;
  const bal=n.balloon*st.balloon*st.rhoMul/W;
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
    <div class="row"><span class="label">Workbench</span><button class="ghost${armClear?' armed':''}" id="clear" type="button" ${r.cells.length<=1?'disabled':''}>${armClear?'Tap again':'Clear'}</button></div>
    <div class="grid" id="grid">${cells}<svg class="ov" viewBox="0 0 7 5" preserveAspectRatio="none" aria-hidden="true">${ov}</svg></div>
    <div class="legend"><span><i class="lg-com"></i>Mass</span><span><i class="lg-col"></i>Lift</span><span style="margin-left:auto">Nose \u2192</span></div>
    <div class="pal" id="pal">${PALETTE.map(t=>`<button type="button" data-t="${t}" aria-pressed="${t===sel}"><img alt="" src="${ICON[t]}"><span>${PARTS[t].name}</span><small class="${left(t)?'':'none'}">${left(t)}/${owned(t)}</small></button>`).join('')}</div>
    <div class="blurb" id="blurb">${warns.length?`<span class="warn">${warns.join(' \u00b7 ')}</span>`:''}</div>
  </div>
  <div class="card">
    <span class="label">Spec sheet</span>
    <dl class="stats">${rows.map(([a,b,c])=>`<dt>${a}</dt><dd class="${c}">${b}</dd>`).join('')}</dl>
  </div>`;
  $('grid').onclick=e=>{if(skipClick){skipClick=false;return}const b=e.target.closest('.cell');if(b)placeAt(+b.dataset.c,+b.dataset.r)};
  bindDrag($('grid'));
  $('pal').onclick=e=>{const b=e.target.closest('button');if(b){sel=b.dataset.t;armClear=false;renderBuild()}};
  $('clear').onclick=()=>{if(!armClear){armClear=true;renderBuild();clearTimeout(clearTimer);clearTimer=setTimeout(()=>{armClear=false;if(tab==='build'&&save.run)renderBuild()},3000);return}
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
      b.classList.add('lift');const g=document.createElement('img');g.className='ghost-part';g.src=ICON[p.type];g.style.left=drag.x+'px';g.style.top=drag.y+'px';document.body.appendChild(g);drag.ghost=g;
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
  const i=r.cells.findIndex(x=>x.c===c&&x.r===y);
  if(i>=0&&r.cells[i].type===sel)r.cells.splice(i,1);
  else if(left(sel)<=0){$('blurb').innerHTML=`<span class="warn">No ${PARTS[sel].name.toLowerCase()}s left</span>`;return}
  else if(i>=0)r.cells[i].type=sel;
  else r.cells.push({c,r:y,type:sel});
  persist();renderBuild();
}

// L: the level shown (description and pips); up: shown as an upgrade offer
const pips=L=>`<span class="lvp" aria-label="Level ${L} of ${MODMAX}">${Array.from({length:MODMAX},(_,i)=>`<i class="${i<L?'on':''}"></i>`).join('')}</span>`;
function modCard(id,btn,L,up){const M=MODS[id];L=L||1;return `<div class="offer ${M.r}">${DECAL?`<img class="decal" alt="" src="${DECAL(id,96,L)}">`:`<div class="glyph ${M.r}" aria-hidden="true">${M.name[0]}</div>`}<div><span class="rar r-${M.r}">${up?'<b class="upg">Upgrade</b> · ':''}${RARITY[M.r].name} · ${M.tag}</span><h3>${M.name} ${pips(L)}</h3><p>${modDesc(id,L)}</p></div>${btn}</div>`}
function renderShop(){
  const r=R();
  if(!r.shop){r.shop=genShop(r,save.meta);persist()}
  const S=r.shop, full=r.mods.length>=modSlots(r), lv=modLevels(r);
  const btn=(kind,i,o)=>{if(o.sold)return `<button class="buy" type="button" disabled>\u2713</button>`;const p=offerPrice(r,kind,o);
    return `<button class="buy" type="button" data-kind="${kind}" data-i="${i}" ${p>r.coins||!canBuy(r,kind,o)?'disabled':''}><i class="cn"></i>${p}</button>`};
  // an owned mod on offer is an upgrade: show the level it would reach (a sold one already shows its new level)
  const mods=S.mods.length?S.mods.map((o,i)=>{const L=lv[o.id]||0,up=!!L&&!o.sold;return `<div class="${o.sold?'sold':''}">${modCard(o.id,btn('mod',i,o),o.sold?Math.max(1,L):L+1,up)}</div>`}).join(''):'<p class="hint">\u2014</p>';
  const tunes=S.tunes.map((o,i)=>{const T=TUNES[o.k],L=r.tune[o.k]||0;return `<div class="offer${o.sold?' sold':''}"><div class="glyph C" aria-hidden="true">+</div><div><h3>${T.name}</h3><p>${T.d} \u00b7 Lv ${L+1}${T.max?'/'+T.max:''}</p></div>${btn('tune',i,o)}</div>`}).join('');
  const parts=S.parts.map((o,i)=>`<div class="offer${o.sold?' sold':''}"><img alt="" src="${ICON[o.t]}"><div><h3>${PARTS[o.t].name}</h3><p>${owned(o.t)} owned</p></div>${btn('part',i,o)}</div>`).join('');
  const rc=rerollCost(r);
  $('dealerTitle').textContent='Junk dealer';
  dbody.innerHTML=`
  <div class="card"><span class="label">Parts</span><div class="offers">${parts}</div></div>
  <div class="card"><span class="label">Tune-ups</span><div class="offers">${tunes}</div></div>
  <div class="card"><div class="row"><span class="label">Sponsor decals</span><span class="hint${full?' warn':''}">${r.mods.length}/${modSlots(r)}${full?' full':''}</span></div><div class="offers">${mods}</div></div>
  <div class="row" style="justify-content:flex-end"><button class="ghost" id="reroll" type="button" ${rc>r.coins?'disabled':''}>Reroll <i class="cn"></i>${rc}</button></div>`;
  dbody.onclick=e=>{
    const b=e.target.closest('.buy[data-kind]');
    if(b){buy(b.dataset.kind,+b.dataset.i);return}
    if(e.target.closest('#reroll')){if(rc>r.coins)return;sfx('reroll');r.coins-=rc;rerollShop(r,save.meta);persist();renderHangar()}
  };
}
function buy(kind,i){
  const r=R(),S=r.shop;const o=S[kind==='part'?'parts':kind==='tune'?'tunes':'mods'][i];if(!o)return;
  if(applyPurchase(r,kind,o)){sfx('buy');buzz(12);persist();renderHangar()}else sfx('error')
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
  $('dealerTitle').textContent='Sponsor decals';
  dbody.innerHTML=`
  <div class="card"><div class="row"><span class="label">Decals</span><span class="hint">${r.mods.length}/${modSlots(r)}</span></div><div class="offers">${slots}</div></div>
  <div class="card"><span class="label">Tune-ups</span><p class="hint" style="margin-top:6px">${tl||'\u2014'}</p></div>
  ${bl?`<div class="card"><span class="label">Storm rewards</span><p class="hint" style="margin-top:6px">${bl}</p></div>`:''}
  <div class="card"><span class="label">Log</span><div class="log">${log||'<div>\u2014</div>'}</div></div>
  <div class="card stack"><button class="ghost" type="button" data-copyrun="cur">Copy run</button><button class="ghost${armAbandon?' armed':''}" id="aband2" type="button">${armAbandon?'Tap again':'Abandon run'}</button></div>`;
  dbody.onclick=e=>{
    const b=e.target.closest('[data-sell]');
    if(b){const id=b.dataset.sell;if(armSell!==id){armSell=id;renderMods();return}armSell=null;sfx('sell');sellMod(r,id);persist();renderHangar();return}
    if(e.target.closest('#aband2')){if(!armAbandon){armAbandon=true;renderMods();return}endRun()}
  };
}
$('launch').onclick=()=>{const r=R();if(!r)return;
  if(r.phase==='shop'){r.phase='contract';persist();setTab('build');return}
  if(r.phase==='contract')startFlight()};

initGuide(ICON,()=>{if(!save.meta.guideSeen){save.meta.guideSeen=true;persist();if(!$('title').hidden)renderTitle()}});
$('hHelp').onclick=openGuide;

/* ================= storm rewards ================= */
// after a cleared storm contract: pick 1 of 2 (rolled in sim and saved, so a reload shows the same pair)
const BOON_ICON={slot:'+',coins:'¢',upgrade:'↑',drag:'≋',grav:'↥',fuel:'▮',thermal:'≈',pass:'_',loop:'∞',coin:'●',land:'⌒'};
function showBoons(){
  const r=R();if(!r||!r.boonOffer)return;
  sheet.innerHTML=`<span class="label">The storm is behind you</span><h2>A gift from ${townOf(r.seed,Math.max(0,r.stage-1)).town}</h2>
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
const isEngine=t=>t==='prop'||t==='rocket';
// the packet is two copies of one face: the cap above a jagged tear line and the body below it, so it looks whole until torn
const PW=178,PH=164,CAP=34,TEAR=3;
const zig=(n,y0,y1)=>Array.from({length:n+1},(_,i)=>`${PW*i/n}px ${i%2?y1:y0}px`);
const CLIP_CAP=`polygon(${[...zig(2,0,0),...zig(10,CAP,CAP+TEAR).reverse()].join(',')})`;
const CLIP_BODY=`polygon(${[...zig(10,CAP,CAP+TEAR),...zig(2,PH,PH).reverse()].join(',')})`;
const FACE='<div class="pk-face"><div class="pk-brace"></div><div class="pk-mark">?</div><div class="pk-band">SCRAP</div><div class="pk-sheen"></div></div>';
const packLayers=()=>`<div class="pk-layer pk-cap" style="clip-path:${CLIP_CAP};-webkit-clip-path:${CLIP_CAP}">${FACE}</div><div class="pk-layer pk-body" style="clip-path:${CLIP_BODY};-webkit-clip-path:${CLIP_BODY}">${FACE}</div>`;
let PK=null;
const pkStage=$('pkStage'), pkTray=$('pkTray');
const ms=t=>reduceMotion()?1:t;
const anim=(el,kf,o)=>el.animate(kf,{fill:'both',...o,duration:ms(o.duration),delay:ms(o.delay||0)});
function showPacks(){
  const r=R();if(PK||!r||!r.packs||!r.packs.length)return;
  PK={got:[],busy:false,state:'pack'};
  $('pkLabel').textContent=`Scrap for ${townOf(r.seed,r.stage).town}`;
  pkTray.innerHTML=r.packs.map(()=>'<i></i>').join('');
  $('pkDone').hidden=true;$('pkSkip').hidden=false;pkTray.hidden=false;$('packs').hidden=false;
  dealPack();
}
function dealPack(){
  const left=R().packs.length;
  pkStage.className='pk-stage';
  pkStage.innerHTML=`<div class="pk-rays"><i></i></div><div class="pk-glow"></div>
    <div class="pk-pile">${Array.from({length:Math.min(2,left-1)},()=>`<div class="pk-back">${packLayers()}</div>`).join('')}<button class="pack" type="button" aria-label="Open pack">${packLayers()}</button></div>
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
  img.src=bigIcon(t);rv.querySelector('h3').textContent=PARTS[t].name;rv.querySelector('small').textContent='×'+r.inv[t];rv.hidden=false;
  anim(rv.querySelector('h3'),[{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],{duration:300,delay:520});
  anim(rv.querySelector('small'),[{opacity:0},{opacity:1}],{duration:300,delay:640});
  await anim(img,[{transform:'translateY(70px) scale(.15) rotate(-30deg)',opacity:0},{transform:'translateY(-18px) scale(1.2) rotate(8deg)',opacity:1,offset:.6},{transform:'none',opacity:1}],
    {duration:760,delay:120,easing:'ease-out'}).finished;
  PK.state='reveal';PK.busy=false;
}
function fillSlot(i,t){const s=pkTray.children[i];if(!s)return;s.className='on'+(isEngine(t)?' gold':'');s.innerHTML=`<img alt="${PARTS[t].name}" src="${ICON[t]}">`;
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
  pkStage.innerHTML=`<div class="pk-sum">${Object.entries(n).map(([t,k])=>`<div class="${isEngine(t)?'gold':''}"><img alt="" src="${bigIcon(t)}"><b>${PARTS[t].name}</b><small>+${k}</small></div>`).join('')}</div>`;
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
hold('bPop',()=>{if(F&&!F.S.burst&&F.K.counts.balloon){F.S.burst=true;F.S.events.push('burst')}},()=>{});
const keys={};
window.addEventListener('keydown',e=>{if(!F)return;keys[e.key]=1;sync(e)});
window.addEventListener('keyup',e=>{keys[e.key]=0;sync(e)});
function sync(e){if(!F)return;const up=keys.ArrowUp||keys.w||keys.W,dn=keys.ArrowDown||keys.s||keys.S;ctl.pitch=up?1:dn?-1:0;if(e&&[' ','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault()}
$('land').onclick=()=>{if(F&&!F.S.done){F.S.done=true;F.S.banked=true}};

function startFlight(){
  const r=R(),w=curWx(),st=curStats(),K=makeCraft(r.cells,st);
  F={st,K,S:newFlight(K,st),ts:1,flyCoins:[],pre:reduceMotion()?.3:1.1,stretch:0,debris:null,chute:null,idle:0,wx:w,cam:{x:0,y:20,sc:20},trail:[],parts:[],toasts:[],toastT:0,boom:-1,ended:false,coinFlash:0,endT:0,
    ctx:{mods:r.mods.slice(),lv:modLevels(r),flightIdx:r.flight,cleared:r.stage,coins:r.coins,...craftCounts(r.cells)},quota:quotaFor(r.stage,r.level),already:r.score,bestDist:r.bestDist||0};
  ctl.pitch=0;ctl.boost=false;
  show('flight');setThr(1);$('thr').style.visibility=(K.counts.rocket||K.counts.prop)?'visible':'hidden';$('bPop').style.visibility=K.counts.balloon?'visible':'hidden';
  $('toast').innerHTML='';$('toast').style.opacity=0;
  const fw=$('fWx');fw.hidden=!w;if(w)fw.textContent='Storm · '+WEATHER[w].name;
  resize();F.cam.sc=vh/40;
  try{navigator.wakeLock&&navigator.wakeLock.request('screen').catch(()=>{})}catch(_){}
  sfx('creak',{amount:1});
  last=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
}
const lerp=(a,b,t)=>a+(b-a)*t;
function mixHex(a,b,t){const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('')}
function toast(title,sub){F.toasts.push({title,sub});if(F.toasts.length>4)F.toasts.shift()}
function frame(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  const {S,st}=F, lv=F.ctx.lv, has=k=>!!lv[k], mv=(k,key)=>modVal(lv,k,key);
  // what the n-th repeat of a trick adds, after the diminishing returns in scoreFlight
  const nth=(n,per)=>`+${num((repeats(n)-repeats(n-1))*per)} mult`;
  // the wind-up: the plane sits pulled back on the ramp, then the catapult fires
  if(F.pre>0){F.pre-=dt;if(F.pre<=0){F.stretch=1;F.cheer=1;sfx('launch');sfx('cheer',{intensity:.7});buzz(30)}
    updParts(dt);draw(now);hud(0);raf=requestAnimationFrame(frame);return}
  F.stretch=Math.max(0,F.stretch-dt*5);
  if(F.debris)updDebris(dt);
  if(!S.done){
    // fast-forward only while hands-off; touching a control drops back to real time at once
    F.idle=ctl.pitch?0:F.idle+dt;
    const free=F.idle>1;
    let tgt=1;
    if(free&&S.t>12)tgt=Math.min(4,1+(S.t-12)/8);
    if(S.fuel<=0&&!S.touch&&S.y>2000)tgt=Math.max(tgt,Math.min(free?30:3,S.y/600));
    F.ts+=(tgt-F.ts)*Math.min(1,dt*(tgt<F.ts?5:1.2));
    const ts=F.ts,total=dt*ts, v=Math.hypot(S.vx,S.vy);
    const n=Math.min(80,Math.max(Math.ceil(total/.012),Math.ceil(v*total/.6)));
    for(let i=0;i<n&&!S.done;i++){step(S,F.K,st,total/n,ctl);
      if(S.burst&&!S.popped){const c=Math.cos(S.th),s=Math.sin(S.th);
        for(const p of F.K.parts)if(p.type==='balloon')for(let j=0;j<10;j++)F.parts.push({x:S.x+p.lx*c-p.ly*s,y:S.y+p.lx*s+p.ly*c,vx:S.vx*.5+(Math.random()-.5)*16,vy:S.vy*.5+(Math.random()-.5)*16,life:.8,r:.18,k:'pop'});
        F.K=popBalloons(S,F.K,st)}}
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
  }
  updParts(dt);draw(now);hud(dt);
  if(F.ended&&now-F.endT>(S.crashed?2600:1300)){finish();return}
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
  if(S.done)return S.landed?'cheer':'sad';
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
  F.debris=K.parts.map(p=>({type:p.type,x:S.x+p.lx*c-p.ly*s,y:S.y+p.lx*s+p.ly*c+.3,vx:S.vx*.35+(Math.random()-.5)*9+p.lx*3,vy:4+Math.random()*7,th:S.th,w:(Math.random()-.5)*14}));
  F.chute={x:S.x,y:S.y+1,vx:S.vx*.15+1.5,vy:11,t:0};
}
function updDebris(dt){
  for(const d of F.debris){d.vy-=14*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.th+=d.w*dt;
    if(d.y<.5){d.y=.5;if(d.vy<-2){d.vy=-d.vy*.35;d.w*=.6}else d.vy=0;d.vx*=Math.pow(.15,dt);d.w*=Math.pow(.2,dt)}}
  const p=F.chute;if(p){p.t+=dt;p.vy=Math.max(p.vy-14*dt,-2.2);p.vx*=Math.pow(.6,dt);p.x+=p.vx*dt;p.y=Math.max(.6,p.y+p.vy*dt)}
}
function drawDebris(X,Y,sc,now){
  const ds=Math.max(sc,14);
  for(const d of F.debris){ctx.save();ctx.translate(X(d.x),Y(d.y));ctx.scale(ds,ds);ctx.rotate(-d.th);drawPart(ctx,d.type,now/1000,{frac:0,lw:2.5/ds,mood:'crash'});ctx.restore()}
  const p=F.chute;if(!p)return;
  const sway=Math.sin(p.t*2.2)*.25;ctx.save();ctx.translate(X(p.x),Y(p.y));ctx.scale(ds*1.4,ds*1.4);ctx.rotate(sway);
  if(ART&&ART.drawParachute)ART.drawParachute(ctx,now/1000,{lw:2.5/(ds*1.4),open:clamp(p.t*3,0,1)});
  else{ctx.lineWidth=2.5/(ds*1.4);ctx.strokeStyle='#22283a';ctx.fillStyle='#d2402f';ctx.beginPath();ctx.arc(0,-1.6,1.1*clamp(p.t*3,.2,1),Math.PI,0);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(-1,-1.6);ctx.lineTo(0,0);ctx.lineTo(1,-1.6);ctx.stroke();ctx.fillStyle='#fbf5e8';ctx.beginPath();ctx.arc(0,.1,.32,0,7);ctx.fill();ctx.stroke()}
  ctx.restore();
}
function draw(now){
  const {S,st}=F,K=F.K, cam=F.cam;
  const v=Math.hypot(S.vx,S.vy);
  const pre=F.pre>0;
  const viewH=pre?50:Math.max(30,S.y*1.25+16,v*1.3);
  cam.sc=Math.exp(lerp(Math.log(cam.sc),Math.log(vh/viewH),pre?.25:.08));
  const sc=cam.sc;
  const tx=pre?-10:S.x+.16*vw/sc;
  cam.x=F.camSet?lerp(cam.x,tx,pre?1:Math.min(1,.06+S.t*.5)):tx;F.camSet=1;
  cam.y=Math.max(S.y+RES*.5/sc,.35*vh/sc);
  const X=wx=>vw/2+(wx-cam.x)*sc, Y=wy=>vh/2-(wy-cam.y)*sc;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const left=cam.x-vw/2/sc, right=cam.x+vw/2/sc;
  // the crowd cheers for tricks and records and gets livelier as the flight's hype builds
  F.cheer=Math.max(0,(F.cheer||0)-1/60*1.5);
  drawWorld(ctx,{vw,vh,sc,X,Y,camX:cam.x,camY:cam.y,left,right,now,RES,stage:R()?R().stage:0,town:R()?townOf(R().seed,R().stage).town:'',wx:F.wx,st,best:F.bestDist,hype:F.hype||0,cheer:F.cheer});
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
  if(F.boom>=0){F.boom+=1/60;const R2=20+F.boom*260;ctx.strokeStyle=`rgba(255,255,255,${Math.max(0,1-F.boom*1.6)})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,R2,0,7);ctx.stroke();if(F.boom>.7)F.boom=-1}
  if(F.debris)drawDebris(X,Y,sc,now);
  if(!S.crashed){
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
    for(const p of K.parts){ctx.save();ctx.translate(p.lx,-p.ly);drawPart(ctx,p.type,now/1000,{on:p.type==='rocket'?S.rocketOn:S.propOn,frac,lw:2.5/ds,mood});ctx.restore()}
    ctx.restore()
  }
  drawGrain(ctx,vw,vh);
}
const elD=$('fDist'),elA=$('fAlt'),elV=$('fSpd'),elF=$('fFuel'),elT=$('toast'),elS=$('fScore'),elM=$('fMult'),elN=$('fNeed'),elFF=$('fTs'),elTm=$('fTime');
function hud(dt){
  const {S}=F,K=F.K;
  elD.textContent=fmtD(Math.max(0,S.x));
  elA.textContent='ALT '+fmtD(Math.max(0,S.y));
  elV.textContent=fmtV(Math.hypot(S.vx,S.vy));
  // flight clock: a flight ends at st.flightTime (5 min + Flight permits), so slow climbers can plan their descent
  {const rem=Math.max(0,Math.ceil(F.st.flightTime-S.t));elTm.lastChild.textContent=Math.floor(rem/60)+':'+String(rem%60).padStart(2,'0');elTm.className='ftime'+(rem<=20?' crit':rem<=60?' warn':'')}
  if(S.burst&&$('bPop').style.visibility!=='hidden')$('bPop').style.visibility='hidden';
  {const t=F.ts>1.15&&!S.done;elFF.hidden=!t;if(t)elFF.textContent='\u25b8\u25b8 '+(F.ts<9.95?F.ts.toFixed(1):Math.round(F.ts))+'\u00d7'}
  const sc=scoreFlight(summaryOf(S,K),F.ctx);
  F.hype=clamp((sc.mult*sc.xm-1)/4,0,1);audio.hype(F.hype);
  if(!S.done&&F.pre<=0){const fr=K.fuelMax?S.fuel/K.fuelMax:0;audio.engine({prop:S.propOn?ctl.throttle:0,rocket:S.rocketOn?ctl.throttle:0,speed:Math.hypot(S.vx,S.vy),fuel:fr,alt:S.y})}F.coinT=Math.max(0,(F.coinT||0)-dt);
  elS.textContent=fmt(sc.total);elM.textContent='×'+num(sc.mult*sc.xm);
  const need=F.quota-F.already-sc.total;
  elN.textContent=need>0?`${fmt(need)} to sell out`:'Sold out!';elN.className='need'+(need>0?'':' ok');
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
  const out=settleFlight(r,save.meta,f);
  persist();
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
  const title=S.crashed?'Crashed!':S.banked?'Landed early':S.landed?'Touchdown!':S.becalmed?'Becalmed':'Out of time';
  const kind=S.crashed?'bad':S.landed?'good':'meh';
  const base=sc.lines.filter(l=>l.t==='b'), hype=sc.lines.filter(l=>l.t!=='b');
  const q=out.quota, p0=Math.min(1,out.prevScore/q), p1=Math.min(1,out.contractScore/q);
  let btn='',next='',result='';
  // one result line: sold out (with the bonus), or what is still needed; the gate cash rides along
  if(out.cleared){btn=out.won?'Continue':'On to the next town';next=out.won?'won':'shop';
    result=`<div id="tySold" class="sold" hidden>Sold out! <small>+${out.reward+out.interest+out.pay} cash</small></div>`+(out.unlocks&&out.unlocks.length?`<p class="hint">Unlocked: <strong>${out.unlocks.join(', ')}</strong></p>`:'');}
  else if(out.failed){btn='Tour summary';next='over';result=`<p class="tres warn">No flights left: the crowd goes home · +${out.pay} cash</p>`}
  else{const left=FLIGHTS-out.flightNo;btn='Back to the barn';next='hangar';result=`<p class="tres">${fmt(q-out.contractScore)} more needed · ${plural(left,'flight')} left · +${out.pay} cash</p>`}
  const news=headline({...f,cleared:!!out.cleared},{town:town.town,pilot:'Goat'},r.seed+out.stage*7+out.flightNo);
  sheet.className='sheet tallysheet';
  sheet.innerHTML=`<div class="stamp ${kind}">${title}</div>
    <span class="label">${town.town} · flight ${out.flightNo} of ${FLIGHTS}</span>
    <div class="eqn"><span class="drum" id="tyBase">0</span><i>×</i><span id="tyM">1</span><i>=</i><b id="tyT">0</b></div>
    <small class="eqsub">${base.map(l=>l.dist?'seats from '+fmtD(l.v):'+'+fmt(l.v)+' '+l.label.toLowerCase()).join(' · ')} · hype · crowd</small>
    <div class="hype" id="tyHype">${hype.map((l,k)=>{const m=lineMod(l.label);return `<span class="hc ${l.t}" data-k="${k}">${m&&DECAL?`<img alt="" src="${DECAL(m,48,modLevels(r)[m]||1)}">`:''}${l.label}<b>${l.t==='x'?'×':'+'}${num(l.v)}</b></span>`}).join('')||'<span class="hc none">No stunts this time</span>'}</div>
    <div class="cbar${out.cleared?' done':''}"><i id="rbar" style="transform:scaleX(${p0})"></i><span id="rbarT">Crowd ${fmt(out.prevScore)} / ${fmt(q)}</span></div>
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
  const finishNow=()=>{skip=true;sheet.querySelectorAll('.hc').forEach(c=>c.classList.add('in'));el('tyM').textContent=num(sc.mult*sc.xm);el('tyT').textContent=fmt(sc.total);el('tyBase').textContent=fmt(sc.base);
    el('rbar').style.transform=`scaleX(${p1})`;el('rbarT').textContent=`Crowd ${fmt(out.contractScore)} / ${fmt(q)}`;el('tyNews').hidden=false;if(out.cleared)el('tySold').hidden=false};
  sheet.onclick=e=>{if(!e.target.closest('button')&&!done)finishNow()};
  (async()=>{
    sfx('stamp');buzz(15);
    await wait(350);
    await roll(el('tyBase'),sc.base,650);
    let m=1,x=1;
    const chips=[...sheet.querySelectorAll('.hc[data-k]')];
    for(let k=0;k<chips.length;k++){if(skip)break;const l=hype[k];
      if(l.t==='x')x*=l.v;else m+=l.v;chips[k].classList.add('in');el('tyM').textContent=num(m*x);sfx('multStep',{step:k});buzz(6);await wait(230)}
    if(!skip){await wait(150);sfx('slam');buzz([30,40,30]);sheet.classList.add('kick');setTimeout(()=>sheet.classList.remove('kick'),300)}
    el('tyM').textContent=num(sc.mult*sc.xm);
    await roll(el('tyT'),sc.total,450);
    await wait(200);
    el('rbar').style.transform=`scaleX(${p1})`;el('rbarT').textContent=`Crowd ${fmt(out.contractScore)} / ${fmt(q)}`;
    if(out.cleared){await wait(700);el('tySold').hidden=false;sfx('fireworks');sfx('fanfare');buzz([20,60,20,60,40]);confetti()}
    await wait(400);el('tyNews').hidden=false;done=true;
  })();
  $('next').onclick=()=>{
    veil.classList.remove('tally');sheet.className='sheet';sheet.onclick=null;
    if(next==='won'){showVictory();return}
    if(next==='over'){showRunOver();return}
    veil.hidden=true;show('hangar');tab=next==='shop'?'shop':'build';setTab(tab);
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
function runStats(r){return `<dl class="stats"><dt>Total crowd</dt><dd>${fmt(r.total)}</dd><dt>Biggest show</dt><dd>${fmt(r.best)}</dd><dt>Longest flight</dt><dd>${fmtD(r.bestDist||0)}</dd><dt>Flights</dt><dd>${r.log.length}</dd></dl>`}
// end of a season: a won season is a sold-out poster with confetti; a lost one is the torn "tour cancelled" poster
function showVictory(){
  const r=R(),m=save.meta;
  sheet.className='sheet endsheet win';
  sheet.innerHTML=`<span class="label">${r.level?'Ceiling '+r.level+' season':'Season'} · ${townOf(r.seed,CONTRACTS-1).town}</span>
    <h2>Season complete!</h2>
    <p class="note">Eight towns, eight sold-out shows. The goat takes a bow.</p>
    ${runStats(r)}
    ${r.unlocks.length?`<p class="note">Unlocked: <b>${r.unlocks.join(', ')}</b></p>`:''}
    ${m.level>r.level?`<p class="note">Ceiling <b>${r.level+1}</b> unlocked: the next circuit is calling</p>`:''}
    <button class="big win" type="button" id="endless">Encore tour</button>
    <button class="big alt" type="button" id="retire">Take a bow</button><button class="ghost" type="button" data-copyrun="cur">Copy run</button>`;
  veil.hidden=false;sfx('fanfare');sfx('cheer',{intensity:1});confetti();
  $('endless').onclick=()=>{sheet.className='sheet';r.endless=true;r.phase='shop';r.shop=genShop(r,m);weatherOf(r,r.stage);grantPacks(r);persist();veil.hidden=true;show('hangar');setTab('shop')};
  $('retire').onclick=()=>{sheet.className='sheet';endRun()};
}
function showRunOver(){
  const r=R();
  const n=r.stage;
  sheet.className='sheet endsheet lose';
  sheet.innerHTML=`<span class="label">${r.level?'Ceiling '+r.level+' season':'Season'}</span>
    <h2>${r.endless?'The encore ends':'Tour cancelled'}</h2>
    <p class="note">${r.endless?'What a run. The crowd goes home happy.':`The crowd in ${townOf(r.seed,n).town} wanted more. Shows sold out: <b>${n} / ${CONTRACTS}</b>`}</p>
    ${runStats(r)}
    ${r.unlocks.length?`<p class="note">Unlocked: <b>${r.unlocks.join(', ')}</b></p>`:''}
    <button class="big" type="button" id="again">Next season</button><button class="ghost" type="button" data-copyrun="cur">Copy run</button>`;
  veil.hidden=false;sfx('sad');
  $('again').onclick=()=>{sheet.className='sheet';endRun()};
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
if(import.meta.env.DEV)window.__rf={F:()=>F,R,frame:n=>frame(n)};

/* ================= boot ================= */
show('title');renderTitle();
