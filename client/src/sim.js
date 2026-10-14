// Wingnut Circus simulation core: pure game logic, no DOM.
// Physics (step), craft assembly (makeCraft), scoring (scoreFlight), economy and run state (newRun, settleFlight).
// Imported by the browser UI (ui.js) and by the node tests/tools, so keep it free of window/document.
const GIMBAL=.4, NEUT=.8, PAR=.0016, VAC=.002, VAC2=1.5e-4, C_LIGHT=299792458, G0=9.81, COLS=7, ROWS=5, COCKPIT={c:2,r:2};
const MAXMODS=5, FLIGHTS=3, CONTRACTS=8, FLIGHT_TIME=120, DAILY_COINS=100;
// the physics step: callers advance step() in fixed 1/120 s steps so a flight is reproducible from its inputs
const SIM_DT=1/120;
// style goals a dedicated build can reach: Redline (500 km/h, needs a strong rocket build) and Cloud nine (5 km, balloons
// with Weather Envelope Lv 2+, or balloons then rockets). The old sound barrier and 100 km were out of reach for any craft.
const REDLINE=500/3.6, CLOUD9=5000;
// altitude milestones: peak height pays flat bonuses added to the base (so multipliers apply). ALT_AT are the heights,
// ALT_PAY what each adds; past the table a milestone every ALT_STEP m adds ALT_MORE more than the one before.
// It is a landing bonus: only a landing collects it (ALT_CRASH / ALT_AIR are what a crash or a flight that ends in the
// air would keep; both 0). Partial credit was tried: at x0.5 / x0.75, 4 balloons just floating up to 1.7 km scored
// about as much as a well-flown propeller plane. Rubber Hull lets a wingless craft bounce to a stop and land.
const ALT_CRASH=0, ALT_AIR=0;
const ALT_AT=[100,250,500,750,1000], ALT_PAY=[200,300,500,750,1000], ALT_STEP=250, ALT_MORE=250;
const altHeight=k=>k<ALT_AT.length?ALT_AT[k]:ALT_AT[ALT_AT.length-1]+(k-ALT_AT.length+1)*ALT_STEP;
function altMilestones(y){let k=0;while(y>=altHeight(k))k++;return k}
const altReached=y=>{const k=altMilestones(y);return k?altHeight(k-1):0};
function altBonus(y){let t=0,last=0;for(let k=0;k<altMilestones(y);k++){last=k<ALT_PAY.length?ALT_PAY[k]:last+ALT_MORE;t+=last}return t}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
// Gameplay randomness: each run carries its own seeded generator state (run.rs, mulberry32), so one seed fixes the shop,
// packs, weather and storm rewards for everyone (daily puzzles, shared rooms, replays). Entry points that roll dice for a run
// set it as the current run; with no current run (or an old save without rs) rolls fall back to Math.random.
let CUR=null;
function rnd(){if(CUR&&CUR.rs!=null){let t=(CUR.rs=(CUR.rs+0x6d2b79f5)>>>0);t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}return Math.random()}
const seeded=(run,fn)=>{const prev=CUR;CUR=run;try{return fn()}finally{CUR=prev}};

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
// rare variants: same sockets and rules as the base part, one trait each. In the inventory they count as 'wing+' etc.,
// on the bench a placed one is a normal cell with rare:1. They come from packs (RARE_CHANCE) and the shop's rare pack.
const RARE={
  prop:{name:'Brass Propeller',d:'+40% thrust, same fuel'},
  rocket:{name:'Long-Burn Rocket',d:'40% less fuel'},
  wing:{name:'Silk Wing',d:'+30% lift, 30% lighter'},
  tank:{name:'Copper Tank',d:'+80% fuel'},
  balloon:{name:'Zeppelin Cell',d:'+60% lift; all Zeppelin Cells burst 1 km higher'},
  frame:{name:'Balsa Frame',d:'Half the weight'},
};
const RARE_CHANCE=.15, RARE_PACK_PRICE=8, RARE_PACK_CHANCE=.25;
const isRare=t=>typeof t==='string'&&t.endsWith('+'), baseOf=t=>isRare(t)?t.slice(0,-1):t;
const partName=t=>isRare(t)?RARE[baseOf(t)].name:PARTS[t].name;

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
  overclock:{name:'Overclock',r:'C',tag:'Engine',d:'Props: ×{v} thrust, ×2.5 fuel burn.',v:[1.5,1.8,2.1],how:'Always on while your propellers run: more push, but the tanks empty much sooner.'},
  afterburner:{name:'Afterburner',r:'R',tag:'Engine',d:'Rockets +{v%} thrust per 100 m/s, up to ×4.',v:[.2,.3,.4],lock:4,how:'Rockets get stronger the faster you already fly. Build up speed, then let the rockets roar.'},
  solar:{name:'Solar Wings',r:'R',tag:'Engine',d:'Above 1 km, wings push without fuel ({v%} of a prop).',v:[.2,.3,.4],lock:6,how:'Climb above 1 km and your wings push you forward, even with empty tanks.'},
  secondwind:{name:'Second Wind',r:'C',tag:'Fuel',d:'Empty tanks refill to {v%}, once.',v:[.3,.5,.7],how:'The first time your fuel runs out, the tanks refill by this much.'},
  recycler:{name:'Dive Recycler',r:'U',tag:'Fuel',d:'Falling refills fuel, up to {v%}.',v:[.3,.5,.7],how:'Every time you sink or dive, a little fuel flows back in.'},
  ramscoop:{name:'Ram Scoop',r:'R',tag:'Fuel',d:'Above 540 km/h, air refills fuel. Rate ×{v}.',v:[1.5,2,2.5],lock:4,how:'Fly faster than 540 km/h and the rushing air refills your tanks.'},
  burnoff:{name:'Burn-off',r:'U',tag:'Body',d:'Up to {v%} lighter as fuel burns.',v:[.2,.3,.4],how:'Your craft gets lighter as it burns fuel. Best with several tanks.'},
  slipstream:{name:'Slipstream',r:'U',tag:'Body',d:'Drag ×{v}.',v:[.75,.6,.5],how:'Always on: less air drag, so you keep your speed longer.'},
  antigrav:{name:'Antigravity Coil',r:'R',tag:'Body',d:'Gravity ×{v}.',v:[.8,.65,.55],lock:6,how:'Always on: lighter gravity. Easier climbs, longer glides.'},
  gyro:{name:'Gyroscope',r:'C',tag:'Control',d:'Trim and steering +{v%}.',v:[.5,1,1.5],how:'Always on: a steadier nose and quicker response to NOSE UP / NOSE DOWN.'},
  bounce:{name:'Rubber Hull',r:'U',tag:'Control',d:'No crashes. Bounces +{v} mult.',v:[.1,.2,.3],how:'Hard landings bounce instead of crashing. Every big bounce adds mult.'},
  sling:{name:'Slingshot',r:'C',tag:'Launch',d:'Launch ×{v}, 10° steeper.',v:[1.3,1.6,1.9],how:'The catapult throws you faster and a bit steeper.'},
  thermal:{name:'Thermal Rider',r:'C',tag:'Air',d:'Thermals lift ×{v}. +{w} mult each.',v:[1.2,1.4,1.6],w:[.15,.25,.35],how:'Fly through the rising air columns (thermals). They lift you harder and each one adds mult.'},
  envelope:{name:'Weather Envelope',r:'U',tag:'Air',d:'Balloons +{v}% lift, burst at {w} km.',v:[20,40,60],w:[4,6,8],how:'Balloons lift more and burst much higher before they pop.'},
  odometer:{name:'Odometer',r:'C',tag:'Score',d:'+{v} base.',v:[100,150,250],how:'Adds flat meters to every flight, before the multipliers.'},
  wingman:{name:'Wingman',r:'C',tag:'Score',d:'+{v} mult per wing.',v:[.2,.3,.4],how:'Counts the wings bolted to your craft.'},
  hauler:{name:'Fuel Hauler',r:'U',tag:'Score',d:'+{v} mult per fuel tank.',v:[.25,.4,.55],how:'Counts the fuel tanks bolted to your craft.'},
  altimeter:{name:'Altimeter',r:'U',tag:'Score',d:'+{v} mult per km of altitude.',v:[.3,.5,.8],how:'Counts your highest point: every full km of height adds mult.'},
  speedtrap:{name:'Speed Trap',r:'C',tag:'Score',d:'+{v} mult per 100 km/h over 200.',v:[.3,.5,.7],how:'Counts your top speed: every 100 km/h above 200 adds mult.'},
  duster:{name:'Crop Duster',r:'C',tag:'Score',d:'Low passes +{v} mult.',v:[.5,.75,1],how:'Fly low (under 4 m) and fast for a second, then climb back above 8 m. That is a low pass.'},
  stunt:{name:'Stunt Pilot',r:'U',tag:'Score',d:'Loops +{v} mult.',v:[1,1.5,2],how:'Turn a full circle in the air: hold NOSE UP until you go over the top and come round. That is a loop.'},
  collector:{name:'Coin Collector',r:'C',tag:'Score',d:'Coins +{v} mult each.',v:[.15,.25,.35],how:'Fly through the gold coins along the route.'},
  opening:{name:'Opening Act',r:'C',tag:'Score',d:'Flight 1 of a contract ×{v}.',v:[1.3,1.5,1.8],how:'Only counts on the first flight of each contract.'},
  third:{name:'Third Time Lucky',r:'U',tag:'Score',d:'Flight 3 of a contract ×{v}.',v:[2,2.5,3],how:'Only counts on the third flight of each contract. Save your best flight for last.'},
  frugal:{name:'Frugal',r:'U',tag:'Score',d:'×{v} if you land with 30% fuel.',v:[1.5,2,2.5],how:'Land without crashing with at least 30% fuel left in the tanks.'},
  minimal:{name:'Minimalist',r:'R',tag:'Score',d:'×{v} with 6 parts or fewer.',v:[2,2.5,3],lock:8,how:'Fly a craft of 6 parts or fewer, cockpit included.'},
  sonic:{name:'Overdrive',r:'U',tag:'Score',d:'Redline ×{v} instead of +1.',v:[1.5,2,2.5],how:'Reach Redline (500 km/h) and the whole flight’s score is multiplied.'},
  escape:{name:'Escape Plan',r:'R',tag:'Score',d:'Cloud nine ×{v} instead of +2.',v:[2,2.5,3],lock:8,how:'Reach Cloud nine: climb to 5 km in one flight. Then the whole flight’s score is multiplied. Hard: think balloons with Weather Envelope, or Antigravity with lots of thrust.'},
  greaser:{name:'Greaser',r:'U',tag:'Score',d:'Touchdown ×{v} instead of +0.5.',v:[1.25,1.5,1.75],how:'Land without crashing: roll to a stop on the ground. The whole flight’s score is multiplied.'},
  crashtest:{name:'Crash Test',r:'U',tag:'Score',d:'Crash +{v} mult. Dive in hard.',v:[1,2,3],how:'Crash. When a flight is ending anyway, nose down and dive in.'},
  logbook:{name:'Logbook',r:'R',tag:'Score',d:'×{v} more per contract cleared.',v:[.15,.25,.35],lock:8,how:'Grows with every contract cleared this run. Does nothing on contract 1, so daily puzzles never offer it.',noDaily:1},
  compound:{name:'Compound Interest',r:'R',tag:'Score',d:'×0.05 per coin held, up to ×{v}.',v:[2,3,4],lock:8,how:'Counts the coins you hold when the flight ends: 20 coins = ×2. Spend less, score more.'},
  piggy:{name:'Piggy Bank',r:'C',tag:'Coins',d:'+1 coin per 5 held after a contract, up to {v}.',v:[3,5,7],how:'When you clear a contract, you earn interest on the coins you hold.'},
  coupon:{name:'Coupon Book',r:'U',tag:'Coins',d:'Shop prices −{v}%.',v:[15,25,35],how:'Everything in the shop costs less.'},
  magnet:{name:'Coin Magnet',r:'C',tag:'Coins',d:'Pulls in coins from ×{v} as far.',v:[2,2.5,3],how:'Grabs coins from farther away, so you can collect them without hitting them dead on.'},
  // added in 0.4: niches for balloons, gliders, dives, rockets, frames and low flying, plus run-long mods
  silent:{name:'Silent Flight',r:'U',tag:'Score',d:'×{v} with no propeller or rocket.',v:[1.5,1.75,2],how:'Fly a craft with no propeller and no rocket bolted on: rise on balloons, pop them, glide down.'},
  bouquet:{name:'Balloon Bouquet',r:'C',tag:'Score',d:'+{v} mult per balloon.',v:[.2,.3,.4],how:'Counts the balloons bolted to your craft at launch, even after they pop.'},
  hedgehop:{name:'Hedgehopper',r:'U',tag:'Score',d:'×{v} if you never climb above 30 m.',v:[1.5,2,2.5],how:'Stay low the whole flight: never higher than 30 m. Pairs well with low passes.'},
  touchgo:{name:'Touch and Go',r:'C',tag:'Score',d:'Touch-and-gos +{v} mult.',v:[.4,.6,.8],how:'Touch the ground gently while flying fast, then lift off again and climb above 3 m. Each one pays a bit less.'},
  bullseye:{name:'Bullseye',r:'U',tag:'Score',d:'×{v} if you land on a target.',v:[1.5,2,2.5],how:'Targets sit on the ground every 100 m. Come to a stop within 6 m of one.'},
  showboat:{name:'Showboat',r:'C',tag:'Score',d:'+{v} mult per trick chained within 3 s.',v:[.2,.3,.4],how:'Do a loop, low pass, thermal or touch-and-go within 3 seconds of the last one to chain it. Each link pays a bit less.'},
  flyer:{name:'Frequent Flyer',r:'U',tag:'Score',d:'+{v} mult per landing in a row. A crash resets it.',v:[.1,.15,.2],how:'Counts your landings without a crash in between, across the whole run (flights that end in the air keep the count).'},
  fanclub:{name:'Fan Club',r:'U',tag:'Score',d:'+{v} mult per loop flown this run.',v:[.03,.05,.07],how:'Every loop this run adds to it for good (up to 3 loops per flight count).'},
  understudy:{name:'Understudy',r:'U',tag:'Score',d:'+{v} mult per empty mod slot.',v:[.3,.4,.5],how:'Rewards running with fewer mods: each empty slot adds mult.'},
  carpenter:{name:'Carpenter',r:'C',tag:'Body',d:'Frames weigh nothing. +{v} mult per frame.',v:[.15,.2,.25],how:'Every frame on your craft is weightless and adds mult. Build long.'},
  divebomb:{name:'Dive Bomber',r:'U',tag:'Body',d:'Diving nose-down: drag ×{v}.',v:[.4,.3,.2],how:'Point the nose down steeper than 30° and you cut through the air. Climb high, then dive for speed.'},
  sailplane:{name:'Sailplane',r:'C',tag:'Body',d:'Engines off: drag ×{v}.',v:[.8,.7,.6],how:'Whenever no propeller or rocket is pushing (out of fuel, throttle at 0, or none bolted on), you glide farther.'},
  booster:{name:'Booster',r:'C',tag:'Engine',d:'Rockets ×{v} thrust for the first 3 s.',v:[2,2.5,3],how:'A big kick right off the catapult. Great for climbing steeply early.'},
  supercharge:{name:'Supercharger',r:'U',tag:'Engine',d:'Props ×{v} thrust with the nose up.',v:[1.25,1.45,1.65],how:'Whenever the nose points up more than 15°, propellers pull harder at no extra fuel. Hold NOSE UP to climb, glide down later.'},
  burner:{name:'Hot-Air Burner',r:'U',tag:'Air',d:'Balloons keep {v%} of their lift high up. Burns fuel.',v:[.5,.75,1],how:'Balloons normally stall around 1.7 km as the air thins. The burner keeps them rising while there is fuel. Burst height still applies.'},
  // added in 0.5
  longhaul:{name:'Long Haul',r:'U',tag:'Score',d:'+{v} mult per full minute in the air, if you land.',v:[.3,.4,.5],how:'Every full minute between the catapult and the landing adds mult. Flight permits give you more minutes; a crash or running out of time pays nothing.'},
  investor:{name:'Investor',r:'U',tag:'Coins',d:'+1 coin per 1,000 points, up to {v} a flight.',v:[4,6,8],how:'After each flight, its score pays coins: one per full 1,000 points.'},
  overachiever:{name:'Overachiever',r:'U',tag:'Coins',d:'Clearing a contract: +{v} coins per 10% over the target, up to {w}.',v:[1,2,3],w:[6,10,14],how:'When a contract clears, every full 10% your contract score is above the target pays coins. Not in daily puzzles or rooms.',noDaily:1},
  magpie:{name:'Magpie',r:'R',tag:'Score',d:'+{v} mult per coin collected this run.',v:[.01,.015,.02],how:'Every coin you fly through this run adds to it for good. Coins get rarer the farther out you fly.'},
  sponsor:{name:'Sponsor Decal',r:'C',tag:'Coins',d:'+{v} coins per flight.',v:[2,3,4],how:'Extra coins after every flight, whatever happens.'},
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
  ceiling:{name:'Thunderheads',d:s=>`Cloud ceiling at ${250+120*s} m`},
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
function rollBoons(run){return seeded(run,()=>_rollBoons(run))}
function _rollBoons(run){
  const lv=modLevels(run), canUp=run.mods.filter(id=>lv[id]<MODMAX);
  const pool=Object.keys(BOONS).filter(k=>!(BOONS[k].once&&boonN(run,k))&&!(BOONS[k].up&&!canUp.length));
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  return pool.slice(0,2).map(id=>id==='upgrade'?{id,mod:canUp[Math.floor(rnd()*canUp.length)]}:{id})}
const boonDesc=o=>BOONS[o.id].d.replace('{mod}',o.mod?MODS[o.mod].name:'');
// telemetry: what the player did and when, as compact arrays [kind, contract, flight, ...] in run.ev
function note(run,...a){(run.ev=run.ev||[]).push([a[0],run.stage,run.flight,...a.slice(1)])}
const cellCode=cells=>cells.map(c=>{const l=c.type==='cockpit'?'c':c.type[0];return (c.rare?l.toUpperCase():l)+c.c+c.r}).join(' ');
function pickBoon(run,i){
  const o=run.boonOffer&&run.boonOffer[i];if(!o)return false;note(run,'boon',o.id,o.mod||'');
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
  {at:8,text:'4 rare mods, Difficulty 1'},
];
const modUnlocked=(id,meta)=>!MODS[id].lock||(meta.bestStage||0)>=MODS[id].lock;

