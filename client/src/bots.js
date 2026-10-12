// Bots for live rooms: filler pilots for Elimination. Pure (no DOM) and deterministic from (room seed, round, bot number),
// so every phone in the room simulates the same bot flight and sees the same plane; the first phone to finish a bot's
// flight reports its score to the room.
// Each bot has a style (propeller glider, rocket climber, balloon glider) and a skill, both fixed for the whole game.
// Builds grow every round; before each flight the bot test-flies a few pilot settings (pilot.js) and keeps the best,
// more of them the better it is. planBot() does that work, so callers can spread it over frames.
import { stats, weatherFx, makeCraft, craftCounts } from './sim.js';
import { tunePilot, makePilot } from './pilot.js';

const NAMES = ['Baron', 'Ace', 'Biscuit', 'Wobbles', 'Duchess', 'Rivets', 'Pip', 'Marigold', 'Captain Hay', 'Sprocket'];
const T = { c: 'cockpit', f: 'frame', p: 'prop', w: 'wing', t: 'tank', r: 'rocket', b: 'balloon' };
// 'w21' -> a wing at (2,1); an upper-case letter is the rare variant ('W21')
const cellsOf = (code) => code.split(' ').map((x) => { const l = x[0], rare = l !== l.toLowerCase(); const c = { type: T[l.toLowerCase()], c: +x[1], r: +x[2] }; if (rare) c.rare = 1; return c; });
// builds per style, one per round tier, getting bigger like a player's would
const BUILDS = {
  glider: ['c22 f32 p42 w31', 'c22 f32 p42 w21 w31 t33', 'c22 f32 t12 p42 w11 w21 w31 t33', 'c22 f32 t12 p42 w11 w21 w31 t33 t23',
    'c22 f32 t12 p42 w11 w21 w31 t33 t23 t13', 'c22 f32 t12 p42 w11 w21 w31 t33 t23 t13 f02 w01'],
  // a propeller glider with a rocket booster behind the cockpit
  booster: ['c22 f32 p42 r12 w31', 'c22 f32 p42 r12 w21 w31 t33', 'c22 f32 p42 r12 w21 w31 t33 t23', 'c22 f32 t42 p52 r12 w21 w31 w41 t33 t23',
    'c22 f32 t42 p52 r12 w21 w31 w41 t33 t23 t43', 'c22 f32 t42 p52 r12 w21 w31 w41 t33 t23 t43 t13'],
  // balloons lift it, a propeller pushes, it pops and glides in to land
  balloon: ['c22 f32 p42 b21 b31', 'c22 f32 p42 b21 b31 w12 t23', 'c22 f32 f12 p42 b11 b21 b31 w02 t23', 'c22 f32 f12 f42 p52 b11 b21 b31 b41 w02 t23',
    'c22 f32 f12 f42 p52 b11 b21 b31 b41 w02 t23 t33', 'c22 f32 f12 f42 p52 b11 b21 b31 b41 w02 t23 t33 W43'],
};
const STYLES = Object.keys(BUILDS);

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const botName = (i) => NAMES[i % NAMES.length];
// the bot's lasting traits: style and skill (0..1), the same in every round of a game
function botTraits(seed, i) { const r = rng(seed * 7 + i * 131 + 3); return { style: STYLES[Math.floor(r() * STYLES.length)], skill: r() }; }

// the craft and stats of bot i in a given round, before its pilot is planned (see planBot)
function botFlight(seed, round, i, flightTime) {
  const { style, skill } = botTraits(seed, i), r = rng(seed * 31 + round * 1009 + i * 97);
  const tier = Math.min(5, Math.floor(round + 0.6 + skill * 1.6));
  const tl = Math.floor(round * (0.5 + skill * 0.8));
  const tune = style === 'glider' ? { prop: Math.ceil(tl / 2), wing: Math.floor(tl / 3), fuel: Math.floor(tl / 3), light: Math.floor(tl / 4) }
    : style === 'booster' ? { prop: Math.ceil(tl / 3), rocket: Math.ceil(tl / 3), fuel: Math.floor(tl / 3), wing: Math.floor(tl / 4) }
    : { prop: Math.ceil(tl / 3), balloon: Math.floor(tl / 3), wing: Math.floor(tl / 3), fuel: Math.floor(tl / 4) };
  const st = stats(tune, {}, weatherFx(null, 0)); st.flightTime = flightTime || 120;
  const cells = cellsOf(BUILDS[style][tier]);
  return { style, skill, cells, st, K: makeCraft(cells, st), rnd: r, tries: 4 + Math.round(skill * 10), maxPop: round < 2 ? 120 : round < 3 ? 260 : round < 5 ? 520 : 800,
    ctx: { lv: {}, boons: {}, flightIdx: 0, cleared: round, coins: 0, ...craftCounts(cells) } };
}
// test-fly the bot's candidate pilots and keep the best: sets b.P (settings) and b.ctl (the controller)
function planBot(b) { b.P = tunePilot(b.K, b.st, b.ctx, b.tries, b.rnd, b.maxPop).P; b.ctl = makePilot(b.P); return b; }

export { botFlight, planBot, botName, botTraits, cellsOf, BUILDS };
