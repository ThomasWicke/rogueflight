// Balance harness: plays whole runs with a scripted shopper and a scripted pilot, then prints how far runs get
// and the score distribution per contract against its quota. The bot is a weak player on purpose:
// a human who climbs and glides well scores roughly 2x what the 'hands' pilot does late in a run.
//   node tools/bot.js [runs=20] [policy=hands|climb]
import {
  newRun, weatherOf, stats, weatherFx, makeCraft, newFlight, step, popBalloons, summaryOf, settleFlight,
  offerPrice, rerollCost, rerollShop, MAXMODS, quotaFor,
} from '../client/src/sim.js';

const RUNS=+process.argv[2]||20;
const PN=process.argv[3]||'hands';
function fly(K,st,ctlf){let S=newFlight(K,st);let frames=0;
 while(!S.done&&frames<6000){let ts=1;if(S.t>20)ts=Math.min(4,1+(S.t-20)/15);if(S.fuel<=0&&!S.touch&&S.y>2000)ts=Math.max(ts,Math.min(30,S.y/600));
  const total=ts/60,v=Math.hypot(S.vx,S.vy),n=Math.min(40,Math.max(Math.ceil(total/.012),Math.ceil(v*total/.6)));
  for(let i=0;i<n&&!S.done;i++){step(S,K,st,total/n,ctlf(S));if(S.burst&&!S.popped)K=popBalloons(S,K,st)}frames++}
 return {S,K}}
function autoLayout(inv){
  const cells=[{c:2,r:2,type:'cockpit'}];const occ=new Set(['2,2']);const put=(c,r,type)=>{if(c<0||c>6||r<0||r>4||occ.has(c+','+r))return false;cells.push({c,r,type});occ.add(c+','+r);return true};
  let f=inv.frame||0,t=inv.tank||0,w=inv.wing||0,p=inv.prop||0,rk=inv.rocket||0,b=inv.balloon||0;
  let col=3;while(col<=5&&(f>0||t>0)){if(f>0){put(col,2,'frame');f--}else{put(col,2,'tank');t--}col++}
  const spineEnd=col-1;
  if(p>0){put(col,2,'prop');p--}
  if(rk>0){put(1,2,'rocket');rk--}
  for(let c=2;c<=spineEnd&&t>0;c++){put(c,3,'tank');t--}
  for(let c=2;c<=spineEnd&&w>0;c++){put(c,1,'wing');w--}
  for(let c=2;c<=spineEnd&&b>0;c++){if(put(c,1,'balloon'))b--}
  for(let c=2;c<=spineEnd&&rk>0;c++){if(!occ.has(c+',3')&&!occ.has((c-1)+',3')){put(c,3,'rocket');rk--}}
  return cells}
const SCORE=['odometer','wingman','hauler','altimeter','speedtrap','duster','stunt','collector','opening','third','frugal','minimal','sonic','escape','greaser','crashtest','logbook','compound'];
const GOOD=['odometer','wingman','hauler','greaser','opening','third','collector','sponsor','coupon','slipstream','overclock','burnoff','secondwind','logbook','compound','frugal','magnet','sling','thermal','piggy','gyro','envelope','solar','afterburner','ramscoop','altimeter'];
function botShop(run,meta){
  const S=run.shop;
  for(let pass=0;pass<2;pass++){
    for(const o of S.tunes){const p=offerPrice(run,'tune',o);if(!o.sold&&run.coins>=p&&['prop','fuel','wing','light','launch','rocket'].includes(o.k)){run.coins-=p;run.tune[o.k]=(run.tune[o.k]||0)+1;o.sold=true}}
    for(const o of S.mods){const p=offerPrice(run,'mod',o);if(!o.sold&&GOOD.includes(o.id)&&run.mods.length<MAXMODS&&run.coins>=p){run.coins-=p;run.mods.push(o.id);o.sold=true}}
    for(const o of S.parts){const p=offerPrice(run,'part',o);const own=run.inv[o.t]||0;const cap={frame:3,wing:3,tank:3,prop:1,rocket:1,balloon:0}[o.t];
      if(!o.sold&&own<cap&&run.coins>=p){run.coins-=p;run.inv[o.t]=own+1;o.sold=true}}
    if(pass===0&&run.coins>=rerollCost(run)+8){run.coins-=rerollCost(run);rerollShop(run,meta)}else break;
  }
}
const POLS={
  hands:S=>({pitch:S.t<.6?1:0,throttle:1}),
  climb:S=>({pitch:S.fuel>0&&Math.atan2(S.vy,S.vx)<35/57?1:0,throttle:1}),
};
const POL=POLS[PN];if(!POL)throw new Error('unknown policy '+PN+' (use: '+Object.keys(POLS).join(', ')+')');
const reach=[],stageScores={};
for(let n=0;n<RUNS;n++){
  const meta={bestStage:8};const kit='start';
  const run=newRun(kit,0,meta);
  botShop(run,meta);
  let guard=0;
  while(run.phase!=='over'&&run.phase!=='won'&&guard++<60){
    if(run.phase==='shop'){botShop(run,meta);run.phase='contract'}
    run.cells=autoLayout(run.inv);
    const wx=weatherOf(run,run.stage);const st=stats(run.tune,run.mods,weatherFx(wx,run.stage));const K=makeCraft(run.cells,st);
    const {S,K:K2}=fly(K,st,POL);
    const f=summaryOf(S,K2);const stg=run.stage;const out=settleFlight(run,meta,f);
    (stageScores[stg]=stageScores[stg]||[]).push(out.sc.total);
  }
  reach.push(run.stage);console.log('run',n,kit.padEnd(8),'cleared',run.stage,'coins',run.coins,'mods',run.mods.join(','),'tune',JSON.stringify(run.tune));
}
console.log('avg cleared',(reach.reduce((a,b)=>a+b,0)/reach.length).toFixed(2),'dist',JSON.stringify(reach.reduce((m,x)=>(m[x]=(m[x]||0)+1,m),{})));
for(const k in stageScores){const a=stageScores[k].sort((x,y)=>x-y);console.log('contract',+k+1,'quota',quotaFor(+k,0),'flights',a.length,'median',a[Math.floor(a.length/2)],'p80',a[Math.floor(a.length*.8)],'max',a[a.length-1])}
