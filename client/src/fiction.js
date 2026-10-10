// The Flying Circus fiction: town names for a season's tour and newspaper headlines for flights. Pure (no DOM), so the
// tests can import it. Everything is seeded from the run, so a town keeps its name across reloads.

// small deterministic PRNG (mulberry32) so a run's names never change
function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6d2b79f5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
const pick=(r,a)=>a[Math.floor(r()*a.length)];

const HEADS=['Mill','Pebble','Hay','Copper','Willow','Thistle','Puddle','Bramble','Clover','Goose','Turnip','Maple','Rusty','Honey','Buckle',
  'Kettle','Barley','Fiddle','Lantern','Muddy','Acorn','Cobble','Juniper','Pickle','Sparrow','Tumble','Whistle','Briar','Gander','Hollow'];
const TAILS=['brook','ton','field','ford','ville',' Hollow',' Junction',' Falls','wick',' Springs',' Crossing',' Flats','bury',' Creek',' Corners'];
// one kind of show per stretch of the tour (the run moves from county fairs to the big city)
const SHOWS=[['Fair','Hay Day','Picnic'],['Harvest Fest','Market Day','Jamboree'],['Regatta','Lighthouse Gala','Clambake'],
  ['Rodeo','Canyon Days','Chili Cook-off'],['Orchard Fest','Cider Days','Apple Fair'],['Mountain Air Meet','Pass Days','Snow Fair'],
  ['Air Races','Expo','Gala'],['Grand Finale','Grand Finale','Grand Finale']];
const CITIES=['Metropolis','Big Ridge','Port Royale','Union City','Capital City'];

// the town and its show for contract i of a run (endless contracts keep inventing towns)
function townOf(seed,i){
  const r=rng((seed||1)*31+i*977);
  if(i===7)return {town:pick(r,CITIES),show:'Grand Finale'};
  let town=pick(r,HEADS)+pick(r,TAILS);if(town.length>14)town=pick(r,HEADS)+'ton';
  return {town,show:pick(r,SHOWS[Math.min(i,6)])};
}
const showTitle=(seed,i)=>{const t=townOf(seed,i);return t.show==='Grand Finale'?`${t.town} Grand Finale`:`${t.town} ${t.show}`};

// a headline for a finished flight: the most remarkable thing about it, told by a small-town paper
// f: summaryOf() result plus {score, cleared, crashed}; ctx: {town, pilot}
function headline(f,ctx,seed){
  const r=rng((seed||1)+Math.floor(f.dist)*13+(f.loops||0)*7);
  const T=ctx.town||'Town', P=ctx.pilot||'Goat';
  const big=n=>n.toLocaleString('en-US');
  const pool=[];
  if(f.crashed)pool.push(`${P} meets ${T} turnip patch at speed`,`Crash at ${T}: pilot unhurt, pride less so`,`"I meant to do that," says ${P}`);
  if(f.loops>=5)pool.push(`${P} loops ${f.loops} times, pastor faints`,`Dizzy crowd demands refund after ${f.loops} loops`);
  else if(f.loops)pool.push(`${P} turns ${T} sky upside down`);
  if(f.passes>=2)pool.push(`Hats lost as ${P} skims ${T} field ${f.passes} times`);
  if(f.space)pool.push(`${P} reaches cloud nine, refuses to come down`);
  if(f.mach)pool.push(`Windows rattle as ${P} hits the redline`);
  if(f.coins>=8)pool.push(`${P} scoops ${f.coins} coins from thin air`);
  if(f.thermals>=3)pool.push(`${P} rides ${T} thermals like a hawk`);
  if(f.dist>=5000)pool.push(`${P} last seen heading for the next county`,`${big(Math.round(f.dist))} meters! ${T} cannot believe its eyes`);
  // the sell-out already gets its own banner, so the paper prefers any other story
  if(f.landed&&!pool.length)pool.push(`Smooth landing delights ${T}`,`${P} lands on a dime, crowd on its feet`);
  if(f.cleared&&!pool.length)pool.push(`Record crowd packs ${T} grandstand`,`${T} cheers its flying goat`);
  if(!pool.length)pool.push(`Modest flight at ${T}, cows unimpressed`,`${T} shrugs: "Seen further"`);
  return pick(r,pool);
}

export { townOf, showTitle, headline };
