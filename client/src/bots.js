// Bots for live rooms: filler pilots for Elimination. Pure (no DOM) and deterministic from (room seed, round, bot number),
// so every phone in the room simulates the same bot flight and sees the same plane; the first phone to finish a bot's
// flight reports its score to the room.
import { COCKPIT, stats, weatherFx, makeCraft, craftCounts } from './sim.js';

const NAMES = ['Baron', 'Ace', 'Biscuit', 'Wobbles', 'Duchess', 'Rivets', 'Pip', 'Marigold', 'Captain Hay', 'Sprocket'];
const T = { c: 'cockpit', f: 'frame', p: 'prop', w: 'wing', t: 'tank', r: 'rocket', b: 'balloon' };
const cellsOf = (code) => code.split(' ').map((x) => ({ type: T[x[0]], c: +x[1], r: +x[2] }));
// builds get bigger every round, like a player's would
const BUILDS = ['c22 f32 p42 w31', 'c22 f32 p42 w21 w31 t33', 'c22 f32 t12 p42 w11 w21 w31 t33', 'c22 f32 t12 p42 w11 w21 w31 t33 t23',
  'c22 f32 t12 p42 w11 w21 w31 t33 t23 t13', 'c22 f32 t12 p42 w11 w21 w31 t33 t23 t13 f02 w01'];

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const botName = (i) => NAMES[i % NAMES.length];

// the craft, stats and pilot of bot i in a given round; skill 0..1 picks tunings and how well it climbs
function botFlight(seed, round, i, flightTime) {
  const r = rng(seed * 31 + round * 1009 + i * 97), skill = r();
  const tier = Math.min(BUILDS.length - 1, Math.floor(round * 0.9 + skill * 1.6));
  const tl = Math.floor(round * (0.5 + skill * 0.8));
  const tune = { prop: Math.ceil(tl / 2), wing: Math.floor(tl / 3), fuel: Math.floor(tl / 3), light: Math.floor(tl / 4) };
  const st = stats(tune, {}, weatherFx(null, 0)); st.flightTime = flightTime || 120;
  const cells = cellsOf(BUILDS[tier]);
  const K = makeCraft(cells, st);
  // climbs at a skill-dependent angle under power, then glides hands-off
  const lo = 18 + skill * 14, hi = lo + 10, thr = 0.7 + 0.3 * r();
  let next = 0, cmd = 0;
  const ctl = (S) => {
    if (S.t >= next) {
      next = S.t + 0.2; const g = Math.atan2(S.vy, S.vx) * 180 / Math.PI, v = Math.hypot(S.vx, S.vy); cmd = 0;
      if (S.t < 0.6) cmd = 1;
      else if (S.fuel > 0 && v > 30) { if (g < lo && S.w < 0.4) cmd = 1; else if (g > hi && S.w > -0.4) cmd = -1; }
    }
    return { pitch: cmd, throttle: thr, boost: false };
  };
  return { cells, st, K, ctl, ctx: { lv: {}, boons: {}, flightIdx: 0, cleared: round, coins: 0, ...craftCounts(cells) } };
}

export { botFlight, botName, cellsOf };
