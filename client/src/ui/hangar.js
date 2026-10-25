// The hangar: opening it, the shop/mods drawer (docked on wide screens), the show poster and route, the tour map,
// the build grid (tap to place, hold to drag) and the launch button.
import { drawPart } from '../art.js';
import { townOf } from '../fiction.js';
import { initGuide, openGuide } from '../guide.js';
import {
  COCKPIT, COLS, CONTRACTS, DIRS, FLIGHTS, G0, GIMBAL, PALETTE, RARE, ROWS, SOCK, WEATHER,
  balanceOf, baseOf, isOnline, isRare, linkage, makeCraft, modSlots, partName, quotaFor, severity, weatherOf,
} from '../sim.js';
import { MAP, MAP_TOWNS } from '../troupe.js';
import { preloadLayers } from '../world.js';
import {
  $, ICON, R, bench, clientId, curStats, curWx, fmt, keyOf, kinIcon, mul, persist,
  plural, reduceMotion, save, sfx, sheet, show, ui, veil, wxIcon,
} from './core.js';
import { startFlight } from './flight.js';
import { showRunOver, showVictory } from './results.js';
import { showBoons, showPacks } from './rewards.js';
import { ROOM, kinOf, me, readyLabel, roomStrip, showRoomOver, toggleReady } from './rooms.js';
import { renderMods, renderShop } from './shop.js';
import { renderTitle } from './title.js';

/* ================= hangar ================= */
// a bench cell's icon: in a live room the cockpit shows this player's animal
export const cellIcon=p=>p.type==='cockpit'&&ui.slot==='online'&&ROOM?kinIcon(kinOf(clientId())):ICON[keyOf(p)];
export let armClear=false, clearTimer=0;
export const owned=t=>R().inv[t]||0, usedN=t=>R().cells.filter(x=>keyOf(x)===t).length, left=t=>Math.max(0,owned(t)-usedN(t));
// the palette: the six parts, then any rare variants you own
export const palette=()=>[...PALETTE,...Object.keys(RARE).map(k=>k+'+').filter(k=>owned(k)||usedN(k))];
export function openHangar(){
  const r=R();if(!r){show('title');renderTitle();return}
  show('hangar');
  if(isOnline(r)){setTab(ui.tab);if(ROOM&&ROOM.phase==='over')showRoomOver();return}
  if(r.phase==='won'){renderHangar();showVictory();return}
  if(r.phase==='over'){renderHangar();showRunOver();return}
  setTab(ui.tab);
}
// tab: 'build' is the barn itself; 'shop' and 'mods' open the dealer drawer over it
export const dealer=$('dealer'), dbody=$('dealerBody');
// WIDE (landscape screens, same query as the CSS): the hangar stays the phone layout on the left and the dealer is
// docked on the right, always showing the shop or the mods (side), switched by tabs
export const WIDE=matchMedia('(min-width:640px) and (orientation:landscape)');
export let side='shop';
// docked, the drawer lives inside the hangar as its right column (CSS grid); otherwise it goes back to overlay the page
export function dock(){const wide=WIDE.matches,h=$('hangar');dealer.classList.toggle('docked',wide);
  if(wide&&dealer.parentNode!==h)h.insertBefore(dealer,h.querySelector('.hbar'));else if(!wide&&dealer.parentNode===h)document.body.insertBefore(dealer,h.nextSibling);
  return wide}
export function setTab(t){const wide=dock();
  if(wide&&t==='build')t=side;if(t!=='build')side=t;
  ui.tab=t;ui.armSell=null;ui.armAbandon=false;
  const open=t!=='build';
  if(wide){dealer.hidden=$('hangar').hidden;dealer.classList.add('open')}
  else if(open&&dealer.hidden){dealer.hidden=false;requestAnimationFrame(()=>dealer.classList.add('open'))}
  else if(!open&&!dealer.hidden){dealer.classList.remove('open');setTimeout(()=>{if(ui.tab==='build')dealer.hidden=true},260)}
  $('dtShop').setAttribute('aria-pressed',t==='shop');$('dtMods').setAttribute('aria-pressed',t==='mods');
  renderHangar();const r=R();if(!r||r.phase==='won'||r.phase==='over')return;if(r.boonOffer)showBoons();else if(r.packs&&r.packs.length)showPacks()}
