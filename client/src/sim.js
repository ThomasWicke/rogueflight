// rogueflight simulation core: pure game logic, no DOM.
// Physics (step), craft assembly (makeCraft), scoring (scoreFlight), economy and run state (newRun, settleFlight).
// Imported by the browser UI (ui.js) and by the node tests/tools, so keep it free of window/document.
const GIMBAL=.4, NEUT=.8, PAR=.0016, VAC=.002, VAC2=1.5e-4, C_LIGHT=299792458, G0=9.81, COLS=7, ROWS=5, COCKPIT={c:2,r:2};
const MAXMODS=5, FLIGHTS=3, CONTRACTS=8, FLIGHT_TIME=300;
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
const RARITY={C:{name:'Common',w:60,price:5},U:{name:'Uncommon',w:30,price:7},R:{name:'Rare',w:10,price:10}};
const MODS={
  overclock:{name:'Overclock',r:'C',tag:'Engine',d:'Props: ×1.8 thrust, ×2.5 fuel burn.'},
  afterburner:{name:'Afterburner',r:'R',tag:'Engine',d:'Rockets +30% thrust per 100 m/s, up to ×4.',lock:4},
  solar:{name:'Solar Wings',r:'R',tag:'Engine',d:'Above 1 km, wings push without fuel.',lock:6},
  secondwind:{name:'Second Wind',r:'C',tag:'Fuel',d:'Empty tanks refill to 50%, once.'},
  recycler:{name:'Dive Recycler',r:'U',tag:'Fuel',d:'Falling refills fuel, up to 50%.'},
  ramscoop:{name:'Ram Scoop',r:'R',tag:'Fuel',d:'Above 540 km/h, air refills fuel.',lock:4},
  burnoff:{name:'Burn-off',r:'U',tag:'Body',d:'Up to 30% lighter as fuel burns.'},
  slipstream:{name:'Slipstream',r:'U',tag:'Body',d:'Drag ×0.6.'},
  antigrav:{name:'Antigravity Coil',r:'R',tag:'Body',d:'Gravity ×0.65.',lock:6},
  gyro:{name:'Gyroscope',r:'C',tag:'Control',d:'Double trim and steering.'},
  bounce:{name:'Rubber Hull',r:'U',tag:'Control',d:'No crashes. Bounces +0.2 mult.'},
  sling:{name:'Slingshot',r:'C',tag:'Launch',d:'Launch ×1.6, 10° steeper.'},
  thermal:{name:'Thermal Rider',r:'C',tag:'Air',d:'Thermals lift ×2.5. +0.3 mult each.'},
  envelope:{name:'Weather Envelope',r:'U',tag:'Air',d:'Balloons +40% lift, burst at 6 km.'},
  odometer:{name:'Odometer',r:'C',tag:'Score',d:'+150 base.'},
  wingman:{name:'Wingman',r:'C',tag:'Score',d:'+0.3 mult per wing.'},
  hauler:{name:'Fuel Hauler',r:'U',tag:'Score',d:'+0.4 mult per fuel tank.'},
  altimeter:{name:'Altimeter',r:'U',tag:'Score',d:'+0.5 mult per km of altitude.'},
  speedtrap:{name:'Speed Trap',r:'C',tag:'Score',d:'+0.5 mult per 100 km/h over 200.'},
  duster:{name:'Crop Duster',r:'C',tag:'Score',d:'Low passes +0.75 mult.'},
  stunt:{name:'Stunt Pilot',r:'U',tag:'Score',d:'Loops +1.5 mult.'},
  collector:{name:'Coin Collector',r:'C',tag:'Score',d:'Coins +0.25 mult each.'},
  opening:{name:'Opening Act',r:'C',tag:'Score',d:'Flight 1 of a contract ×1.5.'},
  third:{name:'Third Time Lucky',r:'U',tag:'Score',d:'Flight 3 of a contract ×3.'},
  frugal:{name:'Frugal',r:'U',tag:'Score',d:'×2 if you land with 30% fuel.'},
  minimal:{name:'Minimalist',r:'R',tag:'Score',d:'×3 with 6 parts or fewer.',lock:8},
  sonic:{name:'Sonic Boom',r:'U',tag:'Score',d:'Sound barrier ×2 instead of +1.'},
  escape:{name:'Escape Plan',r:'R',tag:'Score',d:'Space ×3 instead of +2.',lock:8},
  greaser:{name:'Greaser',r:'U',tag:'Score',d:'Touchdown ×1.5 instead of +0.5.'},
  crashtest:{name:'Crash Test',r:'U',tag:'Score',d:'Crash +2 mult. Dive in hard.'},
  logbook:{name:'Logbook',r:'R',tag:'Score',d:'×0.25 per contract cleared.',lock:8},
  compound:{name:'Compound Interest',r:'R',tag:'Score',d:'×0.05 per coin held, up to ×3.',lock:8},
  piggy:{name:'Piggy Bank',r:'C',tag:'Coins',d:'+1 coin per 5 held after a contract.'},
  coupon:{name:'Coupon Book',r:'U',tag:'Coins',d:'Shop prices −25%.'},
  magnet:{name:'Coin Magnet',r:'C',tag:'Coins',d:'Pulls in coins from ×2.5 as far.'},
  sponsor:{name:'Sponsor Decal',r:'C',tag:'Coins',d:'+3 coins per flight.'},
};

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
function weatherFx(id,s){const f={wind:0,ceiling:0,rhoMul:1,gust:0,cargo:0,fuelMul:1,launchMul:1};
  if(id==='headwind')f.wind=-(2+.8*s);else if(id==='ceiling')f.ceiling=250+120*s;else if(id==='thin')f.rhoMul=.5;
  else if(id==='gusts')f.gust=5+.6*s;else if(id==='cargo')f.cargo=1+.25*s;else if(id==='ration')f.fuelMul=.6;else if(id==='short')f.launchMul=.45;
  return f}

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
const isStorm=i=>i===CONTRACTS-1||i%3===2;
function weatherOf(run,i){if(!isStorm(i))return null;
  if(!run.weather[i]){const used=Object.values(run.weather);const ids=Object.keys(WEATHER).filter(k=>!used.includes(k));const pool=ids.length?ids:Object.keys(WEATHER);run.weather[i]=pool[Math.floor(Math.random()*pool.length)]}
  return run.weather[i]}

