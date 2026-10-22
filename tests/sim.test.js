// Headless checks of the simulation core. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newRun, stats, weatherFx, makeCraft, newFlight, step, popBalloons, summaryOf, scoreFlight, settleFlight,
  quotaFor, openPack, PACKS, FIRST_PACKS, rollTunes, thermalSeg, G0, repeats, rerollShop, applyPurchase, offerPrice, rollMods,
  isStorm, grantPacks, flightStats, MODMAX, pickBoon, rollBoons, modSlots, dailySeed, clearContract, ONLINE_TIME, SIM_DT,
  craftCounts, flightCtx, dropRemovedMods, MODS, trickVal, distBonus, distMilestones, altBonus, flightCoins, landingShare,
} from '../client/src/sim.js';
import { botFlight, planBot, BUILDS, cellsOf } from '../client/src/bots.js';

// 'c22 p32 w21 t23' -> cockpit at (2,2), prop at (3,2), wing at (2,1), tank at (2,3)
const T = { c: 'cockpit', p: 'prop', r: 'rocket', t: 'tank', w: 'wing', b: 'balloon', f: 'frame' };
const layout = (s) => s.split(' ').map((x) => ({ type: T[x[0]], c: +x[1], r: +x[2] }));

function fly(cells, { tune = {}, mods = [], wx = null, stage = 0, ctl = () => ({ pitch: 0, throttle: 1 }) } = {}) {
  const st = stats(tune, mods, weatherFx(wx, stage));
  let K = makeCraft(layout(cells), st);
  const S = newFlight(K, st);
  while (!S.done) {
    step(S, K, st, 1 / 240, ctl(S));
    if (S.burst && !S.popped) K = popBalloons(S, K, st);
  }
  return { S, K };
}

test('the opening packs always hold a tank, a wing and an engine', () => {
  for (let i = 0; i < 500; i++) {
    const run = newRun(0, { bestStage: 0 });
    assert.deepEqual(run.cells, [{ c: 2, r: 2, type: 'cockpit' }]);
    assert.deepEqual(run.inv, {});
    assert.equal(run.packs.length, FIRST_PACKS);
    while (run.packs.length) openPack(run);
    assert.ok(run.inv.tank >= 1 && run.inv.wing >= 1 && (run.inv.prop || run.inv.rocket));
    assert.equal(Object.values(run.inv).reduce((a, b) => a + b, 0), FIRST_PACKS);
  }
});

test('a cheap first build can clear contract 1 hands-off', () => {
  const { S, K } = fly('c22 p32 w21 t23');
  assert.ok(S.landed, 'should land cleanly');
  const sc = scoreFlight(summaryOf(S, K), { mods: [], flightIdx: 0, cleared: 0, coins: 0, parts: 4, wings: 1, tanks: 1 });
  assert.ok(sc.total * 3 >= quotaFor(0, 0), `3 flights of ${sc.total} should reach ${quotaFor(0, 0)}`);
});

test('throttle scales fuel burn', () => {
  const full = fly('c22 p32 w21 t23', { ctl: () => ({ pitch: 0, throttle: 1 }) });
  const half = fly('c22 p32 w21 t23', { ctl: (S) => ({ pitch: 0, throttle: S.t < 5 ? 0.5 : 1 }) });
  assert.notEqual(Math.round(full.S.maxX), Math.round(half.S.maxX));
});

test('flight permits add a minute each, up to three, and stop being offered', () => {
  assert.equal(stats({}, [], weatherFx(null, 0)).flightTime, 120);
  assert.equal(stats({ time: 2 }, [], weatherFx(null, 0)).flightTime, 240);
  assert.equal(stats({ time: 9 }, [], weatherFx(null, 0)).flightTime, 300);
  const run = newRun(0, { bestStage: 0 });
  run.tune.time = 3;
  for (let i = 0; i < 200; i++) assert.ok(!rollTunes(run, 2, []).includes('time'));
});

test('gusts cannot be farmed for unlimited height', () => {
  const gf = (S) => Math.sin(S.x / 61 + 1.3) * Math.cos(S.t * 0.9 + S.x / 97);
  const { S } = fly('c22 p32 w21 w31 t23', { wx: 'gusts', stage: 7, tune: { prop: 3, light: 3 }, ctl: (S) => ({ pitch: gf(S) > 0 ? 1 : 0, throttle: 1 }) });
  assert.ok(S.maxY < 2000, `max altitude ${S.maxY.toFixed(0)} m`);
});

