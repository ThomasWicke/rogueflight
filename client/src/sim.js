// rogueflight simulation core: pure game logic, no DOM.
// Physics (step), craft assembly (makeCraft), scoring (scoreFlight), economy and run state (newRun, settleFlight).
// Imported by the browser UI (ui.js) and by the node tests/tools, so keep it free of window/document.
const GIMBAL=.4, NEUT=.8, PAR=.0016, VAC=.002, VAC2=1.5e-4, C_LIGHT=299792458, G0=9.81, COLS=7, ROWS=5, COCKPIT={c:2,r:2};
const MAXMODS=5, FLIGHTS=3, CONTRACTS=8, FLIGHT_TIME=300;
// style goals a dedicated build can reach: Redline (500 km/h, needs a strong rocket build) and Cloud nine (5 km, balloons
// with Weather Envelope Lv 2+, or balloons then rockets). The old sound barrier and 100 km were out of reach for any craft.
const REDLINE=500/3.6, CLOUD9=5000;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

/* ---------- parts ---------- */
const PARTS={
  cockpit:{name:'Cockpit',mass:1.0,price:0,mount:'all four sides',blurb:'Holds the pilot and a small fuel reserve. It stays put and works like a frame.'},
  wing:{name:'Wing',mass:0.4,price:4,mount:'left, right or bottom edge, to a frame, tank or the cockpit',blurb:'Lift grows with speed. Flies best with its lift just behind the center of mass. Useless in thin air.'},
  prop:{name:'Propeller',mass:0.7,price:5,mount:'left edge only, to a frame, tank or the cockpit, with a free square in front',blurb:'Steady thrust while fuel lasts. Needs air. Keep it level with the center of mass or it pitches the nose.'},
  rocket:{name:'Rocket',mass:0.9,price:6,mount:'top, bottom or nose edge, to a frame, tank or the cockpit, with a free square behind for the exhaust',blurb:'Hold Boost to fire. Burns 4 fuel per second and works in space. Off-center rockets flip the craft.'},
  tank:{name:'Fuel tank',mass:0.6,price:4,mount:'all four sides, and passes connections on like a frame',blurb:'Adds fuel and weight, and works as structure. Use tanks to move the center of mass.'},
  balloon:{name:'Balloon',mass:0.15,price:4,mount:'bottom edge only (the string), to a frame, tank or the cockpit',blurb:'Pulls upward where it is tied and weakens as the air thins. Bursts above 2 km.'},
  frame:{name:'Frame',mass:0.45,price:3,mount:'all four sides, and passes connections on',blurb:'Light structure. Frames, tanks and the cockpit carry connections onward; everything else must bolt to one of them.'},
};
const PALETTE=['wing','prop','rocket','tank','balloon','frame'];

/* ---------- tuning (stackable shop upgrades) ---------- */
const TUNES={
  prop:{name:'Propeller tuning',d:'+30% propeller thrust',needs:'prop'},
  rocket:{name:'Rocket tuning',d:'+25% rocket thrust',needs:'rocket'},
  fuel:{name:'Bigger tanks',d:'+35% fuel'},
  wing:{name:'Wing flaps',d:'+15% wing lift',needs:'wing'},
  light:{name:'Featherweight',d:'−10% mass'},
  launch:{name:'Catapult spring',d:'+20% launch speed'},
  balloon:{name:'Helium refill',d:'+25% balloon lift',needs:'balloon'},
  // capped: the flight clock is what bounds fuel-free thrust (Solar Wings, Ram Scoop), so it may only stretch so far
  time:{name:'Flight permit',d:'+1 min flight time',max:3},
};
const tuneCost=L=>4+2*L;

