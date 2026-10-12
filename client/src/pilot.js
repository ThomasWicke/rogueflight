// A bot pilot: a few settings that decide how it flies, and a tuner that test-flies candidate settings in the sim and
// keeps the best. Pure (no DOM): the balance bot (tools/bot.js) and the Elimination bots (bots.js) both use it.
// The pilot presses the same buttons a player has: pitch -1/0/+1, re-decided every 0.2 s, plus one throttle.
import { newFlight, step, popBalloons, summaryOf, scoreFlight, SIM_DT } from './sim.js';

// settings: thr throttle 0..1; climb degrees held under power; level height (m) at which it levels off and cruises
// (aimed just past an altitude milestone, Infinity = keep climbing); flare: pull up before touching down so it lands
// instead of crashing; loops: how many loops to fly once it has speed and height; pop: balloon pop height (m)
const DEFAULT = { thr: 1, climb: 35, level: Infinity, flare: true, loops: 0, pop: Infinity };

function makePilot(P) {
  P = { ...DEFAULT, ...P };
  let next = 0, cmd = 0, looping = false, loops0 = 0;
  return (S) => {
    if (S.t >= next) {
      next = S.t + 0.2;
      const g = Math.atan2(S.vy, S.vx) * 180 / Math.PI, v = Math.hypot(S.vx, S.vy), powered = S.fuel > 0;
      cmd = 0;
      if (P.pop < Infinity && !S.burst && S.y >= P.pop) S.burst = true;
      if (looping) { cmd = 1; if (S.loops > loops0 || S.y < 25) looping = false; }
      else if (S.t < 0.6) cmd = 1;
      else if (S.loops < P.loops && v > 32 && S.y > 45 && g > -10) { looping = true; loops0 = S.loops; cmd = 1; }
      else if (powered && v > 20) {
        const tgt = S.y < P.level ? P.climb : 4;
        if (g < tgt - 5 && S.w < 0.4) cmd = 1; else if (g > tgt + 5 && S.w > -0.4) cmd = -1;
      } else if (P.flare && S.y < 9 && S.vy < -4) cmd = 1;
    }
    return { pitch: cmd, throttle: P.thr };
  };
}

// fly one flight with settings P; returns the flight state, the final craft and its score
function flyWith(K, st, P, ctx) {
  const S = newFlight(K, st), ctl = makePilot(P);
  while (!S.done) { step(S, K, st, SIM_DT, ctl(S)); if (S.burst && !S.popped) K = popBalloons(S, K, st); }
  const f = summaryOf(S, K);
  return { S, f, score: scoreFlight(f, ctx).total };
}

// candidate settings around sensible defaults; rnd() (0..1) makes each bot try a different, repeatable set
function candidates(n, rnd, K, maxPop = Infinity) {
  const out = [{ ...DEFAULT }];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 1; i < n; i++) out.push({
    thr: pick([1, 1, 0.8, 0.6]), climb: pick([15, 25, 30, 35, 40, 50]), level: pick([Infinity, Infinity, 110, 270, 520]),
    flare: rnd() < 0.85, loops: pick([0, 0, 0, 1, 2]), pop: K.counts.balloon ? pick(maxPop >= 800 ? [Infinity, 260, 520, 800] : [Infinity, 120, 260].filter((h) => h <= maxPop || h === Infinity)) : Infinity,
  });
  return out;
}
// test-fly n candidates and keep the best (n = 1 just flies the defaults)
// maxPop caps the balloon pop height it may try (Elimination bots climb with their rounds, not all at once)
function tunePilot(K, st, ctx, n, rnd, maxPop) {
  let best = null;
  for (const P of candidates(n, rnd, K, maxPop)) { const r = flyWith(K, st, P, ctx); if (!best || r.score > best.score) best = { P, score: r.score }; }
  return best;
}

export { DEFAULT, makePilot, flyWith, candidates, tunePilot };