test('long, heavy flights stay finite', () => {
  const { S } = fly('c22 r12 t32 t42 w21 w31', { tune: { rocket: 6, fuel: 6 }, mods: ['afterburner', 'slipstream'], ctl: (S) => ({ pitch: S.t < 3 ? 1 : 0, throttle: 1 }) });
  for (const k of ['x', 'y', 'vx', 'vy', 'th']) assert.ok(Number.isFinite(S[k]), `${k} = ${S[k]}`);
});

test('reaching the quota clears the contract and opens a new shop', () => {
  const run = newRun(0, { bestStage: 0 });
  const meta = { bestStage: 0 };
  const f = { dist: quotaFor(0, 0), maxY: 50, maxV: 30, coins: 0, loops: 0, passes: 0, thermals: 0, landed: true, fuelFrac: 0 };
  const out = settleFlight(run, meta, f);
  assert.ok(out.cleared);
  assert.equal(run.stage, 1);
  assert.equal(run.phase, 'shop');
  assert.equal(run.packs.length, FIRST_PACKS + PACKS, 'unopened packs carry over, the next contract adds one');
});

test('thermals never out-lift gravity, at any Thermal Rider or Antigravity level', () => {
  for (let t = 0; t <= MODMAX; t++) for (let a = 0; a <= MODMAX; a++) {
    const lv = {}; if (t) lv.thermal = t; if (a) lv.antigrav = a;
    const st = stats({}, lv, weatherFx(null, 0));
    for (let k = 1; k < 200; k++) { const th = thermalSeg(k, st); if (th) assert.ok(th.str < G0 * st.grav, `thermal ${t} antigrav ${a}: ${th.str} vs ${G0 * st.grav}`); }
  }
});

test('repeated loops pay less each time', () => {
  assert.equal(repeats(1), 1);
  assert.ok(repeats(40) < 7, `40 loops count as ${repeats(40).toFixed(2)}`);
  const f = { dist: 1000, maxY: 50, maxV: 30, coins: 0, loops: 10, passes: 0, thermals: 0, landed: false, fuelFrac: 0 };
  assert.ok(scoreFlight(f, { mods: [], flightIdx: 1, cleared: 0, coins: 0, parts: 4, wings: 1, tanks: 1 }).mult < 1 + 10 * 0.5);
});

test('a balloon craft rises until its balloons burst instead of counting as stalled', () => {
  const { S } = fly('c22 b21 b31 b11 b41 f32 f12 f42', { tune: { balloon: 2 }, ctl: () => ({ pitch: 0, throttle: 0 }) });
  assert.ok(S.maxY > 1900, `max altitude ${S.maxY.toFixed(0)} m`);
});

test('a reroll is a whole new shop, sold slots included', () => {
  const run = newRun(0, { bestStage: 0 });
  run.coins = 100;
  for (const o of run.shop.parts) applyPurchase(run, 'part', o);
  assert.ok(run.shop.parts.every((o) => o.sold));
  rerollShop(run, { bestStage: 0 });
  assert.ok(run.shop.parts.every((o) => !o.sold) && run.shop.parts.length === 3);
  assert.equal(run.shop.tunes.filter((o) => o.sold).length, 0);
});

test('owned mods level up to MODMAX, cost more each level and need no new slot', () => {
  const run = newRun(0, { bestStage: 8 });
  run.coins = 100;
  const o = { id: 'third' };
  assert.ok(applyPurchase(run, 'mod', o));
  run.mods.push('a', 'b', 'c', 'd'); // fill the other slots
  const up = { id: 'third' }, p1 = offerPrice(run, 'mod', up);
  assert.ok(applyPurchase(run, 'mod', up));
  assert.equal(run.modLv.third, 2);
  assert.equal(offerPrice(run, 'mod', { id: 'third' }), p1 + 2);
  applyPurchase(run, 'mod', { id: 'third' });
  assert.equal(run.modLv.third, MODMAX);
  assert.equal(applyPurchase(run, 'mod', { id: 'third' }), false);
  run.mods.length = 1;
  for (let i = 0; i < 300; i++) assert.ok(!rollMods(run, { bestStage: 8 }, 3, []).includes('third'));
});