/* ---------- mods ---------- */
// Mods level up: an owned mod can come back in the shop as an upgrade (up to MODMAX). v (and w) hold the value per level;
// Lv 1 is weaker than the old flat value, Lv 3 a bit stronger. d shows the current level's value: {v}, {w}, or {v%} for v×100.
const MODMAX=3;
const RARITY={C:{name:'Common',w:60,price:5},U:{name:'Uncommon',w:30,price:7},R:{name:'Rare',w:10,price:10}};
const MODS={
  overclock:{name:'Overclock',r:'C',tag:'Engine',d:'Props: ×{v} thrust, ×2.5 fuel burn.',v:[1.5,1.8,2.1]},
  afterburner:{name:'Afterburner',r:'R',tag:'Engine',d:'Rockets +{v%} thrust per 100 m/s, up to ×4.',v:[.2,.3,.4],lock:4},
  solar:{name:'Solar Wings',r:'R',tag:'Engine',d:'Above 1 km, wings push without fuel ({v%} of a prop).',v:[.2,.3,.4],lock:6},
  secondwind:{name:'Second Wind',r:'C',tag:'Fuel',d:'Empty tanks refill to {v%}, once.',v:[.3,.5,.7]},
  recycler:{name:'Dive Recycler',r:'U',tag:'Fuel',d:'Falling refills fuel, up to {v%}.',v:[.3,.5,.7]},
  ramscoop:{name:'Ram Scoop',r:'R',tag:'Fuel',d:'Above 540 km/h, air refills fuel. Rate ×{v}.',v:[1.5,2,2.5],lock:4},
  burnoff:{name:'Burn-off',r:'U',tag:'Body',d:'Up to {v%} lighter as fuel burns.',v:[.2,.3,.4]},
  slipstream:{name:'Slipstream',r:'U',tag:'Body',d:'Drag ×{v}.',v:[.75,.6,.5]},
  antigrav:{name:'Antigravity Coil',r:'R',tag:'Body',d:'Gravity ×{v}.',v:[.8,.65,.55],lock:6},
  gyro:{name:'Gyroscope',r:'C',tag:'Control',d:'Trim and steering +{v%}.',v:[.5,1,1.5]},
  bounce:{name:'Rubber Hull',r:'U',tag:'Control',d:'No crashes. Bounces +{v} mult.',v:[.1,.2,.3]},
  sling:{name:'Slingshot',r:'C',tag:'Launch',d:'Launch ×{v}, 10° steeper.',v:[1.3,1.6,1.9]},
  thermal:{name:'Thermal Rider',r:'C',tag:'Air',d:'Thermals lift ×{v}. +{w} mult each.',v:[1.2,1.4,1.6],w:[.15,.25,.35]},
  envelope:{name:'Weather Envelope',r:'U',tag:'Air',d:'Balloons +{v}% lift, burst at {w} km.',v:[20,40,60],w:[4,6,8]},
  odometer:{name:'Odometer',r:'C',tag:'Score',d:'+{v} base.',v:[100,150,250]},
  wingman:{name:'Wingman',r:'C',tag:'Score',d:'+{v} mult per wing.',v:[.2,.3,.4]},
  hauler:{name:'Fuel Hauler',r:'U',tag:'Score',d:'+{v} mult per fuel tank.',v:[.25,.4,.55]},
  altimeter:{name:'Altimeter',r:'U',tag:'Score',d:'+{v} mult per km of altitude.',v:[.3,.5,.8]},
  speedtrap:{name:'Speed Trap',r:'C',tag:'Score',d:'+{v} mult per 100 km/h over 200.',v:[.3,.5,.7]},
  duster:{name:'Crop Duster',r:'C',tag:'Score',d:'Low passes +{v} mult.',v:[.5,.75,1]},
  stunt:{name:'Stunt Pilot',r:'U',tag:'Score',d:'Loops +{v} mult.',v:[1,1.5,2]},
  collector:{name:'Coin Collector',r:'C',tag:'Score',d:'Coins +{v} mult each.',v:[.15,.25,.35]},
  opening:{name:'Opening Act',r:'C',tag:'Score',d:'Flight 1 of a contract ×{v}.',v:[1.3,1.5,1.8]},
  third:{name:'Third Time Lucky',r:'U',tag:'Score',d:'Flight 3 of a contract ×{v}.',v:[2,2.5,3]},
  frugal:{name:'Frugal',r:'U',tag:'Score',d:'×{v} if you land with 30% fuel.',v:[1.5,2,2.5]},
  minimal:{name:'Minimalist',r:'R',tag:'Score',d:'×{v} with 6 parts or fewer.',v:[2,2.5,3],lock:8},
  sonic:{name:'Overdrive',r:'U',tag:'Score',d:'Redline ×{v} instead of +1.',v:[1.5,2,2.5]},
  escape:{name:'Escape Plan',r:'R',tag:'Score',d:'Cloud nine ×{v} instead of +2.',v:[2,2.5,3],lock:8},
  greaser:{name:'Greaser',r:'U',tag:'Score',d:'Touchdown ×{v} instead of +0.5.',v:[1.25,1.5,1.75]},
  crashtest:{name:'Crash Test',r:'U',tag:'Score',d:'Crash +{v} mult. Dive in hard.',v:[1,2,3]},
  logbook:{name:'Logbook',r:'R',tag:'Score',d:'×{v} more per contract cleared.',v:[.15,.25,.35],lock:8},
  compound:{name:'Compound Interest',r:'R',tag:'Score',d:'×0.05 per coin held, up to ×{v}.',v:[2,3,4],lock:8},
  piggy:{name:'Piggy Bank',r:'C',tag:'Coins',d:'+1 coin per 5 held after a contract, up to {v}.',v:[3,5,7]},
  coupon:{name:'Coupon Book',r:'U',tag:'Coins',d:'Shop prices −{v}%.',v:[15,25,35]},
  magnet:{name:'Coin Magnet',r:'C',tag:'Coins',d:'Pulls in coins from ×{v} as far.',v:[2,2.5,3]},
  sponsor:{name:'Sponsor Decal',r:'C',tag:'Coins',d:'+{v} coins per flight.',v:[2,3,4]},
};
// owned mods as {id: level}; older saves stored only the ids, which count as Lv 1. Plain id arrays work too (tests).
const modLevels=r=>Array.isArray(r)?Object.fromEntries(r.map(id=>[id,1])):Object.fromEntries(r.mods.map(id=>[id,Math.min(MODMAX,(r.modLv&&r.modLv[id])||1)]));
// a mod's value at the owned level, or 0 when it is not owned
const modVal=(lv,id,key='v')=>lv[id]?MODS[id][key][lv[id]-1]:0;
const fmtVal=x=>String(Math.round(x*100)/100);
function modDesc(id,L){const M=MODS[id];L=L||1;
  return M.d.replace('{v%}',M.v?Math.round(M.v[L-1]*100)+'%':'').replace('{v}',M.v?fmtVal(M.v[L-1]):'').replace('{w}',M.w?fmtVal(M.w[L-1]):'')}

/* ---------- weather on storm contracts ---------- */
const WEATHER={
  headwind:{name:'Headwind',d:s=>`${Math.round((2+.8*s)*3.6)} km/h headwind`},
  ceiling:{name:'Thunderheads',d:s=>`Ceiling at ${250+120*s} m`},
  thin:{name:'Thin air',d:()=>'Half-density air'},
  gusts:{name:'Gusts',d:()=>'Vertical gusts'},
  cargo:{name:'Mail run',d:s=>`+${(1+.25*s).toFixed(2)} t cargo`},
  ration:{name:'Fuel rationing',d:()=>'Tanks 60% full'},
  short:{name:'Short catapult',d:()=>'Catapult at 45%'},
};
function weatherFx(id,s){const f={wind:0,ceiling:0,rhoMul:1,gust:0,cargo:0,fuelMul:1,launchMul:1,clock:FLIGHT_TIME};
  if(id==='headwind')f.wind=-(2+.8*s);else if(id==='ceiling')f.ceiling=250+120*s;else if(id==='thin')f.rhoMul=.5;
  else if(id==='gusts')f.gust=5+.6*s;else if(id==='cargo')f.cargo=1+.25*s;else if(id==='ration')f.fuelMul=.6;else if(id==='short')f.launchMul=.45;
  return f}

