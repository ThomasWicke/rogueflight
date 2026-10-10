// rogueflight UI: hangar (build / shop / mods), flight rendering + input, results and run screens.
import {
  GIMBAL, NEUT, PAR, VAC, VAC2, C_LIGHT, G0, COLS,
  ROWS, COCKPIT, MAXMODS, FLIGHTS, CONTRACTS, clamp, PARTS, PALETTE,
  TUNES, tuneCost, RARITY, MODS, WEATHER, weatherFx, START, UNLOCKS,
  modUnlocked, QUOTA, quotaFor, isStorm, weatherOf, stats, DIRS,
  SOCK, STRUCT, linkage, connected, balanceOf, makeCraft, hs, groundY,
  COINSEG, COINR, thermalSeg, coinAt, newFlight, segDist, flag, step,
  popBalloons, summaryOf, scoreFlight, wpick, PART_W, rollMods, rollTunes, genShop,
  rerollShop, priceOf, offerPrice, rerollCost, sellValue, newRun, craftCounts, settleFlight,
} from './sim.js';

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

/* ================= part drawing ================= */
function rr(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()}
const INK='#0c1a2c';
// one visual language: structural parts share a riveted alloy hull; red and amber are the livery accents
const HULL='#f4f8fb',HULL2='#d3e0eb',SHADE='#9db0c2',RED='#ff6655',AMB='#ffc23d',DARK='#3b4d61';
function rivets(g,d){g.fillStyle=SHADE;for(const [x,y] of [[-d,-d],[d,-d],[-d,d],[d,d]]){g.beginPath();g.arc(x,y,.035,0,7);g.fill()}}
function hull(g,fill){rr(g,-.46,-.46,.92,.92,.1);g.fillStyle=fill||HULL;g.fill();
  g.save();rr(g,-.46,-.46,.92,.92,.1);g.clip();g.fillStyle='rgba(255,255,255,.35)';g.fillRect(-.5,-.5,1,.1);g.fillStyle='rgba(12,26,44,.12)';g.fillRect(-.5,.36,1,.14);g.restore();
  rr(g,-.46,-.46,.92,.92,.1);g.stroke()}