test('ceiling rules: pricier shop, a fourth storm, fewer packs, a shorter clock', () => {
  const meta = { bestStage: 0 };
  const r1 = newRun(1, meta), r2 = newRun(2, meta);
  assert.equal(offerPrice(r2, 'part', { t: 'wing' }), offerPrice(r1, 'part', { t: 'wing' }) + 1);
  assert.ok(!isStorm(4, 3) && isStorm(4, 4));
  // Difficulty 6: packs never hold rare parts and the shop has no rare pack
  { let rare = 0; for (let i = 0; i < 200; i++) { const r = newRun(6, meta, { seed: i }); r.packs = []; r.stage = 1; grantPacks(r); rare += r.packs.filter((t) => t.endsWith('+')).length + (r.shop.pack ? 1 : 0); } assert.equal(rare, 0); }
  const r5 = newRun(5, meta); r5.packs = []; r5.stage = 1; grantPacks(r5); assert.equal(r5.packs.length, PACKS);
  assert.equal(flightStats(newRun(9, meta)).flightTime, 120);
  assert.equal(flightStats(newRun(10, meta)).flightTime, 90);
  assert.equal(quotaFor(0, 10), 1750);
});

test('clearing a storm contract offers 2 storm rewards; picks apply and the slot reward comes once', () => {
  const meta = { bestStage: 0 };
  const run = newRun(0, meta);
  run.stage = 2; // contract 3 is a storm
  const f = { dist: quotaFor(2, 0), maxY: 50, maxV: 30, coins: 0, loops: 0, passes: 0, thermals: 0, landed: true, fuelFrac: 0 };
  settleFlight(run, meta, f);
  assert.equal(run.boonOffer.length, 2);
  run.boonOffer = [{ id: 'slot' }, { id: 'drag' }];
  assert.ok(pickBoon(run, 0));
  assert.equal(modSlots(run), 6);
  assert.equal(run.boonOffer, null);
  for (let i = 0; i < 200; i++) assert.ok(!rollBoons(run).some((o) => o.id === 'slot'));
  run.boonOffer = [{ id: 'drag' }, { id: 'coins' }];
  pickBoon(run, 0);
  assert.ok(Math.abs(flightStats(run).drag - 0.92) < 1e-9);
});

test('a seed fixes the run: same shop, packs and weather for everyone', () => {
  const a = newRun(0, { bestStage: 8 }, { seed: 12345 }), b = newRun(0, { bestStage: 8 }, { seed: 12345 });
  assert.deepEqual(a.shop, b.shop);
  assert.deepEqual(a.packs, b.packs);
  assert.deepEqual(a.weather, b.weather);
  rerollShop(a, { bestStage: 8 }); rerollShop(b, { bestStage: 8 });
  assert.deepEqual(a.shop, b.shop);
  const c = newRun(0, { bestStage: 8 }, { seed: 54321 });
  assert.notDeepEqual(a.packs.concat(a.shop.parts.map((o) => o.t)), c.packs.concat(c.shop.parts.map((o) => o.t)).concat(['x']));
});

test('daily puzzle: 100 coins, no storms, three flights then done', () => {
  const meta = { bestStage: 0 };
  const run = newRun(0, meta, { mode: 'daily', seed: dailySeed(1) });
  assert.equal(run.coins, 100);
  assert.deepEqual(Object.values(run.weather).filter(Boolean), []);
  const f = { dist: 900, maxY: 50, maxV: 30, coins: 0, loops: 0, passes: 0, thermals: 0, landed: true, fuelFrac: 0 };
  for (let i = 0; i < 2; i++) assert.ok(!settleFlight(run, meta, f).dailyDone);
  const out = settleFlight(run, meta, f);
  assert.ok(out.dailyDone && run.phase === 'done' && !out.cleared);
  assert.equal(run.score, run.log.reduce((t, l) => t + l.score, 0));
  assert.equal(dailySeed(5), dailySeed(5));
  assert.notEqual(dailySeed(5), dailySeed(6));
});