/* ---------- storm rewards ---------- */
// After clearing a storm contract the player picks 1 of 2. Buffs stack, but a run has only 3-4 storms, so they stay bounded.
// once: at most one per run. up: offered only while an owned mod can still level up (the offer names the mod).
const BOONS={
  slot:{name:'Hangar Bay',d:'+1 mod slot.',once:true},
  coins:{name:'Prize Money',d:'+15 coins.'},
  upgrade:{name:'Field Upgrade',d:'Free upgrade: {mod}.',up:true},
  drag:{name:'Polished Hull',d:'Drag −8%.'},
  grav:{name:'Updraft Charm',d:'Gravity −8%.'},
  fuel:{name:'Reserve Tanks',d:'Fuel +12%.'},
  thermal:{name:'Thermal Map',d:'Thermals +0.1 mult each.'},
  pass:{name:'Low Rider',d:'Low passes +0.1 mult each.'},
  loop:{name:'Barnstormer',d:'Loops +0.1 mult each.'},
  coin:{name:'Lucky Coin',d:'Coins +0.03 mult each.'},
  land:{name:'Soft Landing',d:'Touchdown +0.25 mult.'},
};
const boonN=(run,id)=>(run.boons&&run.boons[id])||0;
function rollBoons(run){
  const lv=modLevels(run), canUp=run.mods.filter(id=>lv[id]<MODMAX);
  const pool=Object.keys(BOONS).filter(k=>!(BOONS[k].once&&boonN(run,k))&&!(BOONS[k].up&&!canUp.length));
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  return pool.slice(0,2).map(id=>id==='upgrade'?{id,mod:canUp[Math.floor(Math.random()*canUp.length)]}:{id})}
const boonDesc=o=>BOONS[o.id].d.replace('{mod}',o.mod?MODS[o.mod].name:'');
function pickBoon(run,i){
  const o=run.boonOffer&&run.boonOffer[i];if(!o)return false;
  run.boons=run.boons||{};run.boons[o.id]=(run.boons[o.id]||0)+1;
  if(o.id==='coins')run.coins+=15;
  if(o.id==='upgrade'&&run.mods.includes(o.mod)){run.modLv=run.modLv||{};run.modLv[o.mod]=Math.min(MODMAX,(run.modLv[o.mod]||1)+1)}
  run.boonOffer=null;return true}
const modSlots=run=>MAXMODS+boonN(run,'slot');

/* ---------- every run starts the same: a bare cockpit, 12 coins and the opening packs ---------- */
const START={coins:12,inv:{}};
const UNLOCKS=[
  {at:4,text:'Afterburner, Ram Scoop'},
  {at:6,text:'Solar Wings, Antigravity Coil'},
  {at:8,text:'4 rare mods, Ceiling 1'},
];
const modUnlocked=(id,meta)=>!MODS[id].lock||(meta.bestStage||0)>=MODS[id].lock;

/* ---------- contracts ---------- */
const QUOTA=[500,1100,2000,4000,7500,16000,30000,54000];
function quotaFor(i,level){const q=i<CONTRACTS?QUOTA[i]:QUOTA[CONTRACTS-1]*Math.pow(2.5,i-CONTRACTS+1);return Math.round(q*(1+.25*(level||0))/10)*10}
// Ceiling levels: every level adds +25% quota; even levels also add a rule (cumulative)
const MAX_CEILING=10;
const CEILING_RULES={2:'Shop prices +1',4:'Contract 5 has a storm too',6:'1 pack per contract after the first',8:'Storms hit harder',10:'4-minute flight clock'};
const ceilingRules=level=>Object.keys(CEILING_RULES).filter(k=>+k<=(level||0)).map(k=>CEILING_RULES[k]);
const isStorm=(i,level)=>i===CONTRACTS-1||i%3===2||((level||0)>=4&&i===4);
// storm strength grows with the contract; from Ceiling 8 every storm counts as two contracts later
const severity=(run,i)=>i+((run.level||0)>=8?2:0);
function weatherOf(run,i){if(!isStorm(i,run.level))return null;
  if(!run.weather[i]){const used=Object.values(run.weather);const ids=Object.keys(WEATHER).filter(k=>!used.includes(k));const pool=ids.length?ids:Object.keys(WEATHER);run.weather[i]=pool[Math.floor(Math.random()*pool.length)]}
  return run.weather[i]}

/* ---------- physics stats ---------- */
// mods: {id: level} from modLevels(run), or a plain array of ids (counts as Lv 1)
function stats(tune,mods,wx){
  const lv=Array.isArray(mods)?modLevels(mods):mods, has=k=>!!lv[k], mv=(k,key)=>modVal(lv,k,key);
  const t=k=>tune[k]||0, pw=(k,b)=>Math.pow(b,t(k));
  wx=wx||weatherFx(null,0);
  const propMul=pw('prop',1.3);
  return {
    prop:15*propMul*(has('overclock')?mv('overclock'):1), propUse:has('overclock')?3.5:1.4,
    rocket:34*pw('rocket',1.25), afterburner:mv('afterburner'),
    tankFuel:6*pw('fuel',1.35)*wx.fuelMul, reserve:3*pw('fuel',1.35)*wx.fuelMul,
    wing:.075*pw('wing',1.15), wingCD:.012,
    launch:15*pw('launch',1.2)*(has('sling')?mv('sling'):1)*wx.launchMul, launchAng:(20+(has('sling')?10:0))*Math.PI/180,
    massMul:1/(1+.12*t('light')), cargo:wx.cargo,
    balloon:11*pw('balloon',1.25)*(1+mv('envelope')/100), burstAlt:has('envelope')?mv('envelope','w')*1000:2000,
    magnetR:has('magnet')?mv('magnet'):1,
    ramscoop:mv('ramscoop'), recycler:mv('recycler'), secondwind:mv('secondwind'),
    solar:mv('solar'), burnoff:mv('burnoff'), drag:has('slipstream')?mv('slipstream'):1,
    grav:has('antigrav')?mv('antigrav'):1, gyro:mv('gyro'), bounce:has('bounce')?1:0, thermal:has('thermal')?mv('thermal'):1,
    wind:wx.wind, ceiling:wx.ceiling, rhoMul:wx.rhoMul, gust:wx.gust,
    flightTime:(wx.clock||FLIGHT_TIME)+60*Math.min(t('time'),TUNES.time.max),
  };
}

