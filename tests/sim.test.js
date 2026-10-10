// Headless checks of the simulation core. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newRun, stats, weatherFx, makeCraft, newFlight, step, popBalloons, summaryOf, scoreFlight, settleFlight,
  quotaFor, CONTRACTS,
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

test('every new run offers an engine in the opening shop', () => {
  for (let i = 0; i < 500; i++) {
    const run = newRun(0, { bestStage: 0 });
    assert.ok(run.shop.parts.some((o) => o.t === 'prop' || o.t === 'rocket'));
    assert.deepEqual(run.cells, [{ c: 2, r: 2, type: 'cockpit' }]);
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
});