test('live rooms: the weather depends on the seed alone, the room clears contracts, flights are short', () => {
  const a = newRun(0, { bestStage: 0 }, { mode: 'team', seed: 777 }), b = newRun(0, { bestStage: 8 }, { mode: 'team', seed: 777 });
  assert.deepEqual(a.weather, b.weather);
  assert.equal(flightStats(a).flightTime, ONLINE_TIME);
  const f = { dist: 5000, maxY: 50, maxV: 30, coins: 0, loops: 0, passes: 0, thermals: 0, landed: true, fuelFrac: 0 };
  const out = settleFlight(a, {}, f);
  assert.ok(!out.cleared && a.stage === 0 && a.flight === 1, 'a big flight alone does not clear: the room decides');
  const coins = a.coins, c = clearContract(a, {}, {});
  assert.ok(c.cleared && a.stage === 1 && a.flight === 0 && a.phase === 'contract' && a.coins > coins && a.packs.length);
});

test('bots: every build is whole, a planned bot flight is reproducible and finishes inside the clock', () => {
  for (const [style, list] of Object.entries(BUILDS)) for (const code of list) { const K = makeCraft(cellsOf(code), stats({}, {}, weatherFx(null, 0))); assert.ok(!K.loose && !K.blocked, `${style} ${code}`); }
  for (let round = 0; round < 6; round++) for (let i = 0; i < 4; i++) {
    const once = () => { const b = planBot(botFlight(99, round, i, ONLINE_TIME)); let K = b.K; const S = newFlight(K, b.st); let n = 0;
      while (!S.done && n < 200000) { step(S, K, b.st, SIM_DT, b.ctl(S)); if (S.burst && !S.popped) K = popBalloons(S, K, b.st); n++; }
      return { b, S, sc: scoreFlight(summaryOf(S, K), b.ctx).total }; };
    const x = once(), y = once();
    assert.ok(x.S.done && x.S.t <= ONLINE_TIME + 1); assert.equal(x.sc, y.sc); assert.deepEqual(x.b.P, y.b.P);
  }
});

test('daily shops never offer Logbook', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const run = newRun(0, { bestStage: 8 }, { mode: 'daily', seed });
    for (let i = 0; i < 3; i++) { assert.ok(!run.shop.mods.some((o) => o.id === 'logbook')); rerollShop(run, { bestStage: 8 }); }
  }
  assert.ok(rollMods(newRun(0, { bestStage: 8 }), { bestStage: 8 }, 99, []).includes('logbook'));
});

test('telemetry: every flight logs a snapshot, and purchases, packs and rerolls are noted', () => {
  const meta = { bestStage: 8 }, run = newRun(0, meta, { seed: 4242 });
  while (run.packs.length) openPack(run);
  const o = run.shop.parts[0]; applyPurchase(run, 'part', o);
  rerollShop(run, meta);
  const f = { dist: 900, maxY: 60, maxV: 40, coins: 2, loops: 1, passes: 2, thermals: 0, landed: true, fuelFrac: 0.5 };
  settleFlight(run, meta, f);
  const s = run.log[0].s;
  assert.equal(s.cells, 'c22'); assert.equal(s.end, 'land'); assert.equal(s.maxV, 144);
  assert.equal(s.clock, 120); assert.equal(s.t, 0);
  settleFlight(run, meta, { ...f, landed: false, timeout: true, t: 120.4 });
  assert.equal(run.log[1].s.end, 'time'); assert.equal(run.log[1].s.t, 120);
  assert.ok(s.lines.some(([l]) => l === '2 low passes'));
  const kinds = run.ev.map((e) => e[0]);
  assert.deepEqual(kinds.filter((k) => k !== 'pack'), ['buy', 'reroll']);
  assert.equal(kinds.filter((k) => k === 'pack').length, FIRST_PACKS);
});

// ---------- 0.4 mods ----------
const flyWith = (cells, mods, ctl = () => ({ pitch: 0, throttle: 1 }), pop) => {
  const st = stats({}, mods, weatherFx(null, 0)); st.flightTime = 600; /* slow balloon climbs: test the mechanic, not the clock */ let K = makeCraft(layout(cells), st); const S = newFlight(K, st); let last = 0, lt = 0;
  while (!S.done) {
    if (pop && K.counts.balloon && !S.burst && S.t - lt > 5) { if (S.y - last < 20 && S.y > 200) S.burst = true; last = S.y; lt = S.t; }
    step(S, K, st, SIM_DT, ctl(S)); if (S.burst && !S.popped) K = popBalloons(S, K, st);
  }
  return { S, K, f: summaryOf(S, K) };
};
const BALLOON_GLIDER = 'c22 f32 f12 b11 b21 b31 w02';