/* ---------- structure ---------- */
// edges: 0 right (nose side), 1 top, 2 left (tail side), 3 bottom
const DIRS=[[1,0],[0,-1],[-1,0],[0,1]];
const SOCK={cockpit:[1,1,1,1],frame:[1,1,1,1],tank:[1,1,1,1],wing:[1,0,1,1],prop:[0,0,1,0],rocket:[1,1,0,1],balloon:[0,0,0,1]};
const STRUCT={cockpit:1,frame:1,tank:1};
function linkage(cells){
  const key=(c,r)=>c+','+r, map=new Map(cells.map(x=>[key(x.c,x.r),x]));
  const start=map.get(key(COCKPIT.c,COCKPIT.r));
  const seen=new Set(), joints=[];
  if(!start)return {list:[],joints,seen};
  seen.add(key(start.c,start.r));const q=[start];
  while(q.length){const p=q.pop();
    for(let e=0;e<4;e++){if(!SOCK[p.type][e])continue;const [dx,dy]=DIRS[e];const n=map.get(key(p.c+dx,p.r+dy));
      if(!n||!SOCK[n.type][(e+2)%4])continue;
      joints.push({c:p.c,r:p.r,e});
      const k=key(n.c,n.r);if(seen.has(k))continue;seen.add(k);if(STRUCT[n.type])q.push(n)}}
  return {list:cells.filter(x=>seen.has(key(x.c,x.r))),joints,seen};
}
const connected=cells=>linkage(cells).list;
const balanceOf=off=>off<=-.3?clamp(1-(-.3-off)*.45,.15,1):clamp(1-(off+.3)*.15,.5,1);
function makeCraft(cells,st){
  const list=connected(cells), parts=[], counts={};
  const occ=new Set(cells.map(x=>x.c+','+x.r));
  let m=0,cx=0,cy=0;
  for(const c of list){const mass=PARTS[c.type].mass*st.massMul;const lx=c.c+.5,ly=-(c.r+.5);
    const blocked=(c.type==='prop'&&occ.has((c.c+1)+','+c.r))||(c.type==='rocket'&&occ.has((c.c-1)+','+c.r));
    parts.push({type:c.type,lx,ly,m:mass,blocked,gc:c.c,gr:c.r});m+=mass;cx+=mass*lx;cy+=mass*ly;if(!blocked)counts[c.type]=(counts[c.type]||0)+1}
  const cg={x:COCKPIT.c+.5,y:-(COCKPIT.r+.5)};
  if(st.cargo){m+=st.cargo;cx+=st.cargo*cg.x;cy+=st.cargo*cg.y}
  cx/=m;cy/=m;let I=0;
  for(const p of parts){p.lx-=cx;p.ly-=cy;I+=p.m*(p.lx*p.lx+p.ly*p.ly+1/6)}
  const cargoPos={x:cg.x-cx,y:cg.y-cy};if(st.cargo)I+=st.cargo*(cargoPos.x**2+cargoPos.y**2+1/6);
  const n=k=>counts[k]||0;
  const wings=parts.filter(p=>p.type==='wing'), props=parts.filter(p=>p.type==='prop'&&!p.blocked), rockets=parts.filter(p=>p.type==='rocket'&&!p.blocked);
  const avg=(a,f)=>a.length?a.reduce((t,p)=>t+f(p),0)/a.length:null;
  return {parts,m,I,cells:list,cargoPos,counts:{prop:n('prop'),rocket:n('rocket'),wing:n('wing'),tank:n('tank'),balloon:n('balloon')},
    fuelMax:st.reserve+n('tank')*st.tankFuel,loose:cells.length-list.length,
    com:{x:cx,y:-cy},lift:avg(wings,p=>p.lx),propLine:avg(props,p=>p.ly),rocketLine:avg(rockets,p=>p.ly),
    blocked:parts.filter(p=>p.blocked).length};
}

/* ---------- world ---------- */
const hs=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)};
const groundY=x=>x<0?20:0;
const COINSEG=40, COINR=3;
function thermalSeg(k,st){if(k<1||hs(k*3.1)>.35)return null;return{cx:k*120+30+hs(k*7.7)*60,top:(70+hs(k*1.9)*60)*(1+.5*(st.thermal-1)),str:6*st.thermal*st.grav}}
// coins thin out with distance so a long flight is not an endless money printer
function coinAt(k){if(k<1)return null;const x=k*COINSEG+20;const p=x<1500?.5:.5*1500/x;if(hs(k*5.3)>p)return null;return{x,y:3+hs(k*9.1)*(25+Math.min(300,x*.03))}}