function drawPart(g,type,t,o){
  o=o||{};g.lineWidth=.045;g.strokeStyle=INK;g.lineJoin='round';g.lineCap='round';
  if(type==='cockpit'){
    hull(g);
    g.fillStyle=RED;g.fillRect(-.44,.1,.88,.1);g.fillStyle=AMB;g.fillRect(-.44,.2,.88,.035);
    g.beginPath();g.moveTo(-.3,-.06);g.quadraticCurveTo(-.26,-.4,.08,-.4);g.quadraticCurveTo(.36,-.38,.4,-.06);g.closePath();
    g.fillStyle='#8fdcff';g.fill();g.stroke();
    g.beginPath();g.arc(.0,-.13,.11,0,7);g.fillStyle='#f0c08a';g.fill();
    g.beginPath();g.arc(.0,-.16,.115,Math.PI*1.05,Math.PI*1.95);g.lineTo(.0,-.16);g.fillStyle='#7a4a2a';g.fill();
    g.fillStyle=DARK;g.fillRect(.02,-.17,.1,.04);
    g.fillStyle='rgba(255,255,255,.6)';g.beginPath();g.ellipse(.2,-.27,.05,.08,-.5,0,7);g.fill();
    rivets(g,.36);
  }else if(type==='frame'){
    hull(g,HULL2);
    // open truss: four triangular cut-outs leave an X brace inside the rim
    g.fillStyle='#6f87a0';
    for(const r of [0,1,2,3]){g.save();g.rotate(r*Math.PI/2);g.beginPath();g.moveTo(-.22,-.31);g.lineTo(.22,-.31);g.lineTo(0,-.09);g.closePath();g.fill();g.stroke();g.restore()}
    rivets(g,.37);g.beginPath();g.arc(0,0,.05,0,7);g.fillStyle=SHADE;g.fill();
  }else if(type==='tank'){
    const fr=o.frac==null?1:o.frac;
    hull(g);
    rr(g,-.3,-.3,.6,.6,.12);g.fillStyle=DARK;g.fill();
    g.save();rr(g,-.3,-.3,.6,.6,.12);g.clip();g.fillStyle=AMB;g.fillRect(-.3,.3-.6*fr,.6,.6*fr);
    g.fillStyle='rgba(255,255,255,.25)';g.fillRect(-.24,-.3,.08,.6);g.restore();
    rr(g,-.3,-.3,.6,.6,.12);g.stroke();
    g.strokeStyle='rgba(12,26,44,.5)';g.lineWidth=.03;for(const y of [-.15,0,.15]){g.beginPath();g.moveTo(.16,y);g.lineTo(.3,y);g.stroke()}
    g.strokeStyle=INK;g.lineWidth=.045;rivets(g,.38);
  }else if(type==='wing'){
    g.strokeStyle=SHADE;g.lineWidth=.06;g.beginPath();g.moveTo(-.1,.08);g.lineTo(-.1,.5);g.moveTo(.18,.06);g.lineTo(.18,.5);g.stroke();
    g.strokeStyle=INK;g.lineWidth=.045;
    g.beginPath();g.moveTo(-.5,.08);g.bezierCurveTo(-.42,-.2,.15,-.22,.5,-.02);g.bezierCurveTo(.2,.08,-.2,.12,-.5,.08);g.closePath();
    g.fillStyle='#ffffff';g.fill();
    g.save();g.clip();g.fillStyle=RED;g.fillRect(-.5,-.3,.16,.5);g.fillStyle='rgba(12,26,44,.1)';g.fillRect(-.5,.04,1,.1);g.restore();
    g.stroke();
  }else if(type==='prop'){
    // nacelle with cooling fins, spinner and two blades at the nose
    rr(g,-.46,-.22,.66,.44,.2);g.fillStyle=HULL2;g.fill();g.stroke();
    g.strokeStyle='rgba(12,26,44,.45)';g.lineWidth=.03;for(const x of [-.3,-.2,-.1]){g.beginPath();g.moveTo(x,-.17);g.lineTo(x,.17);g.stroke()}
    g.strokeStyle=INK;g.lineWidth=.045;g.fillStyle=RED;g.fillRect(.02,-.2,.07,.4);
    const bl=.44*Math.abs(Math.cos(t*30))+.05;
    if(o.on){g.beginPath();g.ellipse(.36,0,.05,.48,0,0,7);g.fillStyle='rgba(43,52,64,.18)';g.fill()}
    g.beginPath();g.ellipse(.36,0,.06,bl,0,0,7);g.fillStyle=o.on?'rgba(43,52,64,.55)':DARK;g.fill();
    g.beginPath();g.moveTo(.2,-.13);g.quadraticCurveTo(.46,-.1,.48,0);g.quadraticCurveTo(.46,.1,.2,.13);g.closePath();g.fillStyle=AMB;g.fill();g.stroke();
  }else if(type==='rocket'){
    if(o.on){const f=.6+Math.random()*.35;g.beginPath();g.moveTo(-.46,-.15);g.lineTo(-.46-f,0);g.lineTo(-.46,.15);g.closePath();g.fillStyle='#ff8a2a';g.fill();
      g.beginPath();g.moveTo(-.46,-.08);g.lineTo(-.46-f*.55,0);g.lineTo(-.46,.08);g.closePath();g.fillStyle='#fff1c2';g.fill()}
    g.beginPath();g.moveTo(-.2,-.18);g.lineTo(-.38,-.36);g.lineTo(-.38,-.14);g.closePath();g.moveTo(-.2,.18);g.lineTo(-.38,.36);g.lineTo(-.38,.14);g.closePath();g.fillStyle=RED;g.fill();g.stroke();
    g.beginPath();g.moveTo(-.36,-.12);g.lineTo(-.48,-.17);g.lineTo(-.48,.17);g.lineTo(-.36,.12);g.closePath();g.fillStyle=DARK;g.fill();g.stroke();
    g.beginPath();g.moveTo(-.36,-.19);g.lineTo(.18,-.19);g.quadraticCurveTo(.48,-.14,.5,0);g.quadraticCurveTo(.48,.14,.18,.19);g.lineTo(-.36,.19);g.closePath();
    g.fillStyle='#eef2f5';g.fill();
    g.save();g.clip();g.fillStyle=RED;g.fillRect(.2,-.3,.4,.6);g.fillStyle='rgba(12,26,44,.12)';g.fillRect(-.5,.08,1.1,.12);g.fillStyle=AMB;g.fillRect(-.12,-.2,.06,.4);g.restore();
    g.stroke();
  }else if(type==='balloon'){
    g.strokeStyle='rgba(12,26,44,.7)';g.lineWidth=.03;g.beginPath();g.moveTo(0,.5);g.quadraticCurveTo(.05,.42,0,.32);g.stroke();g.strokeStyle=INK;g.lineWidth=.045;
    g.beginPath();g.moveTo(0,.32);g.bezierCurveTo(-.5,.05,-.42,-.48,0,-.48);g.bezierCurveTo(.42,-.48,.5,.05,0,.32);g.closePath();g.fillStyle=RED;g.fill();
    g.save();g.clip();g.fillStyle='rgba(12,26,44,.14)';g.beginPath();g.ellipse(.2,0,.28,.6,0,0,7);g.fill();g.restore();
    g.beginPath();g.moveTo(0,.32);g.bezierCurveTo(-.5,.05,-.42,-.48,0,-.48);g.bezierCurveTo(.42,-.48,.5,.05,0,.32);g.closePath();g.stroke();
    g.beginPath();g.moveTo(-.06,.36);g.lineTo(.06,.36);g.lineTo(0,.3);g.closePath();g.fillStyle='#c23a30';g.fill();
    g.beginPath();g.ellipse(-.18,-.24,.05,.1,-.4,0,7);g.fillStyle='rgba(255,255,255,.6)';g.fill();
  }
}
const ICON={};
for(const t of Object.keys(PARTS)){const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d');g.translate(48,48);g.scale(84,84);drawPart(g,t,.33,{frac:.7});ICON[t]=c.toDataURL()}

const $=id=>document.getElementById(id);
const veil=$('veil'), sheet=$('sheet'), bench=$('bench');
function show(id){for(const s of ['title','hangar','flight'])$(s).hidden=s!==id}
const R=()=>save.run;
let armAbandon=false;
function runCode(r){if(!r)return '';const L=t=>t==='cockpit'?'c':t[0];
  return 'ROGUEFLIGHT '+JSON.stringify({lvl:r.level,cleared:r.stage,endless:!!r.endless,coins:r.coins,mods:r.mods,tune:r.tune,inv:r.inv,
    cells:r.cells.map(c=>L(c.type)+c.c+c.r).join(' '),log:r.log.map(l=>[l.stage+1,l.flight,l.score,l.d,l.x])})}
function copyRun(r,btn){const txt=runCode(r);const ok=()=>{if(btn){btn.textContent='Copied';setTimeout(()=>{btn.textContent='Copy run'},1500)}};
  const fall=()=>{const d=document.createElement('div');d.className='copybox';d.innerHTML='<textarea readonly></textarea><button class="big" type="button">Close</button>';
    d.querySelector('textarea').value=txt;d.querySelector('button').onclick=()=>d.remove();document.body.appendChild(d);const t=d.querySelector('textarea');t.focus();t.select()};
  try{navigator.clipboard.writeText(txt).then(ok,fall)}catch(_){fall()}}
document.addEventListener('click',e=>{const b=e.target.closest('[data-copyrun]');if(!b)return;copyRun(b.dataset.copyrun==='last'?save.meta.lastRun:R(),b)});
function endRun(){if(save.run)save.meta.lastRun={...JSON.parse(JSON.stringify(save.run)),shop:null};save.meta.runs=(save.meta.runs||0)+1;save.run=null;persist();veil.hidden=true;armAbandon=false;show('title');renderTitle()}

/* ================= title ================= */
let pickLevel=save.meta.level||0;
function renderTitle(){
  const m=save.meta, r=save.run;
  pickLevel=Math.min(pickLevel,m.level||0);
  let h='';
  if(r){
    h+=`<div class="card stack"><span class="label">Current run</span>
      <p class="hint">Contract ${r.stage+1}${r.endless?' (endless)':' of '+CONTRACTS} · ${r.coins} coins · ${plural(r.mods.length,'mod')}${r.level?' · Ceiling '+r.level:''}</p>
      <button class="big" id="cont" type="button">Continue run</button>
      <button class="ghost${armAbandon?' armed':''}" id="aband" type="button">${armAbandon?'Tap again':'Abandon run'}</button></div>`;
  }else{
    h+=`<div class="card"><span class="label">New run</span>
      ${m.level>0?`<div style="margin-top:12px"><div class="row" style="margin-bottom:6px"><span class="label">Ceiling</span><span class="hint">+25% quota per level</span></div><div class="seg" id="lvl">${Array.from({length:m.level+1},(_,i)=>`<button type="button" data-l="${i}" aria-pressed="${i===pickLevel}">${i}</button>`).join('')}</div></div>`:''}
      <div style="margin-top:12px"><button class="big" id="start" type="button">Start run</button></div></div>`;
  }
  h+=`<div class="rules"><span>${CONTRACTS} contracts</span><span>${FLIGHTS} flights each</span><span>Score = distance \u00d7 mult</span><span>${MAXMODS} mod slots</span></div>`;
  h+=`<div class="card"><span class="label">Logbook</span>
    <dl class="stats"><dt>Runs</dt><dd>${m.runs}</dd><dt>Wins</dt><dd>${m.wins}</dd><dt>Best run</dt><dd>${m.deepest||m.bestStage}</dd><dt>Best flight</dt><dd>${fmt(m.bestFlight)}</dd>${m.level?`<dt>Highest Ceiling</dt><dd>${m.level}</dd>`:''}</dl>
    <div class="row" style="margin-top:12px"><span class="label">Unlocks</span><span class="hint">contracts in one run</span></div>
    <ul class="unl">${UNLOCKS.map(u=>{const d=m.bestStage>=u.at;return `<li class="${d?'done':''}"><i>${d?'\u2713':u.at}</i><span>${u.text}</span></li>`}).join('')}</ul>${m.lastRun?'<div style="margin-top:12px"><button class="ghost" type="button" data-copyrun="last">Copy last run</button></div>':''}</div>`;
  $('titleBody').innerHTML=h;
  if(r){
    $('cont').onclick=()=>{armAbandon=false;openHangar()};
    $('aband').onclick=()=>{if(!armAbandon){armAbandon=true;renderTitle();return}endRun()};
  }else{
    const lv=$('lvl');if(lv)lv.onclick=e=>{const b=e.target.closest('button');if(b){pickLevel=+b.dataset.l;renderTitle()}};
    $('start').onclick=()=>{save.run=newRun(pickLevel,save.meta);persist();tab='shop';sel='wing';openHangar()};
  }
}

/* ================= hangar ================= */
let tab='build', sel='wing', armClear=false, clearTimer=0, armSell=null;
const owned=t=>R().inv[t]||0, usedN=t=>R().cells.filter(x=>x.type===t).length, left=t=>Math.max(0,owned(t)-usedN(t));
const curWx=()=>weatherOf(R(),R().stage);
const curStats=()=>{const r=R();return stats(r.tune,r.mods,weatherFx(curWx(),r.stage))};
function openHangar(){
  const r=R();if(!r){show('title');renderTitle();return}
  show('hangar');
  if(r.phase==='won'){renderHangar();showVictory();return}
  if(r.phase==='over'){renderHangar();showRunOver();return}
  if(r.phase==='shop'&&tab==='build')tab='shop';
  setTab(tab);
}
function setTab(t){tab=t;armSell=null;armAbandon=false;for(const [id,k] of [['tBuild','build'],['tShop','shop'],['tMods','mods']])$(id).setAttribute('aria-selected',k===t?'true':'false');renderHangar()}
$('tBuild').onclick=()=>setTab('build');$('tShop').onclick=()=>setTab('shop');$('tMods').onclick=()=>setTab('mods');
function wxLine(id,s){return `<div class="wx"><b>${WEATHER[id].name}</b>${WEATHER[id].d(s)}</div>`}
// storm forecast: every storm in the run is known from the start, so builds can plan around them
function forecast(r){const out=[];for(let i=r.stage+1;i<CONTRACTS;i++){const w=weatherOf(r,i);if(w)out.push(`<span title="${WEATHER[w].d(i)}"><b>${i+1}</b>${WEATHER[w].name}</span>`)}
  return out.length?`<div class="fcast">${out.join('')}</div>`:''}
function renderStrip(){
  const r=R(),q=quotaFor(r.stage,r.level),w=curWx();
  const title=`Contract ${r.stage+1}${r.endless?' · endless':' of '+CONTRACTS}`;
  if(r.phase==='shop'){
    $('cstrip').innerHTML=`<div class="row"><span class="label">Next: ${title}</span><span class="fpips"><b style="color:var(--ink)">${fmt(q)}</b></span></div>${w?wxLine(w,r.stage):''}${forecast(r)}`;
  }else{
    const p=Math.min(1,r.score/q);
    $('cstrip').innerHTML=`<div class="row"><span class="label">${title}</span><span class="fpips" aria-label="${FLIGHTS-r.flight} flights left">${Array.from({length:FLIGHTS},(_,i)=>`<i class="${i<r.flight?'used':''}"></i>`).join('')}</span></div>
      <div class="cbar"><i style="transform:scaleX(${p})"></i><span>${fmt(r.score)} / ${fmt(q)}</span></div>${w?wxLine(w,r.stage):''}${forecast(r)}`;
  }
}
function renderHangar(){
  const r=R();if(!r)return;
  $('hCeil').textContent='Ceiling '+r.level;$('hCeil').hidden=!r.level;
  $('hCoins').textContent=fmt(r.coins);
  $('tShop').innerHTML='Shop'+(r.phase==='shop'?'<span class="dot" aria-label="open"></span>':'');
  $('tMods').textContent=`Mods ${r.mods.length}/${MAXMODS}`;
  renderStrip();
  bench.onclick=null;
  if(tab==='build')renderBuild();else if(tab==='shop')renderShop();else renderMods();
  $('launch').textContent=r.phase==='shop'?`START CONTRACT ${r.stage+1}`:`LAUNCH · FLIGHT ${r.flight+1} OF ${FLIGHTS}`;
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
    <div class="row"><span class="label">Bench</span><button class="ghost${armClear?' armed':''}" id="clear" type="button" ${r.cells.length<=1?'disabled':''}>${armClear?'Tap again':'Clear'}</button></div>
    <div class="grid" id="grid">${cells}<svg class="ov" viewBox="0 0 7 5" preserveAspectRatio="none" aria-hidden="true">${ov}</svg></div>
    <div class="legend"><span><i class="lg-com"></i>Mass</span><span><i class="lg-col"></i>Lift</span><span style="margin-left:auto">Nose \u2192</span></div>
    <div class="pal" id="pal">${PALETTE.map(t=>`<button type="button" data-t="${t}" aria-pressed="${t===sel}"><img alt="" src="${ICON[t]}"><span>${PARTS[t].name}<small class="${left(t)?'':'none'}">${left(t)}/${owned(t)}</small></span></button>`).join('')}</div>
    <div class="blurb" id="blurb">${warns.length?`<span class="warn">${warns.join(' \u00b7 ')}</span>`:''}</div>
  </div>
  <div class="card">
    <span class="label">Craft</span>
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

function modCard(id,btn){const M=MODS[id];return `<div class="offer ${M.r}"><div class="glyph ${M.r}" aria-hidden="true">${M.name[0]}</div><div><span class="rar r-${M.r}">${RARITY[M.r].name} · ${M.tag}</span><h3>${M.name}</h3><p>${M.d}</p></div>${btn}</div>`}
function renderShop(){
  const r=R();
  if(!r.shop){r.shop=genShop(r,save.meta);persist()}
  const S=r.shop, full=r.mods.length>=MAXMODS;
  const btn=(kind,i,o,block)=>{if(o.sold)return `<button class="buy" type="button" disabled>\u2713</button>`;const p=offerPrice(r,kind,o);
    return `<button class="buy" type="button" data-kind="${kind}" data-i="${i}" ${p>r.coins||block?'disabled':''}><i class="cn"></i>${p}</button>`};
  const mods=S.mods.length?S.mods.map((o,i)=>`<div class="${o.sold?'sold':''}">${modCard(o.id,btn('mod',i,o,full))}</div>`).join(''):'<p class="hint">\u2014</p>';
  const tunes=S.tunes.map((o,i)=>{const T=TUNES[o.k],L=r.tune[o.k]||0;return `<div class="offer${o.sold?' sold':''}"><div class="glyph C" aria-hidden="true">+</div><div><h3>${T.name}</h3><p>${T.d} \u00b7 Lv ${L+1}</p></div>${btn('tune',i,o)}</div>`}).join('');
  const parts=S.parts.map((o,i)=>`<div class="offer${o.sold?' sold':''}"><img alt="" src="${ICON[o.t]}"><div><h3>${PARTS[o.t].name}</h3><p>${owned(o.t)} owned</p></div>${btn('part',i,o)}</div>`).join('');
  const rc=rerollCost(r);
  bench.innerHTML=`
  <div class="card"><span class="label">Parts</span><div class="offers">${parts}</div></div>
  <div class="card"><span class="label">Tuning</span><div class="offers">${tunes}</div></div>
  <div class="card"><div class="row"><span class="label">Mods</span><span class="hint${full?' warn':''}">${r.mods.length}/${MAXMODS}${full?' full':''}</span></div><div class="offers">${mods}</div></div>
  <div class="row" style="justify-content:flex-end"><button class="ghost" id="reroll" type="button" ${rc>r.coins?'disabled':''}>Reroll <i class="cn"></i>${rc}</button></div>`;
  bench.onclick=e=>{
    const b=e.target.closest('.buy[data-kind]');
    if(b){buy(b.dataset.kind,+b.dataset.i);return}
    if(e.target.closest('#reroll')){if(rc>r.coins)return;r.coins-=rc;rerollShop(r,save.meta);persist();renderHangar()}
  };
}
function buy(kind,i){
  const r=R(),S=r.shop;const o=S[kind==='part'?'parts':kind==='tune'?'tunes':'mods'][i];if(!o||o.sold)return;
  const p=offerPrice(r,kind,o);if(p>r.coins)return;if(kind==='mod'&&r.mods.length>=MAXMODS)return;
  r.coins-=p;o.sold=true;
  if(kind==='part')r.inv[o.t]=(r.inv[o.t]||0)+1;else if(kind==='tune')r.tune[o.k]=(r.tune[o.k]||0)+1;else r.mods.push(o.id);
  persist();renderHangar();
}
function renderMods(){
  const r=R();
  const slots=Array.from({length:MAXMODS},(_,i)=>{const id=r.mods[i];if(!id)return `<div class="slot">Empty</div>`;const v=sellValue(id);
    return modCard(id,`<button class="buy sell${armSell===id?' armed':''}" type="button" data-sell="${id}">${armSell===id?'Sell?':'Sell +'+v}</button>`)}).join('');
  const tl=Object.entries(r.tune).filter(([,L])=>L>0).map(([k,L])=>`${TUNES[k].name} ×${L}`).join(' · ');
  const byStage={};for(const l of r.log)(byStage[l.stage]=byStage[l.stage]||[]).push(l.score);
  const log=Object.keys(byStage).map(s=>{s=+s;const done=s<r.stage;return `<div><span>Contract ${s+1}${isStorm(s)?' \u00b7 storm':''}</span><b>${byStage[s].map(fmt).join(' · ')}${done?' ✓':''}</b></div>`}).join('');
  bench.innerHTML=`
  <div class="card"><div class="row"><span class="label">Mods</span><span class="hint">${r.mods.length}/${MAXMODS}</span></div><div class="offers">${slots}</div></div>
  <div class="card"><span class="label">Tuning</span><p class="hint" style="margin-top:6px">${tl||'\u2014'}</p></div>
  <div class="card"><span class="label">Log</span><div class="log">${log||'<div>\u2014</div>'}</div></div>
  <div class="card stack"><button class="ghost" type="button" data-copyrun="cur">Copy run</button><button class="ghost${armAbandon?' armed':''}" id="aband2" type="button">${armAbandon?'Tap again':'Abandon run'}</button></div>`;
  bench.onclick=e=>{
    const b=e.target.closest('[data-sell]');
    if(b){const id=b.dataset.sell;if(armSell!==id){armSell=id;renderMods();return}armSell=null;r.mods.splice(r.mods.indexOf(id),1);r.coins+=sellValue(id);persist();renderHangar();return}
    if(e.target.closest('#aband2')){if(!armAbandon){armAbandon=true;renderMods();return}endRun()}
  };
}
$('launch').onclick=()=>{const r=R();if(!r)return;
  if(r.phase==='shop'){r.phase='contract';persist();setTab('build');return}
  if(r.phase==='contract')startFlight()};

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
  F={st,K,S:newFlight(K,st),ts:1,idle:0,wx:w,cam:{x:0,y:20,sc:20},trail:[],parts:[],toasts:[],toastT:0,boom:-1,ended:false,coinFlash:0,endT:0,
    ctx:{mods:r.mods.slice(),flightIdx:r.flight,cleared:r.stage,coins:r.coins,...craftCounts(r.cells)},quota:quotaFor(r.stage,r.level),already:r.score,bestDist:r.bestDist||0};
  ctl.pitch=0;ctl.boost=false;
  show('flight');setThr(1);$('thr').style.visibility=(K.counts.rocket||K.counts.prop)?'visible':'hidden';$('bPop').style.visibility=K.counts.balloon?'visible':'hidden';
  $('toast').innerHTML='';$('toast').style.opacity=0;
  const fw=$('fWx');fw.hidden=!w;if(w)fw.textContent='Storm · '+WEATHER[w].name;
  resize();F.cam.sc=vh/40;
  try{navigator.wakeLock&&navigator.wakeLock.request('screen').catch(()=>{})}catch(_){}
  last=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
}
const lerp=(a,b,t)=>a+(b-a)*t;
function mixHex(a,b,t){const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('')}
function toast(title,sub){F.toasts.push({title,sub});if(F.toasts.length>4)F.toasts.shift()}
function frame(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  const {S,st}=F, has=k=>F.ctx.mods.includes(k);
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
      if(e==='coin'){F.coinFlash=1;for(let j=0;j<8;j++){const a=j/8*6.283;F.parts.push({x:S.x,y:S.y,vx:Math.cos(a)*7+S.vx*.6,vy:Math.sin(a)*7+S.vy*.6,life:.7,r:.22,k:'gold'})}}
      else if(e==='bounce')dust(S.x,S.y-1,8);
      else if(e==='loop')toast('Loop',`+${has('stunt')?1.5:.5} mult`);
      else if(e==='pass')toast('Low pass',`+${has('duster')?.75:.25} mult`);
      else if(e==='thermal')toast('Thermal',`+${has('thermal')?.3:.1} mult`);
      else if(e==='burst')toast('Balloons burst','');
      else if(e==='Sound barrier'){F.boom=0;toast('Sound barrier',has('sonic')?'×2 score':'+1 mult')}
      else if(e==='Kármán line: space')toast('Space',has('escape')?'×3 score':'+2 mult');
      else if(e==='Downdraft!')toast('Downdraft','The storm pushes you down');
      else toast(e,'');
    }
    S.events.length=0;
    if(!F.trail.length||Math.hypot(S.x-F.trail[F.trail.length-1].x,S.y-F.trail[F.trail.length-1].y)*F.cam.sc>6)F.trail.push({x:S.x,y:S.y});
    if(F.trail.length>160)F.trail.shift();
    emit(dt);
  }else if(!F.ended){
    F.ended=true;F.endT=now;F.toasts.length=0;F.toastT=0;
    if(S.crashed){toast('Crashed',has('crashtest')?'+2 mult':'');dust(S.x,S.y,30,true)}
    else if(S.landed)toast('Touchdown',has('greaser')?'×1.5 score':'+0.5 mult');
  }
  updParts(dt);draw(now);hud(dt);
  if(F.ended&&now-F.endT>1300){finish();return}
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