test('every mod has a how-to line and three level values', () => {
  for (const [id, M] of Object.entries(MODS)) { assert.ok(M.how && M.how.length > 10, id); assert.equal(M.v.length, 3, id); }
});

test('Dive Bomber turns height into speed: Redline from a balloon dive, never more energy than the height gave', () => {
  const dive = (S) => ({ pitch: S.popped && S.y > 80 ? -1 : 0, throttle: 1 });
  const plain = flyWith(BALLOON_GLIDER, {}, dive, true).f, bomb = flyWith(BALLOON_GLIDER, { divebomb: 3, slipstream: 3 }, dive, true).f;
  assert.ok(plain.maxV * 3.6 < 300 && bomb.mach, `${plain.maxV * 3.6} -> ${bomb.maxV * 3.6} km/h`);
  // energy check: top speed stays below free fall from the highest point
  assert.ok(bomb.maxV < Math.sqrt(2 * G0 * bomb.maxY) + 30);
});

test('Hot-Air Burner lets balloons climb past where they stall, paid for with fuel', () => {
  const cells = 'c22 f32 f12 b11 b21 b31 w02 t23', go = (mods) => { const st = stats({}, mods, weatherFx(null, 0)); st.flightTime = 600; const K = makeCraft(layout(cells), st); const S = newFlight(K, st);
    while (!S.done && !S.burst) step(S, K, st, SIM_DT, { pitch: 0, throttle: 1 }); return S; };
  const a = go({ envelope: 1 }), b = go({ envelope: 1, burner: 3 });
  assert.ok(a.maxY < 2000 && b.maxY > 3500, `${a.maxY} -> ${b.maxY}`);
  assert.ok(b.fuel < a.fuel, 'the burner burns fuel');
});

test('Sailplane and Supercharger add distance; Booster gets rockets climbing', () => {
  const bg = (m) => flyWith(BALLOON_GLIDER, m, undefined, true).f.dist;
  assert.ok(bg({ sailplane: 3 }) > bg({}) * 1.15);
  const climb = (S) => { const g = Math.atan2(S.vy, S.vx) * 57.3, v = Math.hypot(S.vx, S.vy); return { pitch: S.fuel > 0 && v > 20 ? (g < 30 ? 1 : g > 40 ? -1 : 0) : 0, throttle: 1 }; };
  const pg = 'c22 f32 p42 w21 w31 t23';
  assert.ok(flyWith(pg, { supercharge: 3 }, climb).f.dist > flyWith(pg, {}, climb).f.dist * 1.3);
  const rc = 'c22 f32 t12 r02 w21 w31 t23 t33';
  assert.ok(flyWith(rc, { booster: 3 }, climb).f.maxY > flyWith(rc, {}, climb).f.maxY * 2);
});

test('Silent Flight, Balloon Bouquet, Carpenter and Understudy count the right things', () => {
  const cc = craftCounts(layout(BALLOON_GLIDER));
  assert.deepEqual([cc.engines, cc.balloons, cc.frames], [0, 3, 2]);
  const f = { dist: 1000, maxY: 50, maxV: 30, coins: 0, loops: 0, passes: 0, thermals: 0, landed: false, fuelFrac: 0 };
  const sc = scoreFlight(f, { lv: { silent: 1, bouquet: 1, carpenter: 1, understudy: 1 }, ...cc, empty: 1 });
  const lab = Object.fromEntries(sc.lines.map((l) => [l.label, l.v]));
  assert.equal(lab['Silent Flight'], 1.5); assert.equal(lab['Balloon Bouquet'], 0.6); assert.equal(lab.Carpenter, 0.3); assert.equal(lab.Understudy, 1.2);
  const withProp = scoreFlight(f, { lv: { silent: 1 }, ...craftCounts(layout('c22 p32 w21')) });
  assert.ok(!withProp.lines.some((l) => l.label === 'Silent Flight'));
  // carpenter frames weigh nothing
  const st0 = stats({}, {}, weatherFx(null, 0)), st1 = stats({}, { carpenter: 1 }, weatherFx(null, 0));
  assert.ok(makeCraft(layout('c22 f32 f42'), st1).m < makeCraft(layout('c22 f32 f42'), st0).m);
});