/* ---------- contracts ---------- */
const QUOTA=[500,1100,2000,4000,7500,16000,30000,54000];
function quotaFor(i,level){const q=i<CONTRACTS?QUOTA[i]:QUOTA[CONTRACTS-1]*Math.pow(2.5,i-CONTRACTS+1);return Math.round(q*(1+.25*(level||0))/10)*10}
// Ceiling levels: every level adds +25% quota; even levels also add a rule (cumulative)
const MAX_CEILING=10;
const CEILING_RULES={2:'Shop prices +1',4:'Contract 5 has a storm too',6:'Packs hold no rare parts',8:'Storms hit harder',10:'90-second flight clock'};
const ceilingRules=level=>Object.keys(CEILING_RULES).filter(k=>+k<=(level||0)).map(k=>CEILING_RULES[k]);
const isStorm=(i,level)=>i===CONTRACTS-1||i%3===2||((level||0)>=4&&i===4);
// storm strength grows with the contract; from Ceiling 8 every storm counts as two contracts later
const severity=(run,i)=>i+((run.level||0)>=8?2:0);
function weatherOf(run,i){return seeded(run,()=>_weatherOf(run,i))}
function _weatherOf(run,i){if(run.mode==='daily'||!isStorm(i,run.level))return null;
  if(!run.weather[i]){const used=Object.values(run.weather);const ids=Object.keys(WEATHER).filter(k=>!used.includes(k));const pool=ids.length?ids:Object.keys(WEATHER);run.weather[i]=pool[Math.floor(rnd()*pool.length)]}
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
    dive:has('divebomb')?mv('divebomb'):1, sail:has('sailplane')?mv('sailplane'):1, booster:has('booster')?mv('booster'):1, supercharge:has('supercharge')?mv('supercharge'):1, burner:mv('burner'),
    frameMass:has('carpenter')?0:1,
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
  let wingLift=0,balLift=0,propPow=0,fuelTanks=0,balRare=0;
  for(const c of list){const rm=c.rare?(c.type==='wing'?.7:c.type==='frame'?.5:1):1;
    const mass=PARTS[c.type].mass*st.massMul*(c.type==='frame'&&st.frameMass!=null?st.frameMass:1)*rm;const lx=c.c+.5,ly=-(c.r+.5);
    const blocked=(c.type==='prop'&&occ.has((c.c+1)+','+c.r))||(c.type==='rocket'&&occ.has((c.c-1)+','+c.r));
    parts.push({type:c.type,lx,ly,m:mass,blocked,gc:c.c,gr:c.r,rare:!!c.rare});m+=mass;cx+=mass*lx;cy+=mass*ly;if(!blocked)counts[c.type]=(counts[c.type]||0)+1;
    if(c.type==='wing')wingLift+=c.rare?1.3:1;else if(c.type==='balloon'){balLift+=c.rare?1.6:1;if(c.rare)balRare++}
    else if(c.type==='prop'&&!blocked)propPow+=c.rare?1.4:1;else if(c.type==='tank')fuelTanks+=c.rare?1.8:1}
  const cg={x:COCKPIT.c+.5,y:-(COCKPIT.r+.5)};
  if(st.cargo){m+=st.cargo;cx+=st.cargo*cg.x;cy+=st.cargo*cg.y}
  cx/=m;cy/=m;let I=0;
  for(const p of parts){p.lx-=cx;p.ly-=cy;I+=p.m*(p.lx*p.lx+p.ly*p.ly+1/6)}
  const cargoPos={x:cg.x-cx,y:cg.y-cy};if(st.cargo)I+=st.cargo*(cargoPos.x**2+cargoPos.y**2+1/6);
  const n=k=>counts[k]||0;
  const wings=parts.filter(p=>p.type==='wing'), props=parts.filter(p=>p.type==='prop'&&!p.blocked), rockets=parts.filter(p=>p.type==='rocket'&&!p.blocked);
  const avg=(a,f)=>a.length?a.reduce((t,p)=>t+f(p),0)/a.length:null;
  return {parts,m,I,cells:list,cargoPos,counts:{prop:n('prop'),rocket:n('rocket'),wing:n('wing'),tank:n('tank'),balloon:n('balloon')},
    fuelMax:st.reserve+fuelTanks*st.tankFuel,loose:cells.length-list.length,
    // rare parts count for more: wing lift, balloon lift and prop power in base-part units; Zeppelin Cells burst higher
    wingLift,balLift,propPow,burstBonus:balRare&&balRare===n('balloon')?1000:0,
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
    spin:0,loops:0,passes:0,skim:0,passReady:false,thermals:0,thSeen:new Set(),gustE:0,burst:false,popped:false,touchgos:0,tgArm:false,combos:0,lastTrick:-9,altMs:0};
}
function segDist(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;let t=l?((px-ax)*dx+(py-ay)*dy)/l:0;t=clamp(t,0,1);return Math.hypot(px-ax-dx*t,py-ay-dy*t)}
function flag(S,k,msg){if(!S.flags[k]){S.flags[k]=1;S.events.push(msg)}}
// a trick (loop, low pass, thermal, touch-and-go); one within 3 s of the last one also chains a combo (Showboat)
function trick(S,e){S.events.push(e);if(S.t-S.lastTrick<=3){S.combos++;S.events.push('combo')}S.lastTrick=S.t}
function step(S,K,st,dt,ctl){
  const px0=S.x,py0=S.y;
  const dens=Math.exp(-Math.max(0,S.y)/8500), rho=dens*st.rhoMul;
  // Hot-Air Burner: balloons get back part of the lift thin air takes away with height (paid for in fuel below)
  const burnOn=st.burner&&K.counts.balloon&&S.fuel>0;
  const rhoBal=burnOn?(dens+st.burner*(1-dens))*st.rhoMul:rho;
  // aerodynamics use the air-relative velocity, so a headwind costs lift and ground speed
  const ax=S.vx-st.wind, ay=S.vy;
  const v=Math.hypot(ax,ay), q=v*v;
  const c=Math.cos(S.th), s=Math.sin(S.th);
  let ux=0,uy=0,alpha=0;
  if(v>.3){ux=ax/v;uy=ay/v;alpha=Math.atan2(ux*s-uy*c,ux*c+uy*s)}
  const hasFuel=S.fuel>0;
  const light=1-st.burnoff*(1-S.fuel/Math.max(1e-9,K.fuelMax));
  // Dive Bomber: nose down steeper than 30 degrees while descending cuts all drag. Sailplane: so does gliding with no
  // engine pushing (decided from the last step's engines, which is what the craft is doing right now)
  const na=Math.atan2(Math.sin(S.th),Math.cos(S.th)), diving=st.dive<1&&S.vy<0&&na<-Math.PI/6&&na>-5*Math.PI/6;
  const drag=st.drag*(diving?st.dive:1)*(st.sail<1&&!S.propOn&&!S.rocketOn&&S.t>.5?st.sail:1);
  // Supercharger: props pull harder while the nose points up more than 15 degrees (so it helps a craft start climbing)
  const climbK=st.supercharge>1&&na>Math.PI/12&&na<Math.PI*.6?st.supercharge:1;
  const m=K.m*light, I=K.I*light+.3*st.massMul, W=m*G0*st.grav;
  const pitch=ctl.pitch||0;
  // one throttle drives every engine; old callers that only pass boost keep props on full
  const thrl=ctl.throttle==null?1:clamp(ctl.throttle,0,1), rocketThr=ctl.throttle==null?(ctl.boost?1:0):thrl;
  const nw=K.counts.wing, Lfull=(K.wingLift??nw)*st.wing*rho*q;
  const off=K.lift==null?0:K.lift;
  const Lcap=Lfull*.56*balanceOf(off);
  const up0=(K.balLift??K.counts.balloon)*st.balloon*rhoBal, Wn=Math.max(0,W-up0);
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
    if(p.type==='prop'){if(hasFuel&&!p.blocked&&thrl>0){const th=st.prop*rho*thrl*climbK*(p.rare?1.4:1);tx=c*th;ty=s*th;thr+=th;use+=st.propUse*thrl;S.propOn=true}}
    else if(p.type==='rocket'){if(hasFuel&&rocketThr>0&&!p.blocked){const th=st.rocket*rocketThr*(1+st.afterburner*Math.min(v,1000)/100)*(S.t<3?st.booster||1:1);tx=c*th;ty=s*th;thr+=th;use+=4*rocketThr*(p.rare?.6:1);S.rocketOn=true}}
    else if(p.type==='wing'){
      const L=Lact/nw;Fx+=-uy*L;Fy+=ux*L;
      const D=st.wingCD*rho*q*(.06+sa*sa)*drag;fx-=ux*D;fy-=uy*D;
      if(st.solar&&S.y>800){const sp=st.solar*st.prop*clamp((S.y-800)/400,0,1);tx+=c*sp;ty+=s*sp}
    }
    else if(p.type==='balloon'){fy+=st.balloon*rhoBal*(p.rare?1.6:1);const bd=.004*rho*q;fx-=ux*bd;fy-=uy*bd}
    const pd=PAR*rho*q*drag;fx-=ux*pd;fy-=uy*pd;
    Fx+=fx+tx;Fy+=fy+ty;Ta+=rx*fy-ry*fx;Tt+=rx*ty-ry*tx;
  }
  if(off>0)Ta+=off*Lact;
  const tk=Math.floor(S.x/120), th=thermalSeg(tk,st);
  if(th&&S.y<th.top){const d=Math.abs(S.x-th.cx);
    // smooth column: strongest in the middle, fading at the edges and near the top, so it lifts rather than kicks
    if(d<12){const b=Math.cos(d/12*Math.PI/2)**2*clamp((th.top-S.y)/25,0,1);Fy+=m*th.str*b}
    if(d<8&&!S.thSeen.has(tk)){S.thSeen.add(tk);S.thermals++;trick(S,'thermal')}}
  // gusts shove the craft up and down and rock its nose. The air sinks a little more than it rises, and the total upward
  // push a flight can get is capped (S.gustE, as velocity it could add), so gusts cost height and make low flying and
  // landings risky; they cannot be ridden or farmed, whichever way the craft is moving
  if(st.gust){const gw=Math.sin(S.x/61+1.3)*Math.cos(S.t*.9+S.x/97)-.08,gF=m*st.gust*gw;
    if(gF<=0||S.gustE<17){Fy+=gF;S.gustE+=gF/m*dt} // net budget: sinking earns back room to rise, so the cap never turns gusts into a pure downdraft
    Ta+=.12*m*st.gust*Math.sin(S.t*1.7+S.x/43)}
  if(st.ceiling&&S.y>st.ceiling){Fy-=m*(14+.4*(S.y-st.ceiling));flag(S,'storm','Downdraft!')}
  {const k=(VAC+VAC2*v)*(1-Math.exp(-Math.max(0,S.y)/8500))*drag;Fx-=m*k*S.vx;Fy-=m*k*S.vy}
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
  // the burner pays for the lift it gives back, so it cannot climb for free
  if(burnOn)use+=.06*K.counts.balloon*st.burner*(1-dens);
  if(use>0)S.fuel-=use*dt;
  if(st.ramscoop&&v>150)S.fuel+=st.ramscoop*.006*(v-150)*rho*dt;
  if(st.recycler&&S.vy<0&&S.recyc<st.recycler*K.fuelMax){const g=Math.min(.1*(-S.vy)*dt,st.recycler*K.fuelMax-S.recyc);S.fuel+=g;S.recyc+=g}
  S.fuel=Math.min(S.fuel,K.fuelMax);
  if(S.fuel<=0){S.fuel=0;if(st.secondwind&&!S.sw){S.sw=true;S.fuel=K.fuelMax*st.secondwind;S.events.push('Second Wind')}}
  if(K.counts.balloon&&!S.burst&&S.y>st.burstAlt+(K.burstBonus||0)){S.burst=true;S.events.push('burst')}
  if(S.x<0&&px0>=0&&S.y<20){S.x=.05;S.vx=Math.abs(S.vx)*.3}
  // ground
  const cs=Math.cos(S.th), sn=Math.sin(S.th);
  let minY=1e18;for(const p of K.parts){const wy=S.y+p.lx*sn+p.ly*cs-.5;if(wy<minY)minY=wy}
  const gy=groundY(S.x), h=minY-gy;
  S.touch=false;
  if(minY<gy){
    S.touch=true;S.y+=gy-minY;
    const imp=-S.vy;
    // a gentle touch at speed arms a touch-and-go; it counts once the craft climbs back above 3 m
    if(S.x>5&&imp<5&&Math.hypot(S.vx,S.vy)>12)S.tgArm=true;
    if(imp>0){
      // a hard hit (over ~55 km/h straight down) or a nose-first impact steeper than 45 degrees is a crash
      {let a=S.th%(2*Math.PI);if(a>Math.PI)a-=2*Math.PI;if(a<-Math.PI)a+=2*Math.PI;
       if(!st.bounce&&(imp>15||(imp>5&&a<-Math.PI/4))){S.crashed=true;S.done=true;S.impact=imp;return}}
      // Rubber Hull bounces big hits back up, but small ones die out so the craft can settle and land
      const e=st.bounce&&imp>3?.8:.18;
      S.vy=imp*e;if(imp>2){S.vx*=st.bounce?.97:.95;S.w*=.5}
      if(st.bounce&&imp>4){S.bounces++;S.events.push('bounce')}
    }
    S.vx*=Math.exp(-(st.bounce?.3:1.4)*dt);
    let a=S.th%(2*Math.PI);if(a>Math.PI)a-=2*Math.PI;if(a<-Math.PI)a+=2*Math.PI;S.th-=a*Math.min(1,4*dt);
  }
  if(!S.touch&&S.tgArm&&h>3){S.tgArm=false;S.touchgos++;trick(S,'touchgo')}
  // style: loops, and low passes that pull back up
  if(!S.touch){S.spin+=S.w*dt;if(Math.abs(S.spin)>=2*Math.PI){S.loops++;S.spin-=Math.sign(S.spin)*2*Math.PI;trick(S,'loop')}}else S.spin=0;
  const gs=Math.hypot(S.vx,S.vy);
  if(S.touch){S.skim=0;S.passReady=false}
  else if(h<4&&gs>25){S.skim+=dt;if(S.skim>=1)S.passReady=true}
  else{S.skim=0;if(h>8&&S.passReady){S.passReady=false;S.passes++;trick(S,'pass')}}
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
  if(altMilestones(S.y)>S.altMs){S.altMs=altMilestones(S.y);S.events.push('altitude')}
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
  if(S.touch)S.lastTouch=S.t;
  // stalled while sitting on the ground (say a Rubber Hull craft that bounced itself out): that is a landing
  if(S.calm>6||S.slow>5){S.done=true;if(S.t-(S.lastTouch??-9)<1&&nv<3)S.landed=true;else S.becalmed=true}
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
  bounces:S.bounces,mach:!!S.flags.mach,space:!!S.flags.karman,crashed:S.crashed,landed:!!S.landed,banked:!!S.banked,fuelFrac:K.fuelMax?S.fuel/K.fuelMax:0,
  touchgos:S.touchgos||0,combos:S.combos||0,landX:S.x,t:S.t,timeout:!!S.timeout,becalmed:!!S.becalmed}}