$('tShop').onclick=()=>setTab('shop');$('tMods').onclick=()=>setTab('mods');
$('dealerX').onclick=$('dealerScrim').onclick=()=>setTab('build');
$('dtShop').onclick=()=>setTab('shop');$('dtMods').onclick=()=>setTab('mods');
// turning a tablet or resizing the window: re-dock (going narrow closes the drawer)
WIDE.addEventListener('change',()=>{if($('hangar').hidden)return;if(!WIDE.matches){ui.tab='build';dealer.classList.remove('open');dealer.hidden=true}setTab(ui.tab)});
// the season's route: eight towns along a dashed road, storm clouds over stormy towns (all forecast from the start, so
// builds can plan for them), done towns ticked, the plane over the current one
export function routeStrip(r){
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
export let PLANE='';
export function planeURL(){if(PLANE)return PLANE;const c=document.createElement('canvas');c.width=192;c.height=144;const g=c.getContext('2d');
  g.translate(96,88);g.scale(52,52);for(const [t,x,y] of [['wing',0,-1],['frame',-1,0],['cockpit',0,0],['prop',1,0]]){g.save();g.translate(x,y);drawPart(g,t,.4,{lw:.06,mood:'grin',on:true});g.restore()}
  return PLANE=c.toDataURL()}
export function showTour(r,moving){
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
export function forecast(r){const out=[];for(let i=r.stage+1;i<CONTRACTS;i++){const w=weatherOf(r,i);if(w)out.push(`<span title="${WEATHER[w].d(severity(r,i))}"><b>${i+1}</b>${wxIcon(w)}${WEATHER[w].name}</span>`)}
  return out.length?`<div class="fcast">${out.join('')}</div>`:''}
// the show poster: town, which show of the season, the crowd target with a thermometer, ticket stubs for flights left
export function renderStrip(){
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
export function renderHangar(){
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
  if(ui.tab==='shop')renderShop();else if(ui.tab==='mods')renderMods();
  $('launch').textContent=isOnline(r)?readyLabel():r.phase==='shop'?`START CONTRACT ${r.stage+1}`:'LAUNCH!';
  $('launch').classList.toggle('long',$('launch').textContent.length>10); // a smaller size keeps long labels on one line
  $('launch').disabled=isOnline(r)&&(!me()||!me().alive);
}

export function renderBuild(){
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
    <div class="pal" id="pal">${palette().map(t=>`<button type="button" data-t="${t}" aria-pressed="${t===ui.sel}"${isRare(t)?' class="rare"':''}><img alt="" src="${ICON[t]}"><span>${partName(t)}</span><small class="${left(t)?'':'none'}">${left(t)}/${owned(t)}</small></button>`).join('')}</div>
    <div class="blurb" id="blurb">${warns.length?`<span class="warn">${warns.join(' \u00b7 ')}</span>`:''}</div>
  </div>
  <div class="card">
    <span class="label">Craft</span>
    <dl class="stats">${rows.map(([a,b,c])=>`<dt>${a}</dt><dd class="${c}">${b}</dd>`).join('')}</dl>
  </div>`;
  $('grid').onclick=e=>{if(skipClick){skipClick=false;return}const b=e.target.closest('.cell');if(b)placeAt(+b.dataset.c,+b.dataset.r)};
  bindDrag($('grid'));
  $('pal').onclick=e=>{const b=e.target.closest('button');if(b){ui.sel=b.dataset.t;armClear=false;renderBuild()}};
  if(isRare(ui.sel)&&!warns.length)$('blurb').innerHTML=`<span class="rarenote">${partName(ui.sel)}: ${RARE[baseOf(ui.sel)].d}</span>`;
  $('clear').onclick=()=>{if(!armClear){armClear=true;renderBuild();clearTimeout(clearTimer);clearTimer=setTimeout(()=>{armClear=false;if(R())renderBuild()},3000);return}
    armClear=false;r.cells=r.cells.filter(x=>x.type==='cockpit');persist();renderBuild()};
}
// press and hold a part to pick it up; drop it on another square to move it there (swapping with whatever is there)
export let drag=null,skipClick=false;
export const cellAt=(x,y)=>{const el=document.elementFromPoint(x,y);return el&&el.closest?el.closest('#grid .cell'):null};
export function bindDrag(G){
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
export function moveCell(c1,r1,c2,r2){const r=R();
  if((c2===COCKPIT.c&&r2===COCKPIT.r)||(c1===c2&&r1===r2)){renderBuild();return}
  const a=r.cells.find(x=>x.c===c1&&x.r===r1),b=r.cells.find(x=>x.c===c2&&x.r===r2);if(!a){renderBuild();return}
  a.c=c2;a.r=r2;if(b){b.c=c1;b.r=r1}persist();renderBuild()}
export function placeAt(c,y){
  const r=R();
  if(c===COCKPIT.c&&y===COCKPIT.r)return;
  const i=r.cells.findIndex(x=>x.c===c&&x.r===y),type=baseOf(ui.sel),rare=isRare(ui.sel);
  if(i>=0&&keyOf(r.cells[i])===ui.sel)r.cells.splice(i,1);
  else if(left(ui.sel)<=0){$('blurb').innerHTML=`<span class="warn">No ${partName(ui.sel)}${/s$/.test(partName(ui.sel))?'':'s'} left</span>`;return}
  else if(i>=0){r.cells[i].type=type;if(rare)r.cells[i].rare=1;else delete r.cells[i].rare}
  else r.cells.push(rare?{c,r:y,type,rare:1}:{c,r:y,type});
  persist();renderBuild();
}
$('launch').onclick=()=>{const r=R();if(!r)return;
  if(isOnline(r)){toggleReady();return}
  if(r.phase==='shop'){r.phase='contract';persist();setTab('build');return}
  if(r.phase==='contract')startFlight()};

initGuide(ICON,()=>{if(!save.meta.guideSeen){save.meta.guideSeen=true;persist();if(!$('title').hidden)renderTitle()}});
$('hHelp').onclick=openGuide;