test('Hedgehopper and Frequent Flyer follow the flight and the run', () => {
  const f = (o) => ({ dist: 800, maxY: 25, maxV: 30, coins: 0, loops: 0, passes: 0, thermals: 0, landed: true, fuelFrac: 0, landX: 403, ...o });
  const lab = (fl, lv, ctx = {}) => Object.fromEntries(scoreFlight(fl, { lv, ...ctx }).lines.map((l) => [l.label, l.v]));
  assert.equal(lab(f({}), { hedgehop: 2 }).Hedgehopper, 2); assert.equal(lab(f({ maxY: 31 }), { hedgehop: 2 }).Hedgehopper, undefined);
  // the streak lives on the run: two landings, then a crash resets it
  const meta = { bestStage: 8 }, run = newRun(0, meta, { seed: 9 }); run.mods = ['flyer']; run.modLv = { flyer: 1 };
  settleFlight(run, meta, f({})); const out2 = settleFlight(run, meta, f({}));
  assert.equal(run.streak, 2); assert.ok(out2.sc.lines.some((l) => l.label === 'Frequent Flyer' && l.v === 0.2));
  settleFlight(run, meta, f({ landed: false, crashed: true })); assert.equal(run.streak, 0);
});

test('touch-and-gos and combos are detected in flight, and Fan Club counts at most 3 loops a flight', () => {
  const st = stats({}, {}, weatherFx(null, 0)), K = makeCraft(layout('c22 f32 p42 w21 w31 t23'), st), S = newFlight(K, st);
  Object.assign(S, { x: 100, y: 2.4, vx: 30, vy: -1.5, th: 0 });
  for (let i = 0; i < 1200 && !S.done; i++) step(S, K, st, SIM_DT, { pitch: S.touch || S.tgArm ? 1 : 0, throttle: 1 });
  assert.equal(S.touchgos, 1);
  const f = { dist: 500, maxY: 60, maxV: 30, coins: 0, loops: 10, passes: 0, thermals: 0, landed: false, fuelFrac: 0, combos: 2 };
  const lab = Object.fromEntries(scoreFlight(f, { lv: { fanclub: 1, showboat: 1 }, loopsRun: 10 }).lines.map((l) => [l.label, l.v]));
  assert.equal(lab['Fan Club'], 0.39); assert.equal(lab['2 combos'], 0.33);
});

test('altitude milestones are a landing bonus; Rubber Hull lets a wingless craft bounce to a stop and land', () => {
  const f = (o) => ({ dist: 100, maxY: 520, maxV: 30, coins: 0, loops: 0, passes: 0, thermals: 0, landed: false, fuelFrac: 0, ...o });
  const alt = (o) => scoreFlight(f(o), { lv: {} }).lines.find((l) => l.label.startsWith('Altitude'));
  assert.equal(alt({ landed: true }).v, 1000); assert.equal(alt({ crashed: true }), undefined); assert.equal(alt({}), undefined);
  for (const vx of [null, 0]) {
    const st = stats({}, { bounce: 1 }, weatherFx(null, 0)); let K = makeCraft(layout('c22 f32 f12 b11 b21 b31'), st); const S = newFlight(K, st);
    while (!S.done) { if (!S.burst && S.y >= 300) S.burst = true; step(S, K, st, SIM_DT, { pitch: 0, throttle: 1 }); if (S.burst && !S.popped) { K = popBalloons(S, K, st); if (vx === 0) S.vx = 0; } }
    assert.ok(S.landed && !S.crashed, 'Rubber Hull drop lands');
  }
  assert.equal(alt({ landed: true, maxY: 90 }), undefined);
});