/* ---------- flight ---------- */
function newFlight(K,st){
  return {x:-4,y:21.2,vx:st.launch*Math.cos(st.launchAng),vy:st.launch*Math.sin(st.launchAng),th:st.launchAng,w:0,fuel:K.fuelMax,t:0,
    maxX:0,maxY:21,maxV:0,ground:0,done:false,crashed:false,landed:false,sw:false,bounces:0,coins:0,got:new Set(),flags:{},events:[],
    rocketOn:false,propOn:false,touch:false,calm:0,slow:0,progX:-4,recyc:0,gPrev:st.launchAng,
    spin:0,loops:0,passes:0,skim:0,passReady:false,thermals:0,thSeen:new Set(),gustE:0,burst:false,popped:false};
}
function segDist(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;let t=l?((px-ax)*dx+(py-ay)*dy)/l:0;t=clamp(t,0,1);return Math.hypot(px-ax-dx*t,py-ay-dy*t)}
function flag(S,k,msg){if(!S.flags[k]){S.flags[k]=1;S.events.push(msg)}}
function step(S,K,st,dt,ctl){
  const px0=S.x,py0=S.y;
  const rho=Math.exp(-Math.max(0,S.y)/8500)*st.rhoMul;
  // aerodynamics use the air-relative velocity, so a headwind costs lift and ground speed
  const ax=S.vx-st.wind, ay=S.vy;
  const v=Math.hypot(ax,ay), q=v*v;
  const c=Math.cos(S.th), s=Math.sin(S.th);
  let ux=0,uy=0,alpha=0;
  if(v>.3){ux=ax/v;uy=ay/v;alpha=Math.atan2(ux*s-uy*c,ux*c+uy*s)}
  const hasFuel=S.fuel>0;
  const light=1-st.burnoff*(1-S.fuel/Math.max(1e-9,K.fuelMax));
  const m=K.m*light, I=K.I*light+.3*st.massMul, W=m*G0*st.grav;
  const pitch=ctl.pitch||0;
  // one throttle drives every engine; old callers that only pass boost keep props on full
  const thrl=ctl.throttle==null?1:clamp(ctl.throttle,0,1), rocketThr=ctl.throttle==null?(ctl.boost?1:0):thrl;
  const nw=K.counts.wing, Lfull=nw*st.wing*rho*q;
  const off=K.lift==null?0:K.lift;
  const Lcap=Lfull*.56*balanceOf(off);
  const up0=K.counts.balloon*st.balloon*rho, Wn=Math.max(0,W-up0);
  // hands off, the autopilot holds a slight climb under power and a shallow glide without it
  const neut=hasFuel&&((K.counts.prop&&thrl>.3)||(K.counts.rocket&&rocketThr>.3))?1.05:NEUT;
  const Lcmd=clamp(Wn*neut-W*1.5*uy+W*2.5*pitch,-Lcap,Lcap);
  const aEff=Lfull>1e-12?.5*Math.asin(clamp(Math.abs(Lcmd)/Lfull,0,1))*Math.sign(Lcmd):0;
  const dev=v>3?Math.atan2(Math.sin(alpha-aEff),Math.cos(alpha-aEff)):0;
  const Lact=Lcmd*Math.max(0,Math.cos(clamp(dev*2.5,-Math.PI/2,Math.PI/2)));
  const sa=Math.sin(Math.min(Math.PI/2,Math.abs(aEff)+Math.abs(dev)));
  let Fx=0,Fy=-W,Ta=0,Tt=0,use=0,thr=0;
  S.rocketOn=false;S.propOn=false;
  for(const p of K.parts){
    const rx=p.lx*c-p.ly*s, ry=p.lx*s+p.ly*c;
    let fx=0,fy=0,tx=0,ty=0;
    if(p.type==='prop'){if(hasFuel&&!p.blocked&&thrl>0){const th=st.prop*rho*thrl;tx=c*th;ty=s*th;thr+=th;use+=st.propUse*thrl;S.propOn=true}}
    else if(p.type==='rocket'){if(hasFuel&&rocketThr>0&&!p.blocked){const th=st.rocket*rocketThr*(1+st.afterburner*Math.min(v,1000)/100);tx=c*th;ty=s*th;thr+=th;use+=4*rocketThr;S.rocketOn=true}}
    else if(p.type==='wing'){
      const L=Lact/nw;Fx+=-uy*L;Fy+=ux*L;
      const D=st.wingCD*rho*q*(.06+sa*sa)*st.drag;fx-=ux*D;fy-=uy*D;
      if(st.solar&&S.y>800){const sp=st.solar*st.prop*clamp((S.y-800)/400,0,1);tx+=c*sp;ty+=s*sp}
    }
    else if(p.type==='balloon'){fy+=st.balloon*rho;const bd=.004*rho*q;fx-=ux*bd;fy-=uy*bd}
    const pd=PAR*rho*q*st.drag;fx-=ux*pd;fy-=uy*pd;
    Fx+=fx+tx;Fy+=fy+ty;Ta+=rx*fy-ry*fx;Tt+=rx*ty-ry*tx;
  }
  if(off>0)Ta+=off*Lact;
  const tk=Math.floor(S.x/120), th=thermalSeg(tk,st);
  if(th&&S.y<th.top){const d=Math.abs(S.x-th.cx);
    // smooth column: strongest in the middle, fading at the edges and near the top, so it lifts rather than kicks
    if(d<12){const b=Math.cos(d/12*Math.PI/2)**2*clamp((th.top-S.y)/25,0,1);Fy+=m*th.str*b}
    if(d<8&&!S.thSeen.has(tk)){S.thSeen.add(tk);S.thermals++;S.events.push('thermal')}}
  // gusts shove the craft up and down and rock its nose. The air sinks a little more than it rises, and the total upward
  // push a flight can get is capped (S.gustE, as velocity it could add), so gusts cost height and make low flying and
  // landings risky; they cannot be ridden or farmed, whichever way the craft is moving
  if(st.gust){const gw=Math.sin(S.x/61+1.3)*Math.cos(S.t*.9+S.x/97)-.08,gF=m*st.gust*gw;
    if(gF<=0)Fy+=gF;else if(S.gustE<17){Fy+=gF;S.gustE+=gF/m*dt}
    Ta+=.12*m*st.gust*Math.sin(S.t*1.7+S.x/43)}
  if(st.ceiling&&S.y>st.ceiling){Fy-=m*(14+.4*(S.y-st.ceiling));flag(S,'storm','Downdraft!')}
  {const k=(VAC+VAC2*v)*(1-Math.exp(-Math.max(0,S.y)/8500))*st.drag;Fx-=m*k*S.vx;Fy-=m*k*S.vy}
  const gyro=1+st.gyro;
  const Amax=(.35*Lcap+.2*W)*gyro;
  {const g=GIMBAL*thr*gyro;Tt=Math.sign(Tt)*Math.max(0,Math.abs(Tt)-g)}
  const gam=Math.atan2(ay,ax);let gd=gam-S.gPrev;gd=Math.atan2(Math.sin(gd),Math.cos(gd));S.gPrev=gam;
  const gdot=v>3?gd/dt:0;
  let Tas;
  if(v>3&&Lfull>.05*W){let e=S.th-(gam+aEff);e=Math.atan2(Math.sin(e),Math.cos(e));Tas=clamp(-(Ta+Tt)-I*(60*e+14*(S.w-gdot)),-Amax,Amax)}
  else Tas=clamp(-(Ta+Tt)-I*6*S.w,-Amax,Amax);
  const Tp=pitch*.35*W*(1+.5*st.gyro);
  let aa=(Ta+Tt+Tas+Tp)/I;aa=clamp(aa,-60,60);
  S.w+=aa*dt;S.w*=Math.exp(-(.8+2*Math.min(1,rho*v/40))*dt);S.w=clamp(S.w,-6,6);S.th+=S.w*dt;
  S.vx+=Fx/m*dt;S.vy+=Fy/m*dt;
  {const sp=Math.hypot(S.vx,S.vy);if(!(sp<=C_LIGHT)){const f=sp>0&&isFinite(sp)?C_LIGHT/sp:0;S.vx=isFinite(S.vx)?S.vx*f:C_LIGHT;S.vy=isFinite(S.vy)?S.vy*f:0;flag(S,'light','Speed of light')}}
  S.x+=S.vx*dt;S.y+=S.vy*dt;S.t+=dt;
  if(use>0)S.fuel-=use*dt;
  if(st.ramscoop&&v>150)S.fuel+=st.ramscoop*.006*(v-150)*rho*dt;
  if(st.recycler&&S.vy<0&&S.recyc<st.recycler*K.fuelMax){const g=Math.min(.1*(-S.vy)*dt,st.recycler*K.fuelMax-S.recyc);S.fuel+=g;S.recyc+=g}
  S.fuel=Math.min(S.fuel,K.fuelMax);
  if(S.fuel<=0){S.fuel=0;if(st.secondwind&&!S.sw){S.sw=true;S.fuel=K.fuelMax*st.secondwind;S.events.push('Second Wind')}}
  if(K.counts.balloon&&!S.burst&&S.y>st.burstAlt){S.burst=true;S.events.push('burst')}
  if(S.x<0&&px0>=0&&S.y<20){S.x=.05;S.vx=Math.abs(S.vx)*.3}
  // ground
  const cs=Math.cos(S.th), sn=Math.sin(S.th);
  let minY=1e18;for(const p of K.parts){const wy=S.y+p.lx*sn+p.ly*cs-.5;if(wy<minY)minY=wy}
  const gy=groundY(S.x), h=minY-gy;
  S.touch=false;
  if(minY<gy){
    S.touch=true;S.y+=gy-minY;
    const imp=-S.vy;
    if(imp>0){
      // a hard hit (over ~55 km/h straight down) or a nose-first impact steeper than 45 degrees is a crash
      {let a=S.th%(2*Math.PI);if(a>Math.PI)a-=2*Math.PI;if(a<-Math.PI)a+=2*Math.PI;
       if(!st.bounce&&(imp>15||(imp>5&&a<-Math.PI/4))){S.crashed=true;S.done=true;S.impact=imp;return}}
      const e=st.bounce?.8:.18;
      S.vy=imp*e;if(imp>2){S.vx*=st.bounce?.97:.95;S.w*=.5}
      if(st.bounce&&imp>4){S.bounces++;S.events.push('bounce')}
    }
    S.vx*=Math.exp(-(st.bounce?.3:1.4)*dt);
    let a=S.th%(2*Math.PI);if(a>Math.PI)a-=2*Math.PI;if(a<-Math.PI)a+=2*Math.PI;S.th-=a*Math.min(1,4*dt);
  }
  // style: loops, and low passes that pull back up
  if(!S.touch){S.spin+=S.w*dt;if(Math.abs(S.spin)>=2*Math.PI){S.loops++;S.spin-=Math.sign(S.spin)*2*Math.PI;S.events.push('loop')}}else S.spin=0;
  const gs=Math.hypot(S.vx,S.vy);
  if(S.touch){S.skim=0;S.passReady=false}
  else if(h<4&&gs>25){S.skim+=dt;if(S.skim>=1)S.passReady=true}
  else{S.skim=0;if(h>8&&S.passReady){S.passReady=false;S.passes++;S.events.push('pass')}}
  // coins
  const R=COINR*st.magnetR, lo=Math.min(px0,S.x)-R, hi=Math.max(px0,S.x)+R;
  let k0=Math.floor(lo/COINSEG), k1=Math.floor(hi/COINSEG);if(k1-k0>400)k0=k1-400;
  if(isFinite(k0)&&isFinite(k1))for(let k=k0;k<=k1;k++){if(S.got.has(k))continue;const cn=coinAt(k);if(!cn)continue;
    if(segDist(cn.x,cn.y,px0,py0,S.x,S.y)<R){S.got.add(k);S.coins++;S.events.push('coin');(S.coinFx=S.coinFx||[]).push(cn)}}
  // records
  const nv=gs;
  if(S.x>S.maxX)S.maxX=S.x;if(S.y>S.maxY)S.maxY=S.y;if(nv>S.maxV)S.maxV=nv;
  if(nv>REDLINE)flag(S,'mach','Redline');
  if(S.y>CLOUD9)flag(S,'karman','Cloud nine');
  if(S.y>11000)flag(S,'cruise','Above the airliners');
  if(nv>11186)flag(S,'escape','Escape velocity');
  if(S.x>40075000)flag(S,'earth','Once around the Earth');
  if(S.touch&&nv<1.5)S.ground+=dt;else S.ground=0;
  const idle=S.fuel<=0||(!S.propOn&&!S.rocketOn);
  if(S.x>S.progX+.5){S.progX=S.x;S.calm=0}else if(idle)S.calm+=dt;
  // stalled in the air (hovering balloons, headwind): end the flight. Climbing or sinking is not stalling, so a balloon
  // can still rise to where it bursts (bounded by burstAlt and the clock)
  if(idle&&nv<6&&!S.touch&&Math.abs(S.vy)<1)S.slow+=dt;else S.slow=0;
  if(Math.abs(S.vy)>1)S.calm=0;
  if(S.calm>6||S.slow>5){S.done=true;S.becalmed=true}
  if(S.ground>.5){S.done=true;S.landed=true}
  if(S.t>st.flightTime){S.done=true;S.timeout=true}
}
// balloons burst: rebuild the craft without them and keep it where it is in the sky
function popBalloons(S,K,st){
  let m=0,x=0,y=0;for(const p of K.parts){if(p.type==='balloon')continue;m+=p.m;x+=p.m*p.lx;y+=p.m*p.ly}
  if(st.cargo){m+=st.cargo;x+=st.cargo*K.cargoPos.x;y+=st.cargo*K.cargoPos.y}
  x/=m;y/=m;const c=Math.cos(S.th),s=Math.sin(S.th);S.x+=x*c-y*s;S.y+=x*s+y*c;
  const K2=makeCraft(K.cells.filter(c=>c.type!=='balloon'),st);K2.fuelMax=K.fuelMax;S.popped=true;return K2;
}
function summaryOf(S,K){return {dist:Math.max(0,S.maxX),maxY:S.maxY,maxV:S.maxV,coins:S.coins,loops:S.loops,passes:S.passes,thermals:S.thermals,
  bounces:S.bounces,mach:!!S.flags.mach,space:!!S.flags.karman,crashed:S.crashed,landed:!!S.landed,banked:!!S.banked,fuelFrac:K.fuelMax?S.fuel/K.fuelMax:0}}