// Bullseye: landing targets every 100 m, hit within 6 m (world.js draws them when the mod is owned)
const TARGET_EVERY=100, TARGET_R=6;
const onTarget=x=>x>TARGET_EVERY/2&&Math.abs(x-Math.round(x/TARGET_EVERY)*TARGET_EVERY)<=TARGET_R;

/* ---------- scoring: distance x multipliers ---------- */
// repeated tricks pay less each time: the n-th loop or low pass is worth 1/(1+0.5(n-1)) of the first,
// so technique pays but farming one trick for the whole flight does not
const repeats=n=>{let t=0;for(let k=0;k<n;k++)t+=1/(1+.5*k);return t};
// ctx.lv: owned mods as {id: level} (ctx.mods, a plain id array, still works and counts as Lv 1)
function scoreFlight(f,ctx){
  const lv=ctx.lv||modLevels(ctx.mods||[]), has=k=>!!lv[k], mv=(k,key)=>modVal(lv,k,key), bn=k=>(ctx.boons&&ctx.boons[k])||0, lines=[];
  let base=Math.floor(f.dist);lines.push({t:'b',label:'Distance',v:base,dist:true});
  if(has('odometer')){base+=mv('odometer');lines.push({t:'b',label:'Odometer',v:mv('odometer')})}
  {const k=f.landed?1:f.crashed?ALT_CRASH:ALT_AIR,ab=Math.round(altBonus(f.maxY)*k);
   if(ab){base+=ab;lines.push({t:'b',label:`Altitude ${altReached(f.maxY)} m${k<1?' ×'+k:''}`,v:ab})}}
  let mult=1,xm=1;
  const addM=(label,v)=>{v=Math.round(v*100)/100;if(v>0){mult+=v;lines.push({t:'m',label,v})}};
  const addX=(label,v)=>{if(v>1){xm*=v;lines.push({t:'x',label,v})}};
  const pl=(n,w)=>n+' '+w+(n===1?'':/s$/.test(w)?'es':'s');
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
  if(has('silent')&&!ctx.engines)addX('Silent Flight',mv('silent'));
  if(has('bouquet'))addM('Balloon Bouquet',mv('bouquet')*(ctx.balloons||0));
  if(has('hedgehop')&&f.maxY<=30&&f.dist>0)addX('Hedgehopper',mv('hedgehop'));
  if(has('touchgo')&&f.touchgos)addM(pl(f.touchgos,'touch-and-go'),repeats(f.touchgos)*mv('touchgo'));
  if(has('bullseye')&&f.landed&&onTarget(f.landX))addX('Bullseye',mv('bullseye'));
  if(has('showboat')&&f.combos)addM(pl(f.combos,'combo'),repeats(f.combos)*mv('showboat'));
  // run-long counts: ctx holds the run so far, this flight is added here
  const streak=f.landed?(ctx.streak||0)+1:f.crashed?0:(ctx.streak||0);
  if(has('flyer')&&streak)addM('Frequent Flyer',mv('flyer')*streak);
  if(has('fanclub'))addM('Fan Club',mv('fanclub')*((ctx.loopsRun||0)+Math.min(3,f.loops||0)));
  if(has('understudy'))addM('Understudy',mv('understudy')*(ctx.empty||0));
  if(has('carpenter'))addM('Carpenter',mv('carpenter')*(ctx.frames||0));
  if(has('longhaul')&&f.landed&&f.t>=60)addM('Long Haul',mv('longhaul')*Math.floor(f.t/60));
  if(has('magpie'))addM('Magpie',mv('magpie')*((ctx.coinsRun||0)+(f.coins||0)));
  const total=Math.floor(base*mult*xm);
  return {lines,base,mult:Math.round(mult*100)/100,xm,total};
}