/* ---------- physics stats ---------- */
function stats(tune,mods,wx){
  const t=k=>tune[k]||0, has=k=>mods.includes(k), pw=(k,b)=>Math.pow(b,t(k));
  wx=wx||weatherFx(null,0);
  const propMul=pw('prop',1.3);
  return {
    prop:15*propMul*(has('overclock')?1.8:1), propUse:has('overclock')?3.5:1.4,
    rocket:34*pw('rocket',1.25), afterburner:has('afterburner')?.3:0,
    tankFuel:6*pw('fuel',1.35)*wx.fuelMul, reserve:3*pw('fuel',1.35)*wx.fuelMul,
    wing:.075*pw('wing',1.15), wingCD:.012,
    launch:15*pw('launch',1.2)*(has('sling')?1.6:1)*wx.launchMul, launchAng:(20+(has('sling')?10:0))*Math.PI/180,
    massMul:1/(1+.12*t('light')), cargo:wx.cargo,
    balloon:11*pw('balloon',1.25)*(has('envelope')?1.4:1), burstAlt:has('envelope')?6000:2000,
    magnetR:has('magnet')?2.5:1,
    ramscoop:has('ramscoop')?2:0, recycler:has('recycler')?1:0, secondwind:has('secondwind')?.5:0,
    solar:has('solar')?.3:0, burnoff:has('burnoff')?.3:0, drag:has('slipstream')?.6:1,
    grav:has('antigrav')?.65:1, gyro:has('gyro')?1:0, bounce:has('bounce')?1:0, thermal:has('thermal')?2.5:1,
    wind:wx.wind, ceiling:wx.ceiling, rhoMul:wx.rhoMul, gust:wx.gust,
    flightTime:FLIGHT_TIME+60*Math.min(t('time'),TUNES.time.max),
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
function thermalSeg(k,st){if(k<1||hs(k*3.1)>.35)return null;return{cx:k*120+30+hs(k*7.7)*60,top:(70+hs(k*1.9)*60)*(1+.5*(st.thermal-1)),str:6*st.thermal}}
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
  if(st.recycler&&S.vy<0&&S.recyc<.5*K.fuelMax){const g=Math.min(.1*(-S.vy)*dt,.5*K.fuelMax-S.recyc);S.fuel+=g;S.recyc+=g}
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
    if(segDist(cn.x,cn.y,px0,py0,S.x,S.y)<R){S.got.add(k);S.coins++;S.events.push('coin')}}
  // records
  const nv=gs;
  if(S.x>S.maxX)S.maxX=S.x;if(S.y>S.maxY)S.maxY=S.y;if(nv>S.maxV)S.maxV=nv;
  if(nv>343)flag(S,'mach','Sound barrier');
  if(S.y>11000)flag(S,'cruise','Above the airliners');
  if(S.y>100000)flag(S,'karman','Kármán line: space');
  if(nv>11186)flag(S,'escape','Escape velocity');
  if(S.x>40075000)flag(S,'earth','Once around the Earth');
  if(S.touch&&nv<1.5)S.ground+=dt;else S.ground=0;
  const idle=S.fuel<=0||(!S.propOn&&!S.rocketOn);
  if(S.x>S.progX+.5){S.progX=S.x;S.calm=0}else if(idle)S.calm+=dt;
  // stalled in the air (balloons, headwind): end the flight unless it is still coming down
  if(idle&&nv<6&&!S.touch&&S.vy>-.5)S.slow+=dt;else S.slow=0;
  if(S.vy<-.5)S.calm=0;
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
function scoreFlight(f,ctx){
  const has=k=>ctx.mods.includes(k), lines=[];
  let base=Math.floor(f.dist);lines.push({t:'b',label:'Distance',v:base,dist:true});
  if(has('odometer')){base+=150;lines.push({t:'b',label:'Odometer',v:150})}
  let mult=1,xm=1;
  const addM=(label,v)=>{v=Math.round(v*100)/100;if(v>0){mult+=v;lines.push({t:'m',label,v})}};
  const addX=(label,v)=>{if(v>1){xm*=v;lines.push({t:'x',label,v})}};
  const pl=(n,w)=>n+' '+w+(n===1?'':'s');
  if(f.landed){if(has('greaser'))addX('Greaser touchdown',1.5);else addM('Clean touchdown',.5)}
  if(f.crashed&&has('crashtest'))addM('Crash Test',2);
  if(f.loops)addM(pl(f.loops,'loop'),f.loops*(has('stunt')?1.5:.5));
  if(f.passes)addM(pl(f.passes,'low pass'),f.passes*(has('duster')?.75:.25));
  if(f.thermals)addM(pl(f.thermals,'thermal')+' ridden',f.thermals*(has('thermal')?.3:.1));
  if(f.bounces&&has('bounce'))addM(pl(f.bounces,'bounce'),f.bounces*.2);
  if(f.mach){if(has('sonic'))addX('Sonic Boom',2);else addM('Sound barrier',1)}
  if(f.space){if(has('escape'))addX('Escape Plan',3);else addM('Reached space',2)}
  if(has('wingman'))addM('Wingman',.3*ctx.wings);
  if(has('hauler'))addM('Fuel Hauler',.4*ctx.tanks);
  if(has('altimeter'))addM('Altimeter',.5*Math.floor(f.maxY/1000));
  if(has('speedtrap'))addM('Speed Trap',.5*Math.max(0,Math.floor((f.maxV*3.6-200)/100)));
  if(f.coins)addM(pl(f.coins,'coin'),f.coins*(has('collector')?.25:.05));
  if(has('opening')&&ctx.flightIdx===0)addX('Opening Act',1.5);
  if(has('third')&&ctx.flightIdx===2)addX('Third Time Lucky',3);
  if(has('frugal')&&f.landed&&f.fuelFrac>=.3)addX('Frugal',2);
  if(has('minimal')&&ctx.parts<=6)addX('Minimalist',3);
  if(has('logbook')&&ctx.cleared>0)addX('Logbook',1+.25*ctx.cleared);
  if(has('compound'))addX('Compound Interest',Math.min(3,1+.05*ctx.coins));
  const total=Math.floor(base*mult*xm);
  return {lines,base,mult:Math.round(mult*100)/100,xm,total};
}

/* ---------- run ---------- */
function wpick(obj){let s=0;for(const k in obj)s+=obj[k];let r=Math.random()*s;for(const k in obj){r-=obj[k];if(r<=0)return k}return Object.keys(obj)[0]}
const PART_W={frame:3,wing:3,tank:2.5,prop:2,rocket:1.5,balloon:1.5};
function rollMods(run,meta,n,exclude){
  const pool=Object.keys(MODS).filter(k=>modUnlocked(k,meta)&&!run.mods.includes(k)&&!exclude.includes(k)),out=[];
  while(out.length<n&&pool.length){const w={};for(const k of pool)w[k]=RARITY[MODS[k].r].w;const k=wpick(w);out.push(k);pool.splice(pool.indexOf(k),1)}
  return out}
function rollTunes(run,n,exclude){
  const pool=Object.keys(TUNES).filter(k=>(!TUNES[k].needs||(run.inv[TUNES[k].needs]||0)>0)&&!(TUNES[k].max&&(run.tune[k]||0)>=TUNES[k].max)&&!exclude.includes(k));
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  return pool.slice(0,n)}
function genShop(run,meta){return {parts:[0,1,2].map(()=>({t:wpick(PART_W)})),tunes:rollTunes(run,2,[]).map(k=>({k})),mods:rollMods(run,meta,3,[]).map(id=>({id})),rerolls:0}}
function rerollShop(run,meta){
  const S=run.shop;
  S.parts=S.parts.map(o=>o.sold?o:{t:wpick(PART_W)});
  const keepT=S.tunes.filter(o=>o.sold).map(o=>o.k), nt=rollTunes(run,2,keepT);let ti=0;
  S.tunes=S.tunes.map(o=>o.sold?o:(nt[ti]?{k:nt[ti++]}:o));
  const keepM=S.mods.filter(o=>o.sold).map(o=>o.id), nm=rollMods(run,meta,3,keepM.concat(S.mods.map(o=>o.id)));let mi=0;
  S.mods=S.mods.map(o=>o.sold?o:(nm[mi]?{id:nm[mi++]}:o));
  S.rerolls++}
const priceOf=(run,p)=>run.mods.includes('coupon')?Math.max(1,Math.floor(p*.75)):p;
function offerPrice(run,kind,o){return priceOf(run,kind==='part'?PARTS[o.t].price:kind==='tune'?tuneCost(run.tune[o.k]||0):RARITY[MODS[o.id].r].price)}
const rerollCost=run=>2+run.shop.rerolls;
const sellValue=id=>Math.floor(RARITY[MODS[id].r].price/2);
function newRun(level,meta){
  const run={level:level||0,stage:0,flight:0,score:0,total:0,best:0,bestDist:0,coins:START.coins,inv:{...START.inv},
    cells:[{...COCKPIT,type:'cockpit'}],mods:[],tune:{},weather:{},shop:null,phase:'contract',log:[],endless:false,unlocks:[],packs:[]};
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
function grantPacks(run){(run.packs=run.packs||[]).push(...rollPacks(run.stage===0&&!run.endless))}
function openPack(run){const t=run.packs&&run.packs.shift();if(t)run.inv[t]=(run.inv[t]||0)+1;return t}
function craftCounts(cells){const l=connected(cells);const n=t=>l.filter(c=>c.type===t).length;return {parts:l.length,wings:n('wing'),tanks:n('tank')}}
function settleFlight(run,meta,f){
  const has=k=>run.mods.includes(k);
  const sc=scoreFlight(f,{mods:run.mods,flightIdx:run.flight,cleared:run.stage,coins:run.coins,...craftCounts(run.cells)});
  const pay=3+f.coins+(has('sponsor')?3:0);
  run.coins+=pay;run.score+=sc.total;run.total+=sc.total;run.flight++;run.best=Math.max(run.best,sc.total);run.bestDist=Math.max(run.bestDist||0,f.dist);
  run.log.push({stage:run.stage,flight:run.flight,score:sc.total,d:Math.round(f.dist),x:Math.round(sc.mult*sc.xm*100)/100});
  meta.bestFlight=Math.max(meta.bestFlight||0,sc.total);
  const quota=quotaFor(run.stage,run.level);
  const out={sc,pay,coinsPicked:f.coins,sponsor:has('sponsor'),quota,contractScore:run.score,prevScore:run.score-sc.total,stage:run.stage,flightNo:run.flight};
  if(run.score>=quota){
    const unused=FLIGHTS-run.flight, storm=isStorm(run.stage);
    const reward=6+2*unused+(storm?4:0);
    const interest=has('piggy')?Math.min(5,Math.floor((run.coins+reward)/5)):0;
    run.coins+=reward+interest;
    Object.assign(out,{cleared:true,reward,unused,storm,interest});
    run.stage++;run.flight=0;run.score=0;
    const before=meta.bestStage||0;meta.bestStage=Math.max(before,run.stage);meta.deepest=Math.max(meta.deepest||0,run.stage);
    out.unlocks=UNLOCKS.filter(u=>u.at>before&&u.at<=meta.bestStage).map(u=>u.text);
    run.unlocks.push(...out.unlocks);
    if(run.stage===CONTRACTS&&!run.endless){run.phase='won';meta.wins=(meta.wins||0)+1;
      if(run.level>=(meta.level||0)&&run.level<5){meta.level=run.level+1;out.newLevel=meta.level}out.won=true}
    else{run.phase='shop';run.shop=genShop(run,meta);weatherOf(run,run.stage);grantPacks(run)}
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
};