function draw(now){
  const {S,st}=F,K=F.K, cam=F.cam;
  const v=Math.hypot(S.vx,S.vy);
  const viewH=Math.max(36,S.y*1.25+18,v*1.3);
  cam.sc=Math.exp(lerp(Math.log(cam.sc),Math.log(vh/viewH),.08));
  const sc=cam.sc;
  cam.x=S.x+.16*vw/sc;
  cam.y=Math.max(S.y+RES*.5/sc,.35*vh/sc);
  const X=wx=>vw/2+(wx-cam.x)*sc, Y=wy=>vh/2-(wy-cam.y)*sc;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const alt=cam.y, a1=clamp(alt/12000,0,1), a2=clamp((alt-12000)/60000,0,1);
  let top=mixHex(mixHex('#4fa4e6','#1d4f9c',a1),'#03050f',a2), bot=mixHex(mixHex('#cfeaf8','#6fa3d8',a1),'#0a1230',a2);
  if(F.wx){const k=F.wx==='thin'?.25:.35;top=mixHex(top,'#5a6878',k);bot=mixHex(bot,'#a9b4bf',k)}
  const sky=ctx.createLinearGradient(0,0,0,vh);sky.addColorStop(0,top);sky.addColorStop(1,bot);ctx.fillStyle=sky;ctx.fillRect(0,0,vw,vh);
  const starA=clamp((alt-15000)/40000,0,1);
  if(starA>0){ctx.fillStyle='rgba(255,255,255,'+starA+')';for(let i=0;i<140;i++){const sx=(hs(i*1.7)*vw*1.3-cam.x*sc*.0005)%vw,sy=hs(i*3.3)*vh;ctx.fillRect((sx+vw)%vw,sy,hs(i)*1.6+.5,hs(i)*1.6+.5)}}
  if(!F.wx){const sunX=vw*.78,sunY=RES+vh*.16;
    const sg=ctx.createRadialGradient(sunX,sunY,4,sunX,sunY,90);sg.addColorStop(0,'rgba(255,244,200,.9)');sg.addColorStop(.25,'rgba(255,230,160,.35)');sg.addColorStop(1,'rgba(255,230,160,0)');
    ctx.fillStyle=sg;ctx.fillRect(sunX-90,sunY-90,180,180);ctx.fillStyle='#fff6d8';ctx.beginPath();ctx.arc(sunX,sunY,16,0,7);ctx.fill()}
  const left=cam.x-vw/2/sc, right=cam.x+vw/2/sc;
  if((right-left)/400<200){ctx.fillStyle='rgba(255,255,255,.75)';
    for(let k=Math.floor(left/400)-1;k<=Math.ceil(right/400)+1;k++){const h=hs(k*2.3);if(h>.6)continue;const cx=k*400+hs(k*4.4)*300,cy=150+hs(k*6.6)*900,w=30+hs(k*8.8)*40;
      const px=X(cx),py=Y(cy),pw=w*sc;if(pw<3||py<-pw||py>vh+pw)continue;
      ctx.beginPath();ctx.ellipse(px,py,pw*.5,pw*.18,0,0,7);ctx.ellipse(px-pw*.2,py-pw*.08,pw*.25,pw*.16,0,0,7);ctx.ellipse(px+pw*.15,py-pw*.1,pw*.22,pw*.15,0,0,7);ctx.fill()}}
  // thunderheads
  if(st.ceiling){const cy=Y(st.ceiling);if(cy>0){
    const g=ctx.createLinearGradient(0,cy-140,0,cy+20);g.addColorStop(0,'rgba(40,46,58,.92)');g.addColorStop(1,'rgba(70,78,92,.0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,vw,cy+20);ctx.fillStyle='rgba(50,56,68,.9)';ctx.beginPath();ctx.moveTo(0,0);
    for(let x=0;x<=vw+30;x+=30){const u=x+cam.x*sc*.3;ctx.lineTo(x,cy-8-Math.abs(Math.sin(u*.021))*18)}ctx.lineTo(vw,0);ctx.closePath();ctx.fill();
    if(S.flags.storm&&Math.random()<.04){ctx.fillStyle='rgba(255,255,240,.35)';ctx.fillRect(0,0,vw,vh)}}}
  const gy=Y(0);
  if(gy<vh+200){
    for(const [col,base,freq,par] of [['#8fb7a4',70,.006,.05],['#6f9e7d',40,.011,.09]]){
      ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(0,gy);
      for(let x=0;x<=vw+20;x+=20){const u=x+cam.x*sc*par;ctx.lineTo(x,gy-base-Math.sin(u*freq)*base*.5-Math.sin(u*freq*2.7+1)*base*.25)}
      ctx.lineTo(vw,gy);ctx.closePath();ctx.fill()}
    ctx.fillStyle='#5f8f4a';ctx.fillRect(0,gy,vw,Math.max(0,vh-gy));
    ctx.fillStyle='#4c7a3a';ctx.fillRect(0,gy,vw,Math.min(6,Math.max(2,.4*sc)));
    const cx0=X(-500),cx1=X(0),cTop=Y(20);
    if(cx1>0){ctx.fillStyle='#8a6a48';ctx.fillRect(cx0,cTop,cx1-cx0,gy-cTop);ctx.fillStyle='#5f8f4a';ctx.fillRect(cx0,cTop,cx1-cx0,Math.max(2,.4*sc));
      ctx.save();ctx.translate(X(-4),Y(20));ctx.scale(sc,sc);ctx.fillStyle='#7a5228';ctx.fillRect(-2,-1.2,4,1.2);ctx.strokeStyle='#5a3a18';ctx.lineWidth=.3;ctx.beginPath();ctx.moveTo(-1.5,-1.2);ctx.lineTo(1.2,-3);ctx.stroke();ctx.restore()}
    const steps=[10,50,100,500,1000,5000,1e4,5e4,1e5,5e5,1e6,5e6,1e7,5e7,1e8,5e8,1e9,5e9,1e10,1e11,1e12,1e13];
    const sp=steps.find(s=>s*sc>=90)||steps[steps.length-1];
    ctx.font='600 11px "Chakra Petch", ui-monospace, monospace';ctx.textAlign='center';
    for(let k=Math.max(1,Math.floor(left/sp));k<=Math.ceil(right/sp);k++){const px=X(k*sp);ctx.fillStyle='rgba(12,26,44,.55)';ctx.fillRect(px-1,gy-12,2,12);ctx.fillStyle='rgba(233,241,247,.9)';ctx.fillText(fmtD(k*sp),px,gy+16)}
    if(F.bestDist>0){const px=X(F.bestDist);if(px>-20&&px<vw+20){ctx.strokeStyle='#ffb020';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px,gy);ctx.lineTo(px,gy-38);ctx.stroke();ctx.fillStyle='#ffb020';ctx.beginPath();ctx.moveTo(px,gy-38);ctx.lineTo(px+16,gy-32);ctx.lineTo(px,gy-26);ctx.fill();ctx.fillStyle='#1b1206';ctx.fillText('BEST',px+2,gy-44)}}
  }
  if((right-left)/120<300){
    for(let k=Math.floor(left/120)-1;k<=Math.ceil(right/120)+1;k++){const t=thermalSeg(k,st);if(!t)continue;const px=X(t.cx),w=22*sc;if(px<-w||px>vw+w)continue;
      const ty=Y(t.top);const gr=ctx.createLinearGradient(0,gy,0,ty);gr.addColorStop(0,'rgba(255,240,210,.32)');gr.addColorStop(1,'rgba(255,240,210,0)');
      ctx.fillStyle=gr;ctx.fillRect(px-w/2,ty,w,gy-ty);
      ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=1.5;const ph=(now/600)%1;
      for(let i=0;i<4;i++){const yy=lerp(gy,ty,((i/4+ph)%1));ctx.beginPath();ctx.moveTo(px-w*.2,yy+6);ctx.lineTo(px,yy);ctx.lineTo(px+w*.2,yy+6);ctx.stroke()}}}
  const mag=st.magnetR>1;
  if(mag&&!S.done){const R0=COINR*st.magnetR*sc;ctx.save();ctx.strokeStyle='rgba(255,196,60,.45)';ctx.lineWidth=1.5;ctx.setLineDash([5,6]);ctx.lineDashOffset=-now/40;
    ctx.beginPath();ctx.arc(X(S.x),Y(S.y),R0,0,7);ctx.stroke();ctx.restore()}
  if((right-left)/COINSEG<700){
    for(let k=Math.floor(left/COINSEG)-1;k<=Math.ceil(right/COINSEG)+1;k++){if(S.got.has(k))continue;const cn=coinAt(k);if(!cn)continue;let cx=cn.x,cy=cn.y;
      if(mag){const dx=S.x-cx,dy=S.y-cy,dd=Math.hypot(dx,dy),R0=COINR*st.magnetR;if(dd<R0*2.2&&dd>0){const f=clamp((R0*2.2-dd)/(R0*1.2),0,1)*.6;cx+=dx*f;cy+=dy*f}}
      const px=X(cx),py=Y(cy);if(py<-20||py>vh+20)continue;
      const r=Math.max(3,.8*sc),sq=Math.abs(Math.cos(now/300+k));
      ctx.fillStyle='#ffb020';ctx.beginPath();ctx.ellipse(px,py,r*(.35+.65*sq),r,0,0,7);ctx.fill();ctx.strokeStyle='#b87300';ctx.lineWidth=Math.max(1,r*.18);ctx.stroke()}}
  // wind streaks
  if(st.wind||st.gust){ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=1.5;
    for(let i=0;i<24;i++){const spd=st.wind?260+hs(i)*160:0, vy=st.gust?Math.sin(now/700+i)*120:0;
      const x=((hs(i*7.1)*(vw+120)-now/1000*spd)%(vw+120)+vw+120)%(vw+120)-60, y=((hs(i*3.7)*vh+now/1000*vy)%vh+vh)%vh;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(st.wind?28:0),y+(st.gust?-Math.sign(vy)*14:0));ctx.stroke()}}
  if(F.trail.length>1){ctx.lineCap='round';for(let i=1;i<F.trail.length;i++){const a=F.trail[i-1],b=F.trail[i];ctx.strokeStyle='rgba(255,255,255,'+(.5*i/F.trail.length)+')';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(X(a.x),Y(a.y));ctx.lineTo(X(b.x),Y(b.y));ctx.stroke()}}
  for(const p of F.parts){const px=X(p.x),py=Y(p.y),r=Math.max(1,p.r*sc);
    ctx.fillStyle=p.k==='fire'?`rgba(255,${Math.round(140+100*p.life)},60,${p.life})`:p.k==='debris'?`rgba(90,70,50,${p.life})`:p.k==='pop'?`rgba(255,90,78,${p.life})`:p.k==='gold'?`rgba(255,196,60,${p.life})`:`rgba(240,240,240,${p.life*.5})`;
    ctx.beginPath();ctx.arc(px,py,r,0,7);ctx.fill()}
  const cx=X(S.x),cy=Y(S.y);
  if(F.boom>=0){F.boom+=1/60;const R2=20+F.boom*260;ctx.strokeStyle=`rgba(255,255,255,${Math.max(0,1-F.boom*1.6)})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,R2,0,7);ctx.stroke();if(F.boom>.7)F.boom=-1}
  if(!S.crashed){
    if(sc>=3){ctx.save();ctx.translate(cx,cy);ctx.scale(sc,sc);ctx.rotate(-S.th);
      const frac=K.fuelMax?S.fuel/K.fuelMax:0;
      for(const p of K.parts){ctx.save();ctx.translate(p.lx,-p.ly);drawPart(ctx,p.type,now/1000,{on:p.type==='rocket'?S.rocketOn:S.propOn,frac});ctx.restore()}
      ctx.restore()}
    else{ctx.fillStyle='#ffb020';ctx.beginPath();ctx.arc(cx,cy,4,0,7);ctx.fill();ctx.strokeStyle='#ffb020';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(S.th)*14,cy-Math.sin(S.th)*14);ctx.stroke()}
  }
}
const elD=$('fDist'),elA=$('fAlt'),elV=$('fSpd'),elF=$('fFuel'),elT=$('toast'),elS=$('fScore'),elM=$('fMult'),elN=$('fNeed'),elFF=$('fTs');
function hud(dt){
  const {S}=F,K=F.K;
  elD.textContent=fmtD(Math.max(0,S.x));
  elA.textContent='ALT '+fmtD(Math.max(0,S.y));
  elV.textContent=fmtV(Math.hypot(S.vx,S.vy));
  if(S.burst&&$('bPop').style.visibility!=='hidden')$('bPop').style.visibility='hidden';
  {const t=F.ts>1.15&&!S.done;elFF.hidden=!t;if(t)elFF.textContent='\u25b8\u25b8 '+(F.ts<9.95?F.ts.toFixed(1):Math.round(F.ts))+'\u00d7'}
  const sc=scoreFlight(summaryOf(S,K),F.ctx);
  elS.textContent=fmt(sc.total);elM.textContent='×'+num(sc.mult*sc.xm);
  const need=F.quota-F.already-sc.total;
  elN.textContent=need>0?`need ${fmt(need)} more`:'quota reached';elN.className='need'+(need>0?'':' ok');
  elS.style.color=F.coinFlash>0?'#ffb020':'';F.coinFlash=Math.max(0,F.coinFlash-dt*3);
  elF.style.transform='scaleX('+(K.fuelMax?S.fuel/K.fuelMax:0)+')';
  F.toastT-=dt;
  if(F.toastT<=0){if(F.toasts.length){const t=F.toasts.shift();elT.innerHTML=`${t.title}${t.sub?`<small>${t.sub}</small>`:''}`;elT.style.opacity=1;F.toastT=1.3}else elT.style.opacity=0}
}

/* ================= results ================= */
const reduceMotion=()=>window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function finish(){
  cancelAnimationFrame(raf);
  const r=R(),{S}=F,K=F.K;
  const f=summaryOf(S,K);
  const out=settleFlight(r,save.meta,f);
  persist();
  showResults(out,S);
  F=null;
}
function showResults(out,S){
  const r=R(),sc=out.sc;
  const title=S.crashed?'Crashed':S.banked?'Landed early':S.landed?'Touchdown':S.becalmed?'Becalmed':'Out of time';
  let i=0;const row=(cls,label,val)=>`<div class="tl ${cls}" style="--i:${i++}"><span>${label}</span><b>${val}</b></div>`;
  let h='';
  for(const l of sc.lines.filter(l=>l.t==='b'))h+=row('base',l.label,l.dist?fmtD(l.v):'+'+fmt(l.v));
  h+=row('m sep','Mult','×1');
  for(const l of sc.lines.filter(l=>l.t==='m'))h+=row('m',l.label,'+'+num(l.v));
  for(const l of sc.lines.filter(l=>l.t==='x'))h+=row('x',l.label,'×'+num(l.v));
  const q=out.quota, p0=Math.min(1,out.prevScore/q), p1=Math.min(1,out.contractScore/q);
  let outcome='',btn='',next='';
  if(out.cleared){
    outcome=`<p class="note"><b>Contract cleared</b> \u00b7 +${out.reward+out.interest} coins</p>`+(out.unlocks&&out.unlocks.length?`<p class="note">Unlocked: <b>${out.unlocks.join(', ')}</b></p>`:'');
    btn=out.won?'Continue':'Open shop';next=out.won?'won':'shop';
  }else if(out.failed){outcome=`<p class="note warn">Out of flights</p>`;btn='Run summary';next='over'}
  else{const left=FLIGHTS-out.flightNo;outcome=`<p class="hint">${fmt(q-out.contractScore)} to go \u00b7 ${plural(left,'flight')} left</p>`;btn='Continue';next='hangar'}
  sheet.innerHTML=`<span class="label">Contract ${out.stage+1} · flight ${out.flightNo} of ${FLIGHTS}</span>
    <h2>${title}</h2>
    <div class="tally">${h}</div>
    <div class="total"><span class="eq">${fmt(sc.base)} × ${num(sc.mult)}${sc.xm>1?' × '+num(sc.xm):''}</span><span class="sc" id="scCount">${reduceMotion()?fmt(sc.total):'0'}</span></div>
    <div class="cbar${out.cleared?' done':''}"><i id="rbar" style="transform:scaleX(${p0})"></i><span id="rbarT">${fmt(out.prevScore)} / ${fmt(q)}</span></div>
    <p class="hint">+${out.pay} coins</p>
    ${outcome}
    <button class="big" type="button" id="next">${btn}</button>`;
  veil.hidden=false;
  const delay=reduceMotion()?0:i*85+150;
  setTimeout(()=>{
    const el=$('scCount'),bar=$('rbar'),bt=$('rbarT');if(!el)return;
    if(bar){bar.style.transform=`scaleX(${p1})`;bt.textContent=`${fmt(out.contractScore)} / ${fmt(q)}`}
    if(reduceMotion()){el.textContent=fmt(sc.total);return}
    const t0=performance.now();const tick=t=>{const k=Math.min(1,(t-t0)/650);el.textContent=fmt(sc.total*(1-Math.pow(1-k,3)));if(k<1&&document.body.contains(el))requestAnimationFrame(tick)};requestAnimationFrame(tick);
  },delay);
  $('next').onclick=()=>{
    if(next==='won'){showVictory();return}
    if(next==='over'){showRunOver();return}
    veil.hidden=true;show('hangar');tab=next==='shop'?'shop':'build';setTab(tab);
  };
}
function runStats(r){return `<dl class="stats"><dt>Total score</dt><dd>${fmt(r.total)}</dd><dt>Best flight</dt><dd>${fmt(r.best)}</dd><dt>Longest flight</dt><dd>${fmtD(r.bestDist||0)}</dd><dt>Flights</dt><dd>${r.log.length}</dd></dl>`}
function showVictory(){
  const r=R(),m=save.meta;
  sheet.innerHTML=`<span class="label">${r.level?'Ceiling '+r.level:'Run'}</span>
    <h2>Run complete</h2>
    ${runStats(r)}
    ${r.unlocks.length?`<p class="note">Unlocked: <b>${r.unlocks.join(', ')}</b></p>`:''}
    ${m.level>r.level?`<p class="note">Ceiling <b>${r.level+1}</b> unlocked</p>`:''}
    <button class="big win" type="button" id="endless">Keep flying \u00b7 endless</button>
    <button class="big alt" type="button" id="retire">Retire</button><button class="ghost" type="button" data-copyrun="cur">Copy run</button>`;
  veil.hidden=false;
  $('endless').onclick=()=>{r.endless=true;r.phase='shop';r.shop=genShop(r,m);weatherOf(r,r.stage);persist();veil.hidden=true;show('hangar');setTab('shop')};
  $('retire').onclick=()=>endRun();
}
function showRunOver(){
  const r=R();
  const n=r.stage;
  sheet.innerHTML=`<span class="label">${r.level?'Ceiling '+r.level:'Run'}</span>
    <h2>${r.endless?'The streak ends':'Grounded'}</h2>
    <p class="note">Contracts cleared: <b>${n}${r.endless?'':' / '+CONTRACTS}</b></p>
    ${runStats(r)}
    ${r.unlocks.length?`<p class="note">Unlocked: <b>${r.unlocks.join(', ')}</b></p>`:''}
    <button class="big" type="button" id="again">Done</button><button class="ghost" type="button" data-copyrun="cur">Copy run</button>`;
  veil.hidden=false;
  $('again').onclick=()=>endRun();
}

/* ================= boot ================= */
show('title');renderTitle();