/* ---------- run ---------- */
function wpick(obj){let s=0;for(const k in obj)s+=obj[k];let r=rnd()*s;for(const k in obj){r-=obj[k];if(r<=0)return k}return Object.keys(obj)[0]}
const PART_W={frame:3,wing:3,tank:2.5,prop:2,rocket:1.5,balloon:1.5};
// owned mods below MODMAX come back as upgrades, a bit less often than new mods
function rollMods(run,meta,n,exclude){return seeded(run,()=>_rollMods(run,meta,n,exclude))}
function _rollMods(run,meta,n,exclude){
  const lv=modLevels(run);
  // noDaily: mods that cannot work in a one-contract daily puzzle stay out of its shop
  const pool=Object.keys(MODS).filter(k=>modUnlocked(k,meta)&&!(run.mode==='daily'&&MODS[k].noDaily)&&(!lv[k]||lv[k]<MODMAX)&&!exclude.includes(k)),out=[];
  while(out.length<n&&pool.length){const w={};for(const k of pool)w[k]=RARITY[MODS[k].r].w*(lv[k]?.7:1);const k=wpick(w);out.push(k);pool.splice(pool.indexOf(k),1)}
  return out}
function rollTunes(run,n,exclude){return seeded(run,()=>_rollTunes(run,n,exclude))}
function _rollTunes(run,n,exclude){
  const pool=Object.keys(TUNES).filter(k=>(!TUNES[k].needs||(run.inv[TUNES[k].needs]||0)>0)&&!(TUNES[k].max&&(run.tune[k]||0)>=TUNES[k].max)&&!exclude.includes(k));
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  return pool.slice(0,n)}
function genShop(run,meta){return seeded(run,()=>_genShop(run,meta))}
function _genShop(run,meta){return {parts:[0,1,2].map(()=>({t:wpick(PART_W)})),tunes:rollTunes(run,2,[]).map(k=>({k})),mods:rollMods(run,meta,3,[]).map(id=>({id})),rerolls:0,pack:rollRarePack(run)}}
// sometimes the shop has a rare parts pack: a guaranteed rare part of a random type (rolled now, revealed when opened)
const rollRarePack=run=>(run.level||0)<6&&rnd()<RARE_PACK_CHANCE?{t:wpick(PART_W)+'+'}:null;
// a reroll is a whole new shop, sold slots included; only the mods on offer right now are kept out of the new picks
function rerollShop(run,meta){note(run,'reroll',run.shop.rerolls);return seeded(run,()=>_rerollShop(run,meta))}
function _rerollShop(run,meta){
  const S=run.shop;
  S.parts=[0,1,2].map(()=>({t:wpick(PART_W)}));
  S.tunes=rollTunes(run,2,[]).map(k=>({k}));
  S.mods=rollMods(run,meta,3,S.mods.map(o=>o.id)).map(id=>({id}));
  S.pack=rollRarePack(run);
  S.rerolls++}