test('0.5 mods: Long Haul counts landed minutes, Magpie the coins of the run, Investor and Overachiever pay coins', () => {
  const f = (o) => ({ dist: 2000, maxY: 50, maxV: 30, coins: 4, loops: 0, passes: 0, thermals: 0, landed: true, fuelFrac: 0, t: 130, ...o });
  const lab = (fl, lv, ctx = {}) => Object.fromEntries(scoreFlight(fl, { lv, ...ctx }).lines.map((l) => [l.label, l.v]));
  assert.equal(lab(f({}), { longhaul: 1 })['Long Haul'], 0.6); assert.equal(lab(f({ landed: false, crashed: true }), { longhaul: 1 })['Long Haul'], undefined);
  assert.equal(lab(f({}), { magpie: 1 }, { coinsRun: 96 })['Magpie'], 1);
  const meta = { bestStage: 8 }, run = newRun(0, meta, { seed: 5 }); run.mods = ['investor', 'overachiever']; run.modLv = { investor: 1, overachiever: 2 };
  const coins0 = run.coins, out = settleFlight(run, meta, f({ dist: 3000 }));
  assert.ok(out.cleared && out.sc.total >= 3000);
  const invest = Math.min(4, Math.floor(out.sc.total / 1000)), over = Math.min(10, 2 * Math.floor((out.sc.total - 500) / 500 * 10));
  assert.equal(out.over, over);
  assert.equal(run.coins - coins0, 3 + 4 + invest + over + out.reward + out.interest);
  assert.equal(run.coinsRun, 4);
});

test('rare parts: about 15% of later packs, rare packs in some shops, and each rare trait shows in the craft', () => {
  const meta = { bestStage: 8 };
  let rare = 0, n = 0, shops = 0;
  for (let i = 0; i < 400; i++) { const r = newRun(0, meta, { seed: 1000 + i }); r.packs = []; r.stage = 1; grantPacks(r); n += r.packs.length; rare += r.packs.filter((t) => t.endsWith('+')).length; if (r.shop.pack) shops++; }
  assert.ok(n === 400 && rare > 30 && rare < 95, `${rare} rare of ${n}`); assert.ok(shops > 60 && shops < 150, `${shops} rare packs in 400 shops`);
  const run = newRun(0, meta, { seed: 3 }); run.coins = 50; run.shop.pack = { t: 'wing+' };
  assert.ok(applyPurchase(run, 'pack', run.shop.pack)); assert.equal(run.packs[run.packs.length - 1], 'wing+');
  const st = stats({}, {}, weatherFx(null, 0)), cell = (code, rare) => layout(code).map((c) => (rare.includes(c.type) ? { ...c, rare: 1 } : c));
  const a = makeCraft(layout('c22 f32 p42 w21 t23 b31'), st), b = makeCraft(cell('c22 f32 p42 w21 t23 b31', ['wing', 'tank', 'prop', 'balloon', 'frame']), st);
  assert.ok(b.m < a.m); assert.equal(b.wingLift, 1.3); assert.equal(b.balLift, 1.6); assert.equal(b.propPow, 1.4);
  assert.ok(Math.abs(b.fuelMax - (st.reserve + 1.8 * st.tankFuel)) < 1e-9); assert.equal(b.burstBonus, 1000);
});

test('trick values include storm rewards and match what scoreFlight pays (the in-flight pop-ups show them)', () => {
  const ctx = { lv: {}, boons: { thermal: 1, loop: 2, pass: 1, coin: 1 } };
  assert.ok(Math.abs(trickVal(ctx, 'thermal') - 0.2) < 1e-9);
  assert.ok(Math.abs(trickVal(ctx, 'loop') - 0.7) < 1e-9);
  assert.ok(Math.abs(trickVal(ctx, 'pass') - 0.35) < 1e-9);
  assert.ok(Math.abs(trickVal(ctx, 'coin') - 0.08) < 1e-9);
  assert.ok(Math.abs(trickVal({ lv: {} }, 'thermal') - 0.1) < 1e-9);
  const base = { dist: 100, maxY: 0, landed: false, crashed: false, thermals: 2, loops: 0, passes: 0, coins: 0 };
  const line = scoreFlight(base, ctx).lines.find(l => /thermal/.test(l.label));
  assert.ok(Math.abs(line.v - 2 * trickVal(ctx, 'thermal')) < 1e-9);
});

