// Balance harness: plays whole runs from the universal start with a scripted shopper, builder and pilot, then prints
// how far runs get and the score spread per contract against its quota.
//   node tools/bot.js [runs=20] [policy=climb|hands] [--seed=N] [--ceiling=N] [--storm=<weather id>|none] [--verbose]
// --storm puts the same weather on every storm contract (3, 6, 8), or none at all, to compare storms.
// Pilots press the same buttons a player has: pitch is -1/0/+1, re-decided at most every 0.2 s, plus one throttle.
//   climb  waits for flying speed, climbs at ~35° under power, then glides hands-off (a decent human).
//          Throttle is picked per build (full or 60%), like a player who tried both.
//   hands  pulls up for 0.6 s after launch, then flies hands-off at full throttle (a weak baseline).
// The builder test-flies layout variants of its inventory in the contract's (forecast) weather and keeps the best,
// so builds are sensible but not optimal. It opens its parts packs and shops before every flight.
import {
  newRun, weatherOf, stats, weatherFx, makeCraft, newFlight, step, popBalloons, summaryOf, scoreFlight, settleFlight,
  craftCounts, offerPrice, rerollCost, rerollShop, openPack, applyPurchase, canBuy, modLevels, flightStats, pickBoon, MAXMODS, COLS, ROWS, COCKPIT, quotaFor, isStorm, CONTRACTS, WEATHER,
} from '../client/src/sim.js';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = (k) => { const a = args.find((x) => x.startsWith('--' + k)); return a ? (a.split('=')[1] ?? true) : null; };
const RUNS = +pos[0] || 20;
const PN = pos[1] || 'climb';
const VERBOSE = !!opt('verbose');
const STORM = opt('storm');
const CEIL = +opt('ceiling') || 0;
if (STORM && STORM !== 'none' && !WEATHER[STORM]) throw new Error('unknown storm ' + STORM + ' (use: none, ' + Object.keys(WEATHER).join(', ') + ')');
// sim.js rolls shops and weather with Math.random; a seed makes two balance runs comparable
if (opt('seed') != null) {
  let s = +opt('seed') >>> 0;
  Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------- pilots ---------- */
// each factory returns a fresh controller (it keeps button state) for one flight
const POLS = {
  hands: { throttles: [1], make: (thr) => () => (S) => ({ pitch: S.t < 0.6 ? 1 : 0, throttle: thr }) },
  climb: {
    throttles: [1, 0.6],
    make: (thr) => () => {
      let next = 0, cmd = 0;
      return (S) => {
        if (S.t >= next) {
          next = S.t + 0.2;
          const g = Math.atan2(S.vy, S.vx) * 180 / Math.PI, v = Math.hypot(S.vx, S.vy);
          cmd = 0;
          if (S.fuel > 0 && v > 30) { if (g < 31 && S.w < 0.4) cmd = 1; else if (g > 41 && S.w > -0.4) cmd = -1; }
        }
        return { pitch: cmd, throttle: thr };
      };
    },
  },
};
const POL = POLS[PN];
if (!POL) throw new Error('unknown policy ' + PN + ' (use: ' + Object.keys(POLS).join(', ') + ')');

// mirrors the UI frame loop: 60 fps, substeps of at most 12 ms, fast-forward once hands-off for a second after 12 s
function fly(K, st, ctl) {
  const S = newFlight(K, st);
  let ts = 1, idle = 0;
  const dt = 1 / 60;
  while (!S.done) {
    const c = ctl(S);
    idle = c.pitch ? 0 : idle + dt;
    let tgt = 1;
    if (idle > 1 && S.t > 12) tgt = Math.min(4, 1 + (S.t - 12) / 8);
    if (S.fuel <= 0 && !S.touch && S.y > 2000) tgt = Math.max(tgt, Math.min(idle > 1 ? 30 : 3, S.y / 600));
    ts += (tgt - ts) * Math.min(1, dt * (tgt < ts ? 5 : 1.2));
    const total = dt * ts, v = Math.hypot(S.vx, S.vy);
    const n = Math.min(80, Math.max(Math.ceil(total / 0.012), Math.ceil(v * total / 0.6)));
    for (let i = 0; i < n && !S.done; i++) { step(S, K, st, total / n, c); if (S.burst && !S.popped) K = popBalloons(S, K, st); }
  }
  return { S, K };
}

/* ---------- builder ---------- */
const code = (cells) => cells.map((c) => (c.type === 'cockpit' ? 'c' : c.type[0]) + c.c + c.r).join(' ');
const inGrid = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

// a sensible first guess: a spine of frames/tanks toward the nose with the prop in front, a rocket behind,
// spare tanks under the spine, wings on top, balloons after the wings
function template(inv, st) {
  const cells = [{ ...COCKPIT, type: 'cockpit' }], occ = new Set([COCKPIT.c + ',' + COCKPIT.r]);
  const put = (c, r, type) => { if (!inGrid(c, r) || occ.has(c + ',' + r)) return false; cells.push({ c, r, type }); occ.add(c + ',' + r); return true; };
  const n = { ...inv };
  const take = (t) => (n[t] > 0 ? (n[t]--, true) : false);
  let col = COCKPIT.c + 1;
  while (col <= 4 && (n.frame > 0 || n.tank > 0)) { put(col, 2, take('frame') ? 'frame' : (take('tank'), 'tank')); col++; }
  const spineEnd = col - 1;
  if (take('prop')) put(col, 2, 'prop');
  if (take('rocket')) put(COCKPIT.c - 1, 2, 'rocket');
  for (let c = COCKPIT.c; c <= spineEnd && n.tank > 0; c++) if (put(c, 3, 'tank')) n.tank--;
  for (let c = COCKPIT.c; c <= spineEnd && n.wing > 0; c++) if (put(c, 1, 'wing')) n.wing--;
  for (let c = COCKPIT.c; c <= spineEnd && n.balloon > 0; c++) if (put(c, 1, 'balloon')) n.balloon--;
  // whatever is left goes wherever it fits; the search below sorts it out
  for (const t of Object.keys(n)) for (; n[t] > 0; n[t]--) placeValid(cells, t, st);
  return cells;
}
// bolt a part onto a random free cell where it connects and blocks nothing; with no such cell it stays in the inventory
function placeValid(cells, type, st) {
  const occ = new Set(cells.map((x) => x.c + ',' + x.r)), ok = [];
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    if (occ.has(c + ',' + r)) continue;
    const K = makeCraft([...cells, { c, r, type }], st);
    if (!K.loose && !K.blocked) ok.push({ c, r });
  }
  if (ok.length) cells.push({ ...ok[Math.floor(Math.random() * ok.length)], type });
}
function mutate(cells) {
  const out = cells.map((x) => ({ ...x }));
  const movable = out.filter((x) => x.type !== 'cockpit');
  if (!movable.length) return out;
  const a = movable[Math.floor(Math.random() * movable.length)];
  if (Math.random() < 0.3) {
    const b = movable[Math.floor(Math.random() * movable.length)];
    [a.type, b.type] = [b.type, a.type];
  } else {
    const occ = new Set(out.map((x) => x.c + ',' + x.r));
    // short hops keep the craft in one piece more often than random teleports
    for (let k = 0; k < 12; k++) {
      const c = a.c + Math.floor(Math.random() * 5) - 2, r = a.r + Math.floor(Math.random() * 5) - 2;
      if (inGrid(c, r) && !occ.has(c + ',' + r)) { a.c = c; a.r = r; break; }
    }
  }
  return out;
}
function evaluate(cells, run, st) {
  const K = makeCraft(cells, st);
  if (K.loose || K.blocked || !(K.counts.prop || K.counts.rocket)) return { score: -1 };
  let best = { score: -1 };
  for (const thr of POL.throttles) {
    const { S, K: K2 } = fly(K, st, POL.make(thr)());
    const f = summaryOf(S, K2);
    const sc = scoreFlight(f, { lv: modLevels(run), flightIdx: 1, cleared: run.stage, coins: run.coins, ...craftCounts(cells) });
    if (sc.total > best.score) best = { score: sc.total, thr };
  }
  return best;
}
const invOf = (cells) => cells.reduce((m, x) => (x.type !== 'cockpit' && (m[x.type] = (m[x.type] || 0) + 1), m), {});
// hill-climb from the template and from the last build (with any new parts added); one evaluation is one test flight
function build(run, st, prev, tries = 40) {
  const starts = [template(run.inv, st)];
  if (prev) {
    const cells = prev.cells.map((x) => ({ ...x })), have = invOf(cells);
    for (const t in run.inv) for (let i = have[t] || 0; i < run.inv[t]; i++) placeValid(cells, t, st);
    starts.push(cells);
  }
  let best = { cells: starts[0], ...evaluate(starts[0], run, st) };
  for (const s of starts.slice(1)) { const e = evaluate(s, run, st); if (e.score > best.score) best = { cells: s, ...e }; }
  for (let i = 0; i < tries; i++) {
    const cand = mutate(best.cells), e = evaluate(cand, run, st);
    // equal scores may drift (escapes flat spots), but never onto a layout that cannot fly
    if (e.score > best.score || (e.score === best.score && e.score >= 0)) best = { cells: cand, ...e };
  }
  return best;
}

