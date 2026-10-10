// Headless checks of the simulation core. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newRun, stats, weatherFx, makeCraft, newFlight, step, popBalloons, summaryOf, scoreFlight, settleFlight,
  quotaFor, openPack, PACKS, FIRST_PACKS, rollTunes, thermalSeg, G0, repeats, rerollShop, applyPurchase, offerPrice, rollMods,
  isStorm, grantPacks, flightStats, MODMAX, pickBoon, rollBoons, modSlots,
} from '../client/src/sim.js';

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
  assert.equal(stats({}, [], weatherFx(null, 0)).flightTime, 300);
  assert.equal(stats({ time: 2 }, [], weatherFx(null, 0)).flightTime, 420);
  assert.equal(stats({ time: 9 }, [], weatherFx(null, 0)).flightTime, 480);
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
  assert.equal(run.packs.length, FIRST_PACKS + PACKS, 'unopened packs carry over, the next contract adds two');
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
  const r6 = newRun(6, meta); r6.packs = []; r6.stage = 1; grantPacks(r6); assert.equal(r6.packs.length, 1);
  const r5 = newRun(5, meta); r5.packs = []; r5.stage = 1; grantPacks(r5); assert.equal(r5.packs.length, PACKS);
  assert.equal(flightStats(newRun(9, meta)).flightTime, 300);
  assert.equal(flightStats(newRun(10, meta)).flightTime, 240);
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