/* ---------- scoring: distance x multipliers ---------- */
// repeated tricks pay less each time: the n-th loop or low pass is worth 1/(1+0.5(n-1)) of the first,
// so technique pays but farming one trick for the whole flight does not
const repeats=n=>{let t=0;for(let k=0;k<n;k++)t+=1/(1+.5*k);return t};
// ctx.lv: owned mods as {id: level} (ctx.mods, a plain id array, still works and counts as Lv 1)
function scoreFlight(f,ctx){
  const lv=ctx.lv||modLevels(ctx.mods||[]), has=k=>!!lv[k], mv=(k,key)=>modVal(lv,k,key), bn=k=>(ctx.boons&&ctx.boons[k])||0, lines=[];
  let base=Math.floor(f.dist);lines.push({t:'b',label:'Distance',v:base,dist:true});
  if(has('odometer')){base+=mv('odometer');lines.push({t:'b',label:'Odometer',v:mv('odometer')})}
  let mult=1,xm=1;
  const addM=(label,v)=>{v=Math.round(v*100)/100;if(v>0){mult+=v;lines.push({t:'m',label,v})}};
  const addX=(label,v)=>{if(v>1){xm*=v;lines.push({t:'x',label,v})}};
  const pl=(n,w)=>n+' '+w+(n===1?'':'s');
  if(f.landed){if(has('greaser'))addX('Greaser touchdown',mv('greaser'));else addM('Clean touchdown',.5);if(bn('land'))addM('Soft Landing',.25*bn('land'))}
  if(f.crashed&&has('crashtest'))addM('Crash Test',mv('crashtest'));
  if(f.loops)addM(pl(f.loops,'loop'),repeats(f.loops)*((has('stunt')?mv('stunt'):.5)+.1*bn('loop')));
  if(f.passes)addM(pl(f.passes,'low pass'),repeats(f.passes)*((has('duster')?mv('duster'):.25)+.1*bn('pass')));
  if(f.thermals)addM(pl(f.thermals,'thermal')+' ridden',f.thermals*((has('thermal')?mv('thermal','w'):.1)+.1*bn('thermal')));
  if(f.bounces&&has('bounce'))addM(pl(f.bounces,'bounce'),f.bounces*mv('bounce'));
  if(f.mach){if(has('sonic'))addX('Overdrive',mv('sonic'));else addM('Redline',1)}
  if(f.space){if(has('escape'))addX('Escape Plan',mv('escape'));else addM('Cloud nine',2)}
  if(has('wingman'))addM('Wingman',mv('wingman')*ctx.wings);
  if(has('hauler'))addM('Fuel Hauler',mv('hauler')*ctx.tanks);
  if(has('altimeter'))addM('Altimeter',mv('altimeter')*Math.floor(f.maxY/1000));
  if(has('speedtrap'))addM('Speed Trap',mv('speedtrap')*Math.max(0,Math.floor((f.maxV*3.6-200)/100)));
  if(f.coins)addM(pl(f.coins,'coin'),f.coins*((has('collector')?mv('collector'):.05)+.03*bn('coin')));
  if(has('opening')&&ctx.flightIdx===0)addX('Opening Act',mv('opening'));
  if(has('third')&&ctx.flightIdx===2)addX('Third Time Lucky',mv('third'));
  if(has('frugal')&&f.landed&&f.fuelFrac>=.3)addX('Frugal',mv('frugal'));
  if(has('minimal')&&ctx.parts<=6)addX('Minimalist',mv('minimal'));
  if(has('logbook')&&ctx.cleared>0)addX('Logbook',1+mv('logbook')*ctx.cleared);
  if(has('compound'))addX('Compound Interest',Math.min(mv('compound'),1+.05*ctx.coins));
  const total=Math.floor(base*mult*xm);
  return {lines,base,mult:Math.round(mult*100)/100,xm,total};
}