/* ---------- shopper ---------- */
// share of the flight clock the last flight used; a permit is only worth buying once flights run into the limit
let lastFlightFrac = 0;
const MOD_VALUE = {
  third: 9, opening: 8, greaser: 8, frugal: 6, logbook: 9, compound: 7, wingman: 8, hauler: 7, odometer: 7, collector: 5,
  altimeter: 5, speedtrap: 4, slipstream: 7, overclock: 6, burnoff: 6, secondwind: 6, sponsor: 6, coupon: 5, piggy: 5,
  sling: 4, thermal: 3, gyro: 3, magnet: 3, solar: 5, afterburner: 4, ramscoop: 4, recycler: 4, antigrav: 6,
};
function offerValue(run, kind, o) {
  const inv = (t) => run.inv[t] || 0, engine = inv('prop') + inv('rocket');
  if (kind === 'part') {
    if (!engine && (o.t === 'prop' || o.t === 'rocket')) return o.t === 'prop' ? 100 : 90;
    return { wing: inv('wing') < 3 ? 6 : 0, tank: inv('tank') < 3 ? 5 : 0, frame: inv('frame') < 2 ? 4 : 0, prop: inv('prop') < 2 ? 4 : 0, rocket: 0, balloon: 0 }[o.t];
  }
  if (kind === 'tune') return { prop: inv('prop') ? 9 : 0, rocket: inv('rocket') && !inv('prop') ? 8 : 0, fuel: 8, light: 6, wing: 5, launch: 3, time: lastFlightFrac > 0.85 ? 7 : 0, balloon: 0 }[o.k];
  if (!canBuy(run, kind, o)) return 0;
  const base = o.id === 'minimal' ? (run.cells.length <= 6 ? 8 : 0) : MOD_VALUE[o.id] || 0;
  // an upgrade of a mod already in use is worth a bit less than a fresh one
  return modLevels(run)[o.id] ? base * 0.8 : base;
}
// storm rewards, best first for this bot's long glides
const BOON_RANK = ['slot', 'upgrade', 'drag', 'fuel', 'grav', 'coins', 'land', 'thermal', 'coin', 'pass', 'loop'];
function botShop(run, meta) {
  if (run.boonOffer) { const r = (o) => BOON_RANK.indexOf(o.id); pickBoon(run, r(run.boonOffer[0]) <= r(run.boonOffer[1]) ? 0 : 1); }
  while (run.packs && run.packs.length) openPack(run);
  for (let pass = 0; pass < 2; pass++) {
    const offers = [];
    for (const [kind, list] of [['part', run.shop.parts], ['tune', run.shop.tunes], ['mod', run.shop.mods]])
      for (const o of list) if (!o.sold) offers.push({ kind, o });
    // greedy by value; re-check values after each buy (owning a prop changes what is worth buying)
    for (;;) {
      let pick = null;
      for (const x of offers) {
        if (x.o.sold) continue;
        const v = offerValue(run, x.kind, x.o), p = offerPrice(run, x.kind, x.o);
        if (v > 0 && p <= run.coins && (!pick || v > pick.v)) pick = { ...x, v, p };
      }
      if (!pick) break;
      applyPurchase(run, pick.kind, pick.o);
    }
    if (pass === 0 && run.coins >= rerollCost(run) + 8) { run.coins -= rerollCost(run); rerollShop(run, meta); } else break;
  }
}