const priceOf=(run,p)=>{const lv=modLevels(run);if(lv.coupon)p=Math.max(1,Math.floor(p*(1-modVal(lv,'coupon')/100)));return p+((run.level||0)>=2?1:0)};
// an upgrade costs the rarity price plus 2 per level already owned
const modPrice=(run,id)=>RARITY[MODS[id].r].price+2*(modLevels(run)[id]||0);
function offerPrice(run,kind,o){return priceOf(run,kind==='part'?PARTS[o.t].price:kind==='pack'?RARE_PACK_PRICE:kind==='tune'?tuneCost(run.tune[o.k]||0):modPrice(run,o.id))}
const rerollCost=run=>2+run.shop.rerolls;
const sellValue=(id,L)=>Math.floor(RARITY[MODS[id].r].price/2)+2*((L||1)-1);
// can this offer be bought right now (coins aside)? New mods need a free slot, upgrades do not
function canBuy(run,kind,o){if(o.sold)return false;if(kind==='mod'){const L=modLevels(run)[o.id];return L?L<MODMAX:run.mods.length<modSlots(run)}return true}
function applyPurchase(run,kind,o){
  const p=offerPrice(run,kind,o);if(!canBuy(run,kind,o)||p>run.coins)return false;
  run.coins-=p;o.sold=true;note(run,'buy',kind,o.t||o.k||o.id,p);
  if(kind==='part')run.inv[o.t]=(run.inv[o.t]||0)+1;
  else if(kind==='pack')(run.packs=run.packs||[]).push(o.t);
  else if(kind==='tune')run.tune[o.k]=(run.tune[o.k]||0)+1;
  else{run.modLv=run.modLv||{};if(run.mods.includes(o.id))run.modLv[o.id]=Math.min(MODMAX,(run.modLv[o.id]||1)+1);else{run.mods.push(o.id);run.modLv[o.id]=1}}
  return true}
