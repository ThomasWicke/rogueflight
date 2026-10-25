// After a flight: the score tally sheet, and the run won / run over sheets.
import { headline, townOf } from '../fiction.js';
import { CONTRACTS, FLIGHTS, MODS, genShop, grantPacks, modLevels, weatherOf } from '../sim.js';
import { preloadMap } from '../troupe.js';
import {
  $, DECAL, R, buzz, confetti, fmt, fmtD, num, persist, plural, reduceMotion, save,
  sfx, sheet, show, ui, veil,
} from './core.js';
import { showDailyEnd } from './daily.js';
import { setTab, showTour } from './hangar.js';
import { endRun } from './title.js';

/* ================= results ================= */
// which mod a score line came from, so the tally can show its decal
export const lineMod=label=>Object.keys(MODS).find(id=>label.startsWith(MODS[id].name));
/* The score tally, staged like a show's encore: a stamp slams down, the seat counter rolls, every hype source pops in
   one after another (pitch rising), the multiply slams, the crowd bar fills, and a newspaper prints its headline.
   Tapping the card skips straight to the end. */
export function showResults(out,S,f){
  const r=R(),sc=out.sc,town=townOf(r.seed,out.stage);
  const title=S.crashed?'Crashed':S.banked?'Landed early':S.landed?'Touchdown':S.becalmed?'Becalmed':'Out of time';
  const kind=S.crashed?'bad':S.landed?'good':'meh';
  const base=sc.lines.filter(l=>l.t==='b'), hype=sc.lines.filter(l=>l.t!=='b'), extra=base.filter(l=>!l.dist);
  const q=out.quota, p0=Math.min(1,out.prevScore/q), p1=Math.min(1,out.contractScore/q);
  const barT=v=>isFinite(q)?`Score ${fmt(v)} / ${fmt(q)}`:`Total ${fmt(v)}`;
  let btn='',next='',result='';
  // one result line: sold out (with the bonus), or what is still needed; the gate cash rides along
  if(out.cleared){btn=out.won?'Continue':'Next contract';next=out.won?'won':'shop';preloadMap();
    result=`<div id="tySold" class="soldout" hidden>Contract cleared! <small>+${out.reward+out.pay+(out.over||0)} coins${out.unused?` · ${plural(out.unused,'flight')} to spare`:''}</small></div>`+(out.unlocks&&out.unlocks.length?`<p class="hint">Unlocked: <strong>${out.unlocks.join(', ')}</strong></p>`:'');}
  else if(out.failed){btn='Run summary';next='over';result=`<p class="tres warn">No flights left · +${out.pay} coins</p>`}
  else if(out.dailyDone){btn='See results';next='daily';result=`<p class="tres">Puzzle complete · +${out.pay} coins</p>`}
  else{const left=FLIGHTS-out.flightNo;btn='Continue';next='hangar';result=`<p class="tres">${isFinite(q)?fmt(q-out.contractScore)+' to target · ':''}${plural(left,'flight')} left · +${out.pay} coins</p>`}
  const news=headline({...f,cleared:!!out.cleared},{town:town.town,pilot:'Goat'},r.seed+out.stage*7+out.flightNo);
  sheet.className='sheet tallysheet';
  sheet.innerHTML=`<div class="stamp ${kind}">${title}</div>
    <div class="tc1"><span class="label">${town.town} · flight ${out.flightNo} of ${FLIGHTS}</span>
    <div class="eqn"><span class="drum" id="tyBase">0</span><i>×</i><span id="tyM">1</span><i>=</i><b id="tyT">0</b></div>
    ${extra.length?`<div class="hype bpts">${extra.map(l=>`<span class="hc b in">${l.label}<b>+${fmt(l.v)}</b></span>`).join('')}</div>`:''}
    <div class="hype" id="tyHype">${hype.map((l,k)=>{const m=lineMod(l.label);return `<span class="hc ${l.t}" data-k="${k}">${m&&DECAL?`<img alt="" src="${DECAL(m,48,modLevels(r)[m]||1)}">`:''}${l.label}<b>${l.t==='x'?'×':'+'}${num(l.v)}</b></span>`}).join('')||'<span class="hc none">No stunts this time</span>'}</div></div>
    <div class="tc2"><div class="cbar${out.cleared?' done':''}"><i id="rbar" style="transform:scaleX(${p0})"></i><span id="rbarT">${barT(out.prevScore)}</span></div>
    ${result}
    <div class="clip" id="tyNews" hidden><small>The ${town.town} Gazette</small>${news}</div>
    <button class="big" type="button" id="next">${btn}</button></div>`;
  veil.hidden=false;veil.classList.add('tally');
  const el=id=>$(id), rm=reduceMotion();
  // roll a number up over d ms, ticking digits like a mechanical counter
  const roll=(node,to,d,fmtf=fmt)=>new Promise(res=>{if(rm||skip){node.textContent=fmtf(to);return res()}const t0=performance.now();
    const tick=t=>{const k=Math.min(1,(t-t0)/d);node.textContent=fmtf(to*(1-Math.pow(1-k,3)));if(k<1&&!skip)requestAnimationFrame(tick);else{node.textContent=fmtf(to);res()}};requestAnimationFrame(tick)});
  const wait=ms=>new Promise(res=>setTimeout(res,rm||skip?0:ms));
  let skip=false, done=false;
  const finishNow=()=>{skip=true;sheet.querySelectorAll('.hc').forEach(c=>c.classList.add('in'));el('tyM').textContent=num(sc.mult*sc.xm);el('tyT').textContent=fmt(sc.total);el('tyBase').textContent=fmt(sc.base)+(base.length===1?' m':'');
    el('rbar').style.transform=`scaleX(${p1})`;el('rbarT').textContent=barT(out.contractScore);el('tyNews').hidden=false;if(out.cleared)el('tySold').hidden=false};
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
    if(out.cleared){await wait(700);el('tySold').hidden=false;sfx('fireworks');sfx('fanfare');buzz([20,60,20,60,40]);confetti()}
    await wait(400);el('tyNews').hidden=false;done=true;
  })();
  $('next').onclick=()=>{
    veil.classList.remove('tally');sheet.className='sheet';sheet.onclick=null;
    if(next==='won'){showVictory();return}
    if(next==='daily'){showDailyEnd();return}
    if(next==='over'){showRunOver();return}
    if(next==='shop'&&ui.slot==='run'){showTour(R(),true);return}
    veil.hidden=true;show('hangar');setTab('build');
  };
}
export function runStats(r){return `<dl class="stats"><dt>Total score</dt><dd>${fmt(r.total)}</dd><dt>Best flight</dt><dd>${fmt(r.best)}</dd><dt>Longest flight</dt><dd>${fmtD(r.bestDist||0)}</dd><dt>Flights</dt><dd>${r.log.length}</dd></dl>`}
// end of a season: a won season is a sold-out poster with confetti; a lost one is the torn "tour cancelled" poster
export function showVictory(){
  const r=R(),m=save.meta;
  sheet.className='sheet endsheet win';
  sheet.innerHTML=`<span class="label">${r.level?'Difficulty '+r.level:'Run'}</span>
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
export function showRunOver(){
  const r=R();
  const n=r.stage;
  sheet.className='sheet endsheet lose';
  sheet.innerHTML=`<span class="label">${r.level?'Difficulty '+r.level:'Run'}</span>
    <h2>${r.endless?'Endless run over':'Run over'}</h2>
    <p class="note">Contracts cleared: <b>${n}${r.endless?'':' / '+CONTRACTS}</b></p>
    ${runStats(r)}
    ${r.unlocks.length?`<p class="note">Unlocked: <b>${r.unlocks.join(', ')}</b></p>`:''}
    <button class="big" type="button" id="again">New run</button>`;
  veil.hidden=false;sfx('sad');
  $('again').onclick=()=>{sheet.className='sheet';endRun()};
}