/* ---------- run ---------- */
function wpick(obj){let s=0;for(const k in obj)s+=obj[k];let r=Math.random()*s;for(const k in obj){r-=obj[k];if(r<=0)return k}return Object.keys(obj)[0]}
const PART_W={frame:3,wing:3,tank:2.5,prop:2,rocket:1.5,balloon:1.5};
// owned mods below MODMAX come back as upgrades, a bit less often than new mods
function rollMods(run,meta,n,exclude){
  const lv=modLevels(run);
  const pool=Object.keys(MODS).filter(k=>modUnlocked(k,meta)&&(!lv[k]||lv[k]<MODMAX)&&!exclude.includes(k)),out=[];
  while(out.length<n&&pool.length){const w={};for(const k of pool)w[k]=RARITY[MODS[k].r].w*(lv[k]?.7:1);const k=wpick(w);out.push(k);pool.splice(pool.indexOf(k),1)}
  return out}
function rollTunes(run,n,exclude){
  const pool=Object.keys(TUNES).filter(k=>(!TUNES[k].needs||(run.inv[TUNES[k].needs]||0)>0)&&!(TUNES[k].max&&(run.tune[k]||0)>=TUNES[k].max)&&!exclude.includes(k));
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  return pool.slice(0,n)}
function genShop(run,meta){return {parts:[0,1,2].map(()=>({t:wpick(PART_W)})),tunes:rollTunes(run,2,[]).map(k=>({k})),mods:rollMods(run,meta,3,[]).map(id=>({id})),rerolls:0}}
// a reroll is a whole new shop, sold slots included; only the mods on offer right now are kept out of the new picks
function rerollShop(run,meta){
  const S=run.shop;
  S.parts=[0,1,2].map(()=>({t:wpick(PART_W)}));
  S.tunes=rollTunes(run,2,[]).map(k=>({k}));
  S.mods=rollMods(run,meta,3,S.mods.map(o=>o.id)).map(id=>({id}));
  S.rerolls++}