function sellMod(run,id){const i=run.mods.indexOf(id);if(i<0)return 0;const v=sellValue(id,modLevels(run)[id]);note(run,'sell',id,v);run.mods.splice(i,1);if(run.modLv)delete run.modLv[id];run.coins+=v;return v}
// everything a flight of this run needs: tunings, mod levels, this contract's weather, the ceiling's clock
function flightStats(run){const w=weatherOf(run,run.stage),fx=weatherFx(w,severity(run,run.stage));if((run.level||0)>=10)fx.clock=90;
  const st=stats(run.tune,modLevels(run),fx),b=k=>boonN(run,k);
  // live rooms fly together, so their flights are short: 2 minutes, +20 s per Flight permit
  if(isOnline(run))st.flightTime=ONLINE_TIME+20*Math.min(run.tune.time||0,TUNES.time.max);
  st.drag*=Math.pow(.92,b('drag'));st.grav*=Math.pow(.92,b('grav'));const fm=Math.pow(1.12,b('fuel'));st.tankFuel*=fm;st.reserve*=fm;
  return st}
// opts.seed fixes everything random in the run; opts.mode: 'run' (default), 'daily' (one contract, 100 coins, no storms),
// 'team' (a live room: the team's flights add up toward the target, the room decides clears) or 'elim' (a live room: one
// flight per round, the room knocks out the lowest scores)
const isOnline=run=>run.mode==='team'||run.mode==='elim';
const ONLINE_TIME=120;
function newRun(level,meta,opts={}){
  const seed=opts.seed!=null?opts.seed>>>0:Math.floor(Math.random()*4294967296);
  const run={seed,rs:seed,mode:opts.mode||'run',level:level||0,stage:0,flight:0,score:0,total:0,best:0,bestDist:0,coins:START.coins,inv:{...START.inv},
    cells:[{...COCKPIT,type:'cockpit'}],mods:[],modLv:{},boons:{},boonOffer:null,tune:{},weather:{},shop:null,phase:'contract',log:[],endless:false,unlocks:[],packs:[]};
  if(run.mode==='daily')run.coins=DAILY_COINS;
  // the weather comes first, so it depends on the seed alone (players in a room share it whatever their shops do)
  for(let i=0;i<CONTRACTS;i++)weatherOf(run,i);
  run.shop=genShop(run,meta);
  grantPacks(run);
  return run}