test('distance milestones: the altitude ladder at 5x the spacing, a landing bonus; Golden Parachute keeps a share in the air', () => {
  assert.equal(distMilestones(499), 0); assert.equal(distMilestones(500), 1); assert.equal(distMilestones(5000), 5); assert.equal(distMilestones(6250), 6);
  assert.equal(distBonus(5000), altBonus(1000)); assert.equal(distBonus(10000), altBonus(2000)); assert.equal(distBonus(5000), 2750);
  const f = { dist: 5000, maxY: 1000, landed: true, crashed: false, loops: 0, passes: 0, thermals: 0, coins: 0 };
  const base = s => s.lines.filter(l => l.t === 'b').reduce((t, l) => t + l.v, 0);
  assert.equal(base(scoreFlight(f, { lv: {} })), 5000 + 2750 + 2750);
  assert.equal(base(scoreFlight({ ...f, landed: false, crashed: true }, { lv: {} })), 5000);
  assert.equal(base(scoreFlight({ ...f, landed: false }, { lv: {} })), 5000);
  assert.equal(base(scoreFlight({ ...f, landed: false }, { lv: { parachute: 1 } })), 5000 + 2750);
  assert.equal(base(scoreFlight({ ...f, landed: false, crashed: true }, { lv: { parachute: 3 } })), 5000);
  assert.equal(landingShare({ landed: false }, { lv: { parachute: 2 } }), 0.6);
});

test('0.12 coin mods: altitude and distance milestones on a landing, top speed, tricks, each capped', () => {
  const f = { dist: 3000, maxY: 300, maxV: 650 / 3.6, landed: true, loops: 2, passes: 1, thermals: 3, touchgos: 0 };
  assert.equal(flightCoins({}, f), 0);
  assert.equal(flightCoins({ skywriter: 1 }, f), 2);                    // 100 and 250 m
  assert.equal(flightCoins({ mileage: 1 }, f), 3);                      // 500, 1250, 2500 m
  assert.equal(flightCoins({ mileage: 1 }, { ...f, landed: false }), 0);
  assert.equal(flightCoins({ bounty: 1 }, f), 3);                       // 650 km/h: 4 full hundreds over 200, capped at 3
  assert.equal(flightCoins({ bounty: 2 }, f), 4);
  assert.equal(flightCoins({ tipjar: 1 }, f), 3);                       // 6 tricks, capped at 3
  assert.equal(flightCoins({ tipjar: 3 }, f), 6);
  const run = newRun(0, {}); run.mods = ['tipjar']; run.modLv = { tipjar: 3 };
  const before = run.coins, out = settleFlight(run, {}, { ...f, coins: 0, crashed: false, fuelFrac: 0, t: 30 });
  assert.equal(out.pay, 3 + 6); assert.ok(run.coins >= before + 9);
});

test('Understudy multiplies per empty slot; a removed mod (Bullseye) is taken out of a saved run and refunded', () => {
  const lab = ctx => Object.fromEntries(scoreFlight({ dist: 100, maxY: 0, landed: true, loops: 0, passes: 0, thermals: 0, coins: 0 }, ctx).lines.map(l => [l.label, l.v]));
  assert.equal(lab({ lv: { understudy: 1 }, empty: 4 }).Understudy, 2.07);
  assert.equal(lab({ lv: { understudy: 3 }, empty: 4 }).Understudy, 3.84);
  assert.equal(lab({ lv: { understudy: 1 }, empty: 0 }).Understudy, undefined);
  const run = newRun(0, {}); run.mods = ['bullseye', 'stunt']; run.modLv = { bullseye: 2, stunt: 1 }; run.coins = 10;
  run.shop = { parts: [], tunes: [], mods: [{ id: 'bullseye' }, { id: 'stunt' }] }; run.boonOffer = [{ id: 'upgrade', mod: 'bullseye' }, { id: 'coins' }];
  const refund = dropRemovedMods(run);
  assert.deepEqual(run.mods, ['stunt']); assert.equal(run.modLv.bullseye, undefined); assert.ok(refund > 2); assert.equal(run.coins, 10 + refund);
  assert.deepEqual(run.shop.mods.map(o => o.id), ['stunt']); assert.deepEqual(run.boonOffer.map(o => o.id), ['coins']);
  assert.equal(dropRemovedMods(run), 0);
});