const priceOf=(run,p)=>{const lv=modLevels(run);if(lv.coupon)p=Math.max(1,Math.floor(p*(1-modVal(lv,'coupon')/100)));return p+((run.level||0)>=2?1:0)};
// an upgrade costs the rarity price plus 2 per level already owned
const modPrice=(run,id)=>RARITY[MODS[id].r].price+2*(modLevels(run)[id]||0);
function offerPrice(run,kind,o){return priceOf(run,kind==='part'?PARTS[o.t].price:kind==='tune'?tuneCost(run.tune[o.k]||0):modPrice(run,o.id))}
const rerollCost=run=>2+run.shop.rerolls;
const sellValue=(id,L)=>Math.floor(RARITY[MODS[id].r].price/2)+2*((L||1)-1);
// can this offer be bought right now (coins aside)? New mods need a free slot, upgrades do not
function canBuy(run,kind,o){if(o.sold)return false;if(kind==='mod'){const L=modLevels(run)[o.id];return L?L<MODMAX:run.mods.length<modSlots(run)}return true}
function applyPurchase(run,kind,o){
  const p=offerPrice(run,kind,o);if(!canBuy(run,kind,o)||p>run.coins)return false;
  run.coins-=p;o.sold=true;
  if(kind==='part')run.inv[o.t]=(run.inv[o.t]||0)+1;
  else if(kind==='tune')run.tune[o.k]=(run.tune[o.k]||0)+1;
  else{run.modLv=run.modLv||{};if(run.mods.includes(o.id))run.modLv[o.id]=Math.min(MODMAX,(run.modLv[o.id]||1)+1);else{run.mods.push(o.id);run.modLv[o.id]=1}}
  return true}
function sellMod(run,id){const i=run.mods.indexOf(id);if(i<0)return 0;const v=sellValue(id,modLevels(run)[id]);run.mods.splice(i,1);if(run.modLv)delete run.modLv[id];run.coins+=v;return v}
// everything a flight of this run needs: tunings, mod levels, this contract's weather, the ceiling's clock
function flightStats(run){const w=weatherOf(run,run.stage),fx=weatherFx(w,severity(run,run.stage));if((run.level||0)>=10)fx.clock=240;
  const st=stats(run.tune,modLevels(run),fx),b=k=>boonN(run,k);
  st.drag*=Math.pow(.92,b('drag'));st.grav*=Math.pow(.92,b('grav'));const fm=Math.pow(1.12,b('fuel'));st.tankFuel*=fm;st.reserve*=fm;
  return st}
function newRun(level,meta){
  // seed: cosmetic only (town names, headlines in fiction.js); gameplay randomness stays on Math.random
  const run={seed:Math.floor(Math.random()*1e9),level:level||0,stage:0,flight:0,score:0,total:0,best:0,bestDist:0,coins:START.coins,inv:{...START.inv},
    cells:[{...COCKPIT,type:'cockpit'}],mods:[],modLv:{},boons:{},boonOffer:null,tune:{},weather:{},shop:null,phase:'contract',log:[],endless:false,unlocks:[],packs:[]};
  run.shop=genShop(run,meta);
  grantPacks(run);
  for(let i=0;i<CONTRACTS;i++)weatherOf(run,i);
  return run}
// parts packs: one random part each, handed out at the start of every contract (2, or 4 for the first).
// The opening four always hold a tank, a wing and an engine, so every run can fly; the fourth is random.
const PACKS=2, FIRST_PACKS=4;
function rollPacks(first){
  const out=first?['tank','wing',wpick({prop:PART_W.prop,rocket:PART_W.rocket}),wpick(PART_W)]:Array.from({length:PACKS},()=>wpick(PART_W));
  for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]]}
  return out}
function grantPacks(run){const first=run.stage===0&&!run.endless;(run.packs=run.packs||[]).push(...rollPacks(first).slice(0,first||(run.level||0)<6?99:1))}
function openPack(run){const t=run.packs&&run.packs.shift();if(t)run.inv[t]=(run.inv[t]||0)+1;return t}
function craftCounts(cells){const l=connected(cells);const n=t=>l.filter(c=>c.type===t).length;return {parts:l.length,wings:n('wing'),tanks:n('tank')}}
function settleFlight(run,meta,f){
  const lv=modLevels(run), has=k=>!!lv[k];
  const sc=scoreFlight(f,{lv,boons:run.boons,flightIdx:run.flight,cleared:run.stage,coins:run.coins,...craftCounts(run.cells)});
  const pay=3+f.coins+modVal(lv,'sponsor');
  run.coins+=pay;run.score+=sc.total;run.total+=sc.total;run.flight++;run.best=Math.max(run.best,sc.total);run.bestDist=Math.max(run.bestDist||0,f.dist);
  run.log.push({stage:run.stage,flight:run.flight,score:sc.total,d:Math.round(f.dist),x:Math.round(sc.mult*sc.xm*100)/100});
  meta.bestFlight=Math.max(meta.bestFlight||0,sc.total);
  const quota=quotaFor(run.stage,run.level);
  const out={sc,pay,coinsPicked:f.coins,sponsor:has('sponsor'),quota,contractScore:run.score,prevScore:run.score-sc.total,stage:run.stage,flightNo:run.flight};
  if(run.score>=quota){
    const unused=FLIGHTS-run.flight, storm=isStorm(run.stage,run.level);
    const reward=6+2*unused+(storm?4:0);
    const interest=has('piggy')?Math.min(modVal(lv,'piggy'),Math.floor((run.coins+reward)/5)):0;
    run.coins+=reward+interest;
    Object.assign(out,{cleared:true,reward,unused,storm,interest});
    run.stage++;run.flight=0;run.score=0;
    const before=meta.bestStage||0;meta.bestStage=Math.max(before,run.stage);meta.deepest=Math.max(meta.deepest||0,run.stage);
    out.unlocks=UNLOCKS.filter(u=>u.at>before&&u.at<=meta.bestStage).map(u=>u.text);
    run.unlocks.push(...out.unlocks);
    if(run.stage===CONTRACTS&&!run.endless){run.phase='won';meta.wins=(meta.wins||0)+1;
      if(run.level>=(meta.level||0)&&run.level<MAX_CEILING){meta.level=run.level+1;out.newLevel=meta.level}out.won=true}
    else{run.phase='shop';run.shop=genShop(run,meta);weatherOf(run,run.stage);grantPacks(run);if(storm){run.boonOffer=rollBoons(run);out.boons=true}}
  }else if(run.flight>=FLIGHTS){run.phase='over';out.failed=true}
  return out}

export {
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
};