// parts packs: one random part each, handed out at the start of every contract (1, or 4 for the first); later packs can be rare.
// The opening four always hold a tank, a wing and an engine, so every run can fly; the fourth is random.
const PACKS=1, FIRST_PACKS=4; // 0.5: later contracts give 1 pack (was 2), which may hold a rare part
// daily puzzles: number N is the Nth UTC day since launch; its seed is a hash of N, the same for everyone
const DAILY_EPOCH=Date.UTC(2026,9,11);
const dailyNumber=(ms=Date.now())=>Math.floor((ms-DAILY_EPOCH)/86400000)+1;
function dailySeed(n){let h=(n*2654435761)>>>0;h^=h>>>16;h=Math.imul(h,0x45d9f3b)>>>0;h^=h>>>16;return h>>>0}
function rollPacks(first,rareOk=true){
  if(!first){const t=wpick(PART_W);return [rareOk&&rnd()<RARE_CHANCE?t+'+':t]}
  const out=first?['tank','wing',wpick({prop:PART_W.prop,rocket:PART_W.rocket}),wpick(PART_W)]:Array.from({length:PACKS},()=>wpick(PART_W));
  for(let i=out.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[out[i],out[j]]=[out[j],out[i]]}
  return out}
function grantPacks(run){return seeded(run,()=>_grantPacks(run))}
function _grantPacks(run){const first=run.stage===0&&!run.endless;(run.packs=run.packs||[]).push(...rollPacks(first,(run.level||0)<6))}
function openPack(run){const t=run.packs&&run.packs.shift();if(t){run.inv[t]=(run.inv[t]||0)+1;note(run,'pack',t)}return t}
function craftCounts(cells){const l=connected(cells);const n=t=>l.filter(c=>c.type===t).length;
  return {parts:l.length,wings:n('wing'),tanks:n('tank'),balloons:n('balloon'),frames:n('frame'),engines:n('prop')+n('rocket')}}