/* ---------- runs ---------- */
const reach = [], stageScores = {};
const t0 = Date.now();
for (let n = 0; n < RUNS; n++) {
  const meta = { bestStage: 8 };
  const run = newRun(CEIL, meta);
  if (STORM && STORM !== 'none') for (let i = 0; i < CONTRACTS; i++) if (isStorm(i)) run.weather[i] = STORM;
  lastFlightFrac = 0;
  let craft = null, sig = '';
  let guard = 0;
  while (run.phase !== 'over' && run.phase !== 'won' && guard++ < 60) {
    if (run.phase === 'shop') run.phase = 'contract';
    botShop(run, meta);
    if (STORM === 'none') run.weather[run.stage] = undefined;
    const wx = STORM === 'none' ? null : weatherOf(run, run.stage), st = STORM === 'none' ? stats(run.tune, modLevels(run), weatherFx(null, 0)) : flightStats(run);
    // rebuild only when something that changes the flight has changed
    const now = JSON.stringify([run.inv, run.tune, run.mods, wx]);
    if (now !== sig) { craft = build(run, st, craft); sig = now; }
    run.cells = craft.cells;
    const K = makeCraft(run.cells, st);
    const { S, K: K2 } = fly(K, st, POL.make(craft.thr ?? 1)());
    const f = summaryOf(S, K2), stg = run.stage;
    lastFlightFrac = S.t / st.flightTime;
    const out = settleFlight(run, meta, f);
    (stageScores[stg] = stageScores[stg] || []).push(out.sc.total);
    if (VERBOSE) console.log(`  c${stg + 1} f${out.flightNo} ${String(out.sc.total).padStart(6)} ${Math.round(f.dist)} m ×${out.sc.mult * out.sc.xm}${f.crashed ? ' crash' : ''}  ${out.contractScore}/${out.quota}  thr ${craft.thr}  ${wx || ''}`);
  }
  reach.push(run.stage);
  console.log('run', n, 'cleared', run.stage, 'coins', run.coins, 'mods', run.mods.join(','), 'tune', JSON.stringify(run.tune), 'craft', code(run.cells));
}
console.log('policy', PN, 'avg cleared', (reach.reduce((a, b) => a + b, 0) / reach.length).toFixed(2), 'dist', JSON.stringify(reach.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
for (const k in stageScores) {
  const a = stageScores[k].sort((x, y) => x - y);
  // of the runs that got to this contract, how many cleared it
  const got = reach.filter((x) => x >= +k).length, won = reach.filter((x) => x > +k).length;
  console.log('contract', +k + 1, 'quota', quotaFor(+k, CEIL), 'cleared', `${won}/${got}`, 'flights', a.length, 'median', a[Math.floor(a.length / 2)], 'p80', a[Math.floor(a.length * 0.8)], 'max', a[a.length - 1]);
}
