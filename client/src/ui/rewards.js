// Gifts between flights: the storm reward picker and the parts packs (shake, tear, reveal, fly to the tray).
import { drawPart } from '../art.js';
import { decalURL } from '../decals.js';
import { townOf } from '../fiction.js';
import { BOONS, boonDesc, isRare, openPack, partName, pickBoon } from '../sim.js';
import { $, ICON, R, buzz, persist, reduceMotion, sfx, sheet, ui, veil } from './core.js';
import { renderHangar, setTab } from './hangar.js';

/* ================= storm rewards ================= */
// after a cleared storm contract: pick 1 of 2 (rolled in sim and saved, so a reload shows the same pair)
export const BOON_ICON={slot:'+',coins:'¢',upgrade:'↑',drag:'≋',grav:'↥',fuel:'▮',thermal:'≈',pass:'_',loop:'∞',coin:'●',land:'⌒'};
export function showBoons(){
  const r=R();if(!r||!r.boonOffer)return;
  sheet.innerHTML=`<span class="label">Storm cleared</span><h2>Storm reward</h2>
    <div class="boons">${r.boonOffer.map((o,i)=>`<button class="boon" type="button" data-i="${i}" style="--i:${i}"><span class="bow" aria-hidden="true"></span><span class="bi" aria-hidden="true">${o.mod?`<img alt="" src="${decalURL(o.mod,64)}">`:BOON_ICON[o.id]||'★'}</span><b>${BOONS[o.id].name}</b><small>${boonDesc(o)}</small></button>`).join('')}</div>`;
  veil.hidden=false;
  sheet.querySelectorAll('.boon').forEach(b=>b.onclick=()=>{
    if(!pickBoon(r,+b.dataset.i))return;persist();sfx('gift');buzz(20);
    b.classList.add('picked');sheet.querySelectorAll('.boon').forEach(x=>{if(x!==b)x.classList.add('gone')});
    setTimeout(()=>{veil.hidden=true;setTab(ui.tab)},reduceMotion()?0:420)});
}
/* ================= parts packs ================= */
// every contract starts with packs to open: shake, tear the top off, burst, the part pops out and flies to the tray
export const BIG={};
export function bigIcon(t){if(!BIG[t]){const c=document.createElement('canvas');c.width=c.height=240;const g=c.getContext('2d');g.translate(120,120);g.scale(210,210);drawPart(g,t,.33,{frac:1,lw:.035});BIG[t]=c.toDataURL()}return BIG[t]}
export const isEngine=t=>t==='prop'||t==='rocket'||isRare(t); // gold rays for engines and every rare part
// the packet is two copies of one face: the cap above a jagged tear line and the body below it, so it looks whole until torn
export const PW=178,PH=164,CAP=34,TEAR=3;
export const zig=(n,y0,y1)=>Array.from({length:n+1},(_,i)=>`${PW*i/n}px ${i%2?y1:y0}px`);
export const CLIP_CAP=`polygon(${[...zig(2,0,0),...zig(10,CAP,CAP+TEAR).reverse()].join(',')})`;
export const CLIP_BODY=`polygon(${[...zig(10,CAP,CAP+TEAR),...zig(2,PH,PH).reverse()].join(',')})`;
// a parcel in kraft paper tied with string, closed with a red wax seal stamped with the goat; a rare part comes in
// purple paper with brass corners (packs are rolled when granted, so the wrapping can show it)
export const SEAL='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 7.5C6.5 5 6.8 2.6 8.6 2.4c1 0 1.2 1.6 1.1 3.6M15.8 7.5c1.7-2.5 1.4-4.9-.4-5.1-1 0-1.2 1.6-1.1 3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M4.6 9.6l3.5.7M19.4 9.6l-3.5.7" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><path d="M7.8 8.3h8.4l-1 7.6c-.5 3.1-5.9 3.1-6.4 0z" fill="currentColor"/><path d="M10.4 18.6l1.6 3 1.6-3z" fill="currentColor"/></svg>';
export const FACE=rare=>`<div class="pk-face${rare?' rare':''}"><i class="pk-str v"></i><i class="pk-str h"></i><div class="pk-seal">${SEAL}</div><div class="pk-sheen"></div></div>`;
export const packLayers=rare=>`<div class="pk-layer pk-cap" style="clip-path:${CLIP_CAP};-webkit-clip-path:${CLIP_CAP}">${FACE(rare)}</div><div class="pk-layer pk-body" style="clip-path:${CLIP_BODY};-webkit-clip-path:${CLIP_BODY}">${FACE(rare)}</div>`;
export let PK=null;
export const pkStage=$('pkStage'), pkTray=$('pkTray');
export const ms=t=>reduceMotion()?1:t;
export const anim=(el,kf,o)=>el.animate(kf,{fill:'both',...o,duration:ms(o.duration),delay:ms(o.delay||0)});
export function showPacks(){
  const r=R();if(PK||!r||!r.packs||!r.packs.length)return;
  PK={got:[],busy:false,state:'pack'};
  $('pkLabel').textContent=`Packs · ${townOf(r.seed,r.stage).town}`;
  pkTray.innerHTML=r.packs.map(()=>'<i></i>').join('');
  $('pkDone').hidden=true;$('pkSkip').hidden=false;pkTray.hidden=false;$('packs').hidden=false;
  dealPack();
}
export function dealPack(){
  const P=R().packs,left=P.length;
  pkStage.className='pk-stage';
  pkStage.innerHTML=`<div class="pk-rays"><i></i></div><div class="pk-glow"></div>
    <div class="pk-pile">${Array.from({length:Math.min(2,left-1)},(_,i)=>`<div class="pk-back">${packLayers(isRare(P[i+1]))}</div>`).join('')}<button class="pack" type="button" aria-label="${isRare(P[0])?'Open rare pack':'Open pack'}">${packLayers(isRare(P[0]))}</button></div>
    <div class="pk-reveal" hidden><img alt=""><h3></h3><small></small></div>
    <span class="pk-hint">TAP</span><div class="pk-flash"></div>`;
  anim(pkStage.querySelector('.pk-pile'),[{transform:'translateY(-60px) scale(.8)',opacity:0},{transform:'none',opacity:1}],{duration:420,easing:'cubic-bezier(.2,1.5,.4,1)'});
  PK.state='pack';
}
export function sparks(gold){
  const cols=gold?['#ffb020','#ffc23d','#fff1c2','#ff8a2a']:['#7fd3ff','#e9f1f7','#ffb020','#8fdcff'];
  for(let i=0;i<26;i++){const s=document.createElement('i');s.className='pk-spark';s.style.background=cols[i%cols.length];if(i%3===0)s.style.borderRadius='50%';
    pkStage.appendChild(s);const a=Math.random()*Math.PI*2,d=90+Math.random()*150,sz=.6+Math.random()*1.2;
    s.animate([{transform:`translate(0,0) scale(${sz})`,opacity:1},{transform:`translate(${Math.cos(a)*d}px,${Math.sin(a)*d+40}px) scale(0) rotate(${Math.random()*540}deg)`,opacity:0}],
      {duration:700+Math.random()*400,easing:'cubic-bezier(.1,.8,.3,1)',fill:'forwards'}).finished.then(()=>s.remove())}
}
export async function tearPack(){
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
export function fillSlot(i,t){const s=pkTray.children[i];if(!s)return;s.className='on'+(isEngine(t)?' gold':'');s.innerHTML=`<img alt="${partName(t)}" src="${ICON[t]}">`;
  s.animate([{transform:'scale(.4)'},{transform:'scale(1.25)'},{transform:'none'}],{duration:ms(320),easing:'ease-out'})}
export async function collect(){
  if(PK.busy)return;PK.busy=true;
  const i=PK.got.length-1,t=PK.got[i],img=pkStage.querySelector('.pk-reveal img'),cell=pkTray.children[i];
  if(img&&cell){const a=img.getBoundingClientRect(),b=cell.getBoundingClientRect();
    pkStage.querySelectorAll('.pk-reveal h3,.pk-reveal small,.pk-rays,.pk-glow').forEach(el=>anim(el,[{opacity:1},{opacity:0}],{duration:220}));
    await anim(img,[{transform:'none'},{transform:`translate(${b.left+b.width/2-a.left-a.width/2}px,${b.top+b.height/2-a.top-a.height/2}px) scale(${44/a.width}) rotate(360deg)`}],{duration:460,easing:'cubic-bezier(.5,0,.3,1)'}).finished}
  fillSlot(i,t);PK.busy=false;
  if(R().packs.length)dealPack();else finishPacks();
}
// the haul: this batch grouped by part, popping in one after another
export function finishPacks(){
  PK.state='done';$('pkSkip').hidden=true;$('pkDone').hidden=false;pkTray.hidden=true;
  const n={};for(const t of PK.got)n[t]=(n[t]||0)+1;
  pkStage.className='pk-stage';
  pkStage.innerHTML=`<div class="pk-sum">${Object.entries(n).map(([t,k])=>`<div class="${isEngine(t)?'gold':''}"><img alt="" src="${bigIcon(t)}"><b>${partName(t)}</b><small>+${k}</small></div>`).join('')}</div>`;
  pkStage.querySelectorAll('.pk-sum>div').forEach((el,i)=>anim(el,[{opacity:0,transform:'scale(.5) translateY(20px)'},{opacity:1,transform:'scale(1.1)',offset:.7},{opacity:1,transform:'none'}],{duration:420,delay:80+i*110,easing:'ease-out'}));
}
export function openAll(){
  if(!PK||PK.busy||PK.state==='done')return;
  const r=R();
  while(r.packs.length)PK.got.push(openPack(r));
  persist();finishPacks();
}
pkStage.onclick=()=>{if(!PK)return;if(PK.state==='pack')tearPack();else if(PK.state==='reveal')collect()};
$('pkSkip').onclick=openAll;
$('pkDone').onclick=()=>{$('packs').hidden=true;PK=null;renderHangar()};