// everything scoreFlight needs to know about the run around a flight
function flightCtx(run){return {lv:modLevels(run),boons:run.boons,flightIdx:run.flight,cleared:run.stage,coins:run.coins,streak:run.streak||0,loopsRun:run.loopsRun||0,coinsRun:run.coinsRun||0,
  empty:Math.max(0,modSlots(run)-run.mods.length),...craftCounts(run.cells)}}
function settleFlight(run,meta,f){
  const lv=modLevels(run), has=k=>!!lv[k];
  const sc=scoreFlight(f,flightCtx(run));
  run.streak=f.landed?(run.streak||0)+1:f.crashed?0:(run.streak||0);run.loopsRun=(run.loopsRun||0)+Math.min(3,f.loops||0);run.coinsRun=(run.coinsRun||0)+(f.coins||0);
  const invest=has('investor')?Math.min(modVal(lv,'investor'),Math.floor(sc.total/1000)):0;
  const pay=3+f.coins+modVal(lv,'sponsor')+invest;
  run.coins+=pay;run.score+=sc.total;run.total+=sc.total;run.flight++;run.best=Math.max(run.best,sc.total);run.bestDist=Math.max(run.bestDist||0,f.dist);
  // s: the flight's snapshot for balancing: the build it flew with, where the score came from, how it went
  const lvs=modLevels(run),r1=x=>Math.round(x*100)/100;
  run.log.push({stage:run.stage,flight:run.flight,score:sc.total,d:Math.round(f.dist),x:r1(sc.mult*sc.xm),
    s:{mods:run.mods.map(id=>lvs[id]>1?id+':'+lvs[id]:id),tune:{...run.tune},cells:cellCode(run.cells),lines:sc.lines.map(l=>[l.label,l.t,r1(l.v)]),
      maxY:Math.round(f.maxY),maxV:Math.round(f.maxV*3.6),end:f.crashed?'crash':f.landed?'land':f.banked?'bank':f.timeout?'time':f.becalmed?'calm':'air',
      // how long the flight lasted against the clock it had (seconds), to see how often flights run out of time
      t:Math.round(f.t||0),clock:Math.round(flightStats(run).flightTime),fuel:r1(f.fuelFrac||0),coinsPicked:f.coins,coins:run.coins}});
  meta.bestFlight=Math.max(meta.bestFlight||0,sc.total);
  const quota=run.mode==='daily'?Infinity:quotaFor(run.stage,run.level);
  const out={sc,pay,coinsPicked:f.coins,sponsor:has('sponsor'),quota,contractScore:run.score,prevScore:run.score-sc.total,stage:run.stage,flightNo:run.flight};
  // daily puzzle: one contract, three flights, the score is the sum; no target, no clearing
  if(run.mode==='daily'){if(run.flight>=FLIGHTS){run.phase='done';out.dailyDone=true}return out}
  // live rooms: the room adds everyone's flights up and says when a contract is cleared (clearContract) or lost
  if(isOnline(run)){out.quota=Infinity;return out}
  if(run.score>=quota){
    // Overachiever: every full 10% over the target pays coins
    if(has('overachiever')){const k=Math.floor((run.score-quota)/quota*10);out.over=Math.min(modVal(lv,'overachiever','w'),k*modVal(lv,'overachiever'));run.coins+=out.over}
    clearContract(run,meta,out)}
  else if(run.flight>=FLIGHTS){run.phase='over';out.failed=true}
  return out}
// a cleared contract: the reward (more for unused flights and storms), the next town's shop and packs, a storm reward
function clearContract(run,meta,out={}){
  const lv=modLevels(run), has=k=>!!lv[k];
  const unused=Math.max(0,FLIGHTS-run.flight), storm=isStorm(run.stage,run.level);
  const reward=6+2*unused+(storm?4:0);
  const interest=has('piggy')?Math.min(modVal(lv,'piggy'),Math.floor((run.coins+reward)/5)):0;
  run.coins+=reward+interest;
  Object.assign(out,{cleared:true,reward,unused,storm,interest});
  run.stage++;run.flight=0;run.score=0;
  const before=meta.bestStage||0;meta.bestStage=Math.max(before,run.stage);meta.deepest=Math.max(meta.deepest||0,run.stage);
  out.unlocks=isOnline(run)?[]:UNLOCKS.filter(u=>u.at>before&&u.at<=meta.bestStage).map(u=>u.text);
  run.unlocks.push(...out.unlocks);
  if(run.stage>=CONTRACTS&&!run.endless){run.phase='won';out.won=true;
    if(!isOnline(run)){meta.wins=(meta.wins||0)+1;if(run.level>=(meta.level||0)&&run.level<MAX_CEILING){meta.level=run.level+1;out.newLevel=meta.level}}}
  else{run.phase=isOnline(run)?'contract':'shop';run.shop=genShop(run,meta);weatherOf(run,run.stage);grantPacks(run);if(storm){run.boonOffer=rollBoons(run);out.boons=true}}
  return out}

export {
  GIMBAL, NEUT, PAR, VAC, VAC2, C_LIGHT, G0, COLS,
  ROWS, COCKPIT, MAXMODS, FLIGHTS, CONTRACTS, FLIGHT_TIME, clamp, PARTS, PALETTE,
  TUNES, tuneCost, RARITY, MODS, WEATHER, weatherFx, START, UNLOCKS,
  modUnlocked, QUOTA, quotaFor, isStorm, weatherOf, stats, DIRS,
  SOCK, STRUCT, linkage, connected, balanceOf, makeCraft, hs, groundY,
  COINSEG, COINR, thermalSeg, coinAt, newFlight, segDist, flag, step,
  popBalloons, summaryOf, scoreFlight, wpick, PART_W, rollMods, rollTunes, genShop,
  rerollShop, priceOf, offerPrice, rerollCost, sellValue, newRun, craftCounts, flightCtx, onTarget, TARGET_EVERY, settleFlight,
  PACKS, FIRST_PACKS, rollPacks, grantPacks, openPack, RARE, RARE_CHANCE, RARE_PACK_PRICE, isRare, baseOf, partName,
  MODMAX, modLevels, modVal, modDesc, modPrice, canBuy, applyPurchase, sellMod, flightStats, repeats, severity,
  MAX_CEILING, CEILING_RULES, ceilingRules, REDLINE, CLOUD9, ALT_STEP, altBonus, altMilestones, altReached,
  BOONS, rollBoons, boonDesc, pickBoon, modSlots,
  DAILY_COINS, dailyNumber, dailySeed, SIM_DT, isOnline, ONLINE_TIME, clearContract,
};
