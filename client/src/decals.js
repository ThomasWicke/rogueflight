// Sponsor decals: the icon for every mod, drawn procedurally in "The Flying Circus" style (docs/circus-style.md).
// Each icon is a motif on a rarity material: common = torn paper decal with a curled corner, uncommon = riveted tin
// plate, rare = enamel shield with a brass rim. Lv 2 adds a brass die-cut trim around the decal, Lv 3 also a sparkle.
// drawDecal works on any 2D context; decalURL needs a browser (document). No text or digits inside the art.
import { MODS } from './sim.js';

/* ---------- palette (docs/circus-style.md) ---------- */
const C = {
  ink: '#22283a', paper: '#f3e7ce', paper2: '#e6d4ae', canvas: '#fbf5e8', red: '#d2402f', red2: '#a92f22',
  brass: '#e9a93b', brass2: '#b97d1c', teal: '#3b9aa6', teal2: '#2a7580', wood: '#b7793f', wood2: '#8a5428',
  wood3: '#d9a066', tin: '#b9c3c9', tin2: '#7f8d96', grass: '#7faf55', grass2: '#5e8f43', night: '#0c1a2c', rare: '#7a4fa0',
  rare2: '#5b417c', // enamel shade: rare mixed 35% with ink (the palette has no second purple)
};
const INK = C.ink, TAU = Math.PI * 2, PI = Math.PI, rad = d => d * PI / 180;
const SHADOW = 'rgba(34,40,58,.24)';

// outline weight in CSS px for a decal shown `size` px wide: 2.5 px at full size, thinner when tiny so 24 px icons stay open
const linePx = size => Math.max(1.2, Math.min(2.5, .9 + size * .017));

// deterministic per-id randomness, so every decal keeps its own tilt and torn edge
function rng(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------- path helpers (all add subpaths to the current path) ---------- */
const P = (g, pts, close = true) => { g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); if (close) g.closePath(); };
const O = (g, x, y, r) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); };
const E = (g, x, y, rx, ry, a = 0) => { g.moveTo(x + rx * Math.cos(a), y + rx * Math.sin(a)); g.ellipse(x, y, rx, ry, a, 0, TAU); };
const RR = (g, x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
// smooth curve through points (Catmull-Rom as cubic Béziers)
function curve(g, p, closed = true) {
  const n = p.length / 2, at = i => { i = closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)); return [p[2 * i], p[2 * i + 1]]; };
  g.moveTo(p[0], p[1]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [x0, y0] = at(i - 1), [x1, y1] = at(i), [x2, y2] = at(i + 1), [x3, y3] = at(i + 2);
    g.bezierCurveTo(x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6, x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6, x2, y2);
  }
  if (closed) g.closePath();
}
function star(g, x, y, n, r, ri, a0 = -PI / 2) {
  for (let i = 0; i < 2 * n; i++) { const a = a0 + i * PI / n, q = i % 2 ? ri : r; i ? g.lineTo(x + q * Math.cos(a), y + q * Math.sin(a)) : g.moveTo(x + q * Math.cos(a), y + q * Math.sin(a)); }
  g.closePath();
}
// four-point shine with concave sides
function sparkle(g, x, y, r, t = .2) {
  const q = r * t;
  g.moveTo(x, y - r); g.quadraticCurveTo(x + q, y - q, x + r, y); g.quadraticCurveTo(x + q, y + q, x, y + r);
  g.quadraticCurveTo(x - q, y + q, x - r, y); g.quadraticCurveTo(x - q, y - q, x, y - r); g.closePath();
}
// fuel drop, round bottom centred on (x, y), tip up
function drop(g, x, y, r) {
  g.moveTo(x, y - 2.1 * r);
  g.bezierCurveTo(x + .3 * r, y - 1.35 * r, x + r, y - .8 * r, x + r, y);
  g.arc(x, y, r, 0, PI);
  g.bezierCurveTo(x - r, y - .8 * r, x - .3 * r, y - 1.35 * r, x, y - 2.1 * r);
  g.closePath();
}

/* ---------- drawing primitives: flat fill, one shade band lower right, ink outline ---------- */
// a vector given in decal space (where "lower right" means lower right on screen) expressed in the current local space
function lvec(g, D, vx, vy) {
  const B = D.base, M = g.getTransform(), wx = B.a * vx + B.c * vy, wy = B.b * vx + B.d * vy, det = M.a * M.d - M.b * M.c;
  return [(M.d * wx - M.c * wy) / det, (-M.b * wx + M.a * wy) / det];
}
function shadeBand(g, D, f, fill, k) {
  const [dx, dy] = lvec(g, D, -k, -k);
  g.save(); g.beginPath(); f(g); g.clip(); g.translate(dx, dy); g.beginPath(); f(g); g.fillStyle = fill; g.fill(); g.restore();
}
// filled shape: shade color first, then the base color shifted up-left (leaving a band lower right), then the outline
function solid(g, D, f, fill, shade, k = D.k) {
  g.beginPath(); f(g); g.fillStyle = shade || fill; g.fill();
  if (shade) shadeBand(g, D, f, fill, k);
  g.beginPath(); f(g); g.lineWidth = D.L; g.strokeStyle = INK; g.stroke();
}
// like solid, but outlines only the union of overlapping subpaths (clouds, plane silhouettes)
function blob(g, D, f, fill, shade, k = D.k) {
  g.beginPath(); f(g); g.lineWidth = 2 * D.L; g.strokeStyle = INK; g.stroke();
  g.fillStyle = shade || fill; g.fill();
  if (shade) shadeBand(g, D, f, fill, k);
}
const fillP = (g, f, col) => { g.beginPath(); f(g); g.fillStyle = col; g.fill(); };
const ln = (g, D, f, w = .6, col = INK) => { g.beginPath(); f(g); g.lineWidth = w * D.L; g.strokeStyle = col; g.stroke(); };
// a stroke with an ink outline on both sides (ropes, ribbons, gust lines)
const tube = (g, D, f, w, col, cap = 'round') => {
  w = Math.max(w, .8 * D.L); g.lineCap = cap;
  g.beginPath(); f(g); g.lineWidth = w + 2 * D.L; g.strokeStyle = INK; g.stroke(); g.lineWidth = w; g.strokeStyle = col; g.stroke();
  g.lineCap = 'round';
};
const hi = (g, f, a = .55) => fillP(g, f, `rgba(255,255,255,${a})`);
const hiLn = (g, D, f, w = .75, a = .6) => ln(g, D, f, w, `rgba(255,255,255,${a})`);
// a child drawing state for a scaled sub-drawing, so lines keep their on-screen weight
const sc = (D, s) => ({ ...D, L: D.L / s, k: D.k / s });

function coin(g, D, x, y, r, a = 0) {
  solid(g, D, p => E(p, x + r * .17, y + r * .1, r * .9, r, a), C.brass2);
  solid(g, D, p => E(p, x, y, r * .9, r, a), C.brass, C.brass2, Math.min(D.k, r * .3));
  if (r > 7 && !D.small) ln(g, D, p => E(p, x, y, r * .56, r * .62, a), .6, C.brass2);
  hi(g, p => E(p, x - r * .38, y - r * .42, r * .16, r * .24, a + .5));
}
// top view of a little plane, nose toward -y
function planeTop(g, D, x, y, s, a, col, col2) {
  g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s); const d = sc(D, s);
  blob(g, d, p => { RR(p, -3.4, -16, 6.8, 30, 3.4); RR(p, -17, -6, 34, 8, 3.6); RR(p, -7.5, 9, 15, 5, 2.4); }, col, col2, 2.8 / s + d.L * .5);
  fillP(g, p => E(p, 0, -6.5, 2.1, 3), INK);
  g.restore();
}

const planeTopShape = (p, x, y, s) => { RR(p, x - 3.4 * s, y - 16 * s, 6.8 * s, 30 * s, 3.4 * s); RR(p, x - 17 * s, y - 6 * s, 34 * s, 8 * s, 3.6 * s); };

/* ---------- motifs: one per mod id, drawn in a box of about ±30 units ---------- */
const MOTIF = {
  // Engine
  overclock(g, D) {
    // a two-blade prop in its own blur disc, speed arcs trailing both tips, a red-hot spinner
    const tips = [rad(-32), rad(148)];
    fillP(g, p => O(p, 0, 0, 27), 'rgba(255,255,255,.45)');
    for (const a of tips) {
      ln(g, D, p => p.arc(0, 0, 27.5, a - rad(80), a - rad(12)), 1);
      if (!D.small) ln(g, D, p => p.arc(0, 0, 21.5, a - rad(62), a - rad(24)), .75);
    }
    for (const a of tips) {
      g.save(); g.rotate(a);
      solid(g, D, p => { p.moveTo(5, -3.4); p.bezierCurveTo(11, -4.6, 15, -10, 21, -9.8); p.bezierCurveTo(26.5, -9.6, 28.5, -4.6, 27.2, -.2); p.bezierCurveTo(26, 3.6, 21.5, 4.6, 16.5, 4.2); p.bezierCurveTo(11, 3.8, 8.5, 3.4, 5, 3.4); p.closePath(); }, C.wood, C.wood2, 3);
      if (!D.small) hiLn(g, D, p => { p.moveTo(12, -4.8); p.quadraticCurveTo(17, -7.4, 22.5, -6.4); });
      g.restore();
    }
    if (!D.small) solid(g, D, p => star(p, 0, 0, 9, 13.5, 9.8, rad(12)), C.brass, C.brass2, 2.2);
    solid(g, D, p => O(p, 0, 0, 9.2), C.red, C.red2, 3.2);
    hi(g, p => O(p, -3, -3, 2.6), .65);
  },
  afterburner(g, D) {
    // flame layers with shock rings under a tin bell nozzle
    solid(g, D, p => curve(p, [-13, -9, -18, 3, -13, 15, -8, 24, 0, 40, 8, 24, 13, 15, 18, 3, 13, -9]), C.red, C.red2, 3.4);
    fillP(g, p => curve(p, [-9, -9, -12, 3, -7, 15, 0, 30, 7, 15, 12, 3, 9, -9]), C.brass);
    fillP(g, p => curve(p, [-4.5, -9, -6, 1, 0, 16, 6, 1, 4.5, -9]), C.canvas);
    for (const [y, rx] of D.small ? [[6, 10]] : [[4, 11.5], [16, 7.5]]) ln(g, D, p => p.ellipse(0, y, rx, 2.4, 0, 0, PI), .75, C.red2);
    solid(g, D, p => { p.moveTo(-4.5, -26); p.lineTo(4.5, -26); p.bezierCurveTo(5, -16, 9, -11, 16, -8); p.lineTo(-16, -8); p.bezierCurveTo(-9, -11, -5, -16, -4.5, -26); p.closePath(); }, C.tin, C.tin2, 3);
    if (!D.small) ln(g, D, p => { p.moveTo(-6.4, -16); p.quadraticCurveTo(0, -15, 6.4, -16); }, .6);
    hiLn(g, D, p => { p.moveTo(-3, -22); p.bezierCurveTo(-3.6, -17, -6, -13, -10, -10.5); });
    solid(g, D, p => RR(p, -10.5, -37, 21, 12, 4), C.tin, C.tin2, 2.6);
    if (!D.small) ln(g, D, p => { p.moveTo(-10.5, -31); p.lineTo(10.5, -31); }, .6);
    solid(g, D, p => E(p, 0, -8, 15.5, 3.6), C.night);
  },
  solar(g, D) {
    const cx = -9, cy = 0;
    solid(g, D, p => star(p, cx, cy, 8, 24, 14.5, rad(-90)), C.brass, C.brass2);
    solid(g, D, p => {
      p.moveTo(cx + 4, cy - 9); p.bezierCurveTo(6, -19, 18, -27, 31, -26);
      p.quadraticCurveTo(31, -17, 25, -14); p.quadraticCurveTo(27, -7, 20, -4); p.quadraticCurveTo(20, 4, 12, 5); p.quadraticCurveTo(8, 11, cx + 4, cy + 9);
      p.closePath();
    }, C.canvas, C.paper2);
    if (!D.small) for (const [x, y] of [[25, -14], [20, -4], [12, 5]]) ln(g, D, p => { p.moveTo(x, y); p.lineTo(x - 9, y - 3.5); }, .55);
    solid(g, D, p => O(p, cx, cy, 13), C.brass, C.brass2);
    hi(g, p => E(p, cx - 4.5, cy - 4.5, 3, 4.2, rad(40)));
  },
  // Fuel
  secondwind(g, D) {
    tube(g, D, p => { p.moveTo(-2, -12); p.lineTo(-1, -19.5); p.lineTo(11, -19.5); p.lineTo(11, -12); }, 2.8, C.red2);
    solid(g, D, p => RR(p, 15, -21, 7, 8, 1.6), C.tin, C.tin2, 2.4);
    const can = p => { p.moveTo(-4, -13); p.lineTo(19, -14); p.quadraticCurveTo(24, -14, 24, -9); p.lineTo(25, 22); p.quadraticCurveTo(25, 27, 20, 27); p.lineTo(-3, 27); p.quadraticCurveTo(-8, 27, -8, 22); p.lineTo(-9, -8); p.quadraticCurveTo(-9, -13, -4, -13); p.closePath(); };
    solid(g, D, can, C.red, C.red2);
    if (!D.small) { ln(g, D, p => { p.moveTo(0, -5); p.lineTo(17, 19); p.moveTo(17, -5); p.lineTo(0, 19); }, .7, C.red2); }
    hiLn(g, D, p => { p.moveTo(-4.5, -8); p.lineTo(-4, 12); });
    tube(g, D, p => { p.moveTo(-31, 11); p.bezierCurveTo(-18, 11, -6, 13, -2, 4); p.bezierCurveTo(1, -4, -6, -12, -13, -9); p.bezierCurveTo(-18, -6, -16, 0, -11, -1.5); }, 4, C.canvas);
    tube(g, D, p => { p.moveTo(-29, 20); p.bezierCurveTo(-20, 20, -12, 21, -6, 19); }, 3.4, C.canvas);
  },
  recycler(g, D) {
    solid(g, D, p => drop(p, 0, 5, 9.5), C.brass, C.brass2);
    hi(g, p => E(p, -3.4, 2, 1.8, 3.2, .3));
    tube(g, D, p => { p.moveTo(-20, -27); p.lineTo(-20, 2); p.arc(0, 2, 20, PI, 0, true); p.lineTo(20, -8); }, 5.5, C.teal);
    solid(g, D, p => P(p, [20, -24, 9.5, -9, 30.5, -9]), C.teal, C.teal2, 2.6);
  },
  ramscoop(g, D) {
    // a funnel catching the rushing air and dripping it out as fuel
    for (const f of [
      p => { p.moveTo(31, -22); p.quadraticCurveTo(18, -24, 9, -13); },
      p => { p.moveTo(24, -32); p.quadraticCurveTo(8, -30, 0, -14); },
      p => { p.moveTo(-28, -30); p.quadraticCurveTo(-16, -28, -10, -14); },
    ]) tube(g, D, f, 3, C.canvas);
    solid(g, D, p => { p.moveTo(-22, -12); p.lineTo(-3.5, 11); p.lineTo(-3, 21); p.lineTo(3, 21); p.lineTo(3.5, 11); p.lineTo(22, -12); p.closePath(); }, C.tin, C.tin2, 3.2);
    ln(g, D, p => { p.moveTo(-3.5, 11); p.lineTo(3.5, 11); }, .7);
    hiLn(g, D, p => { p.moveTo(-15, -7); p.lineTo(-6, 4); });
    solid(g, D, p => E(p, 0, -12, 22, 5.6), C.night);
    ln(g, D, p => p.ellipse(0, -12, 18.5, 3.6, 0, PI * 1.05, PI * 1.95), .7, C.tin);
    for (const [x0, x1] of [[9, 7], [0, 0], [-10, -7]]) tube(g, D, p => { p.moveTo(x0, -13.5); p.lineTo(x1, -11); }, 3, C.canvas);
    solid(g, D, p => drop(p, 0, 33, 4.6), C.brass, C.brass2, 2);
  },
  burnoff(g, D) {
    g.save(); g.translate(-5, 3); g.rotate(rad(-50));
    solid(g, D, p => { p.moveTo(-19, 0); p.bezierCurveTo(-12, -10.5, 10, -12, 25, -1); p.bezierCurveTo(13, 7, 4, 9, -1, 8.5); p.lineTo(-5, 4.5); p.lineTo(-9, 8.5); p.bezierCurveTo(-14, 8, -18, 4.5, -19, 0); p.closePath(); }, C.canvas, C.paper2);
    ln(g, D, p => { p.moveTo(-27, 1.5); p.quadraticCurveTo(0, 1, 22, -1); }, .85);
    if (!D.small) ln(g, D, p => { p.moveTo(6, -1); p.lineTo(11, -6); p.moveTo(-6, 0); p.lineTo(-1, -6); }, .55);
    g.restore();
    solid(g, D, p => drop(p, 19, 18, 6.5), C.brass, C.brass2, 3);
    ln(g, D, p => { p.moveTo(14.5, -2); p.lineTo(14.5, 3.5); p.moveTo(23.5, 0); p.lineTo(23.5, 5); }, .75);
  },
  // Body
  slipstream(g, D) {
    for (const f of [
      p => { p.moveTo(27, -15); p.bezierCurveTo(14, -25, -8, -22, -30, -10); },
      p => { p.moveTo(27, 17); p.bezierCurveTo(14, 26, -8, 23, -30, 11); },
      p => { p.moveTo(-21, 1); p.lineTo(-31, 1); },
    ]) tube(g, D, f, 2.6, C.canvas);
    solid(g, D, p => { p.moveTo(-24, 1); p.bezierCurveTo(-12, -8, 0, -13, 10, -12); p.bezierCurveTo(20, -11, 25, -5, 25, 1); p.bezierCurveTo(25, 8, 19, 13, 9, 13); p.bezierCurveTo(-1, 13, -13, 9, -24, 1); p.closePath(); }, C.teal, C.teal2);
    hi(g, p => E(p, 13, -6, 5, 2.4, rad(-12)));
  },
  antigrav(g, D) {
    tube(g, D, p => P(p, [-13, 31, 0, 22, 13, 31], false), 4.4, C.brass);
    tube(g, D, p => P(p, [-13, 19, 0, 10, 13, 19], false), 4.4, C.brass);
    tube(g, D, p => O(p, 0, -21, 5.2), 2.8, C.tin2);
    solid(g, D, p => { p.moveTo(-11, -16); p.lineTo(11, -16); p.quadraticCurveTo(13, -16, 13.6, -14); p.lineTo(18, 1); p.quadraticCurveTo(18.6, 4, 15.5, 4); p.lineTo(-15.5, 4); p.quadraticCurveTo(-18.6, 4, -18, 1); p.lineTo(-13.6, -14); p.quadraticCurveTo(-13, -16, -11, -16); p.closePath(); }, C.tin, C.tin2);
    hiLn(g, D, p => { p.moveTo(-10, -12); p.lineTo(-13, -1); });
  },
  // Control
  gyro(g, D) {
    const cy = -3, a = rad(-22);
    solid(g, D, p => { p.moveTo(-13, 28); p.lineTo(13, 28); p.lineTo(7, 20); p.lineTo(-7, 20); p.closePath(); }, C.wood, C.wood2, 2.6);
    tube(g, D, p => { p.moveTo(0, -27); p.lineTo(0, 21); }, 2.2, C.tin2);
    tube(g, D, p => O(p, 0, cy, 19.5), 4, C.brass);
    tube(g, D, p => E(p, 0, cy, 19.5, 6.5, a), 3.4, C.teal);
    solid(g, D, p => E(p, 0, cy, 10.5, 4.2, a), C.red, C.red2, 2.4);
    solid(g, D, p => O(p, 0, -28.5, 3.3), C.tin, C.tin2, 1.8);
  },
  bounce(g, D) {
    // dashed path down to the ground, a bounce, and the rubber ball flying up again
    g.save(); g.setLineDash([D.L * 1.3, D.L * 1.8]);
    ln(g, D, p => { p.moveTo(-30, -26); p.quadraticCurveTo(-21, -4, -15, 19); p.quadraticCurveTo(-11, 5, -6, -2); }, .9);
    g.restore();
    fillP(g, p => E(p, 8, 20.5, 10, 2.2), 'rgba(34,40,58,.3)');
    ln(g, D, p => { p.moveTo(-29, 21); p.lineTo(29, 21); }, 1);
    ln(g, D, p => { p.moveTo(-21, 16); p.lineTo(-25, 11.5); p.moveTo(-9, 16); p.lineTo(-5, 11.5); }, .8);
    const ball = p => O(p, 8, -8, 16.5);
    solid(g, D, ball, C.red, C.red2, 3.6);
    g.save(); g.beginPath(); ball(g); g.clip();
    fillP(g, p => { p.moveTo(4, -24); p.bezierCurveTo(13, -18, 15, 2, 6, 8); p.lineTo(12, 8); p.bezierCurveTo(21, 2, 19, -18, 10, -24); p.closePath(); }, C.canvas);
    g.restore();
    g.beginPath(); ball(g); g.lineWidth = D.L; g.strokeStyle = INK; g.stroke();
    hi(g, p => E(p, 0, -15, 3.6, 2.4, rad(-40)), .7);
  },
  // Launch
  sling(g, D) {
    g.save(); g.rotate(rad(-7));
    tube(g, D, p => { p.moveTo(-13.5, -21); p.lineTo(0, -4); p.lineTo(13.5, -21); }, 2.2, C.red);
    tube(g, D, p => { p.moveTo(0, 30); p.lineTo(0, 6); p.lineTo(-14, -21); p.moveTo(0, 6); p.lineTo(14, -21); }, 7, C.wood);
    if (!D.small) ln(g, D, p => { p.moveTo(-1.5, 26); p.lineTo(-1.5, 12); }, .6, C.wood3);
    solid(g, D, p => E(p, 0, -3.5, 6.5, 5), C.red2, null);
    solid(g, D, p => O(p, 0, -6.5, 5), C.tin, C.tin2, 2.2);
    g.restore();
  },
  // Air
  thermal(g, D) {
    // wavy warm air rising, a bird circling on top of it
    for (const [x, col, top, ph] of [[-14, C.brass, 3, 0], [0, C.red, -5, 2.2], [14, C.brass, 3, 4.4]]) {
      tube(g, D, p => { p.moveTo(x + 3.2 * Math.sin(ph), 30); for (let y = 30; y >= top; y -= 1) p.lineTo(x + 3.2 * Math.sin((30 - y) / 14 * TAU + ph), y); }, 3, col);
    }
    solid(g, D, p => { p.moveTo(-17, -15); p.quadraticCurveTo(-8, -29, 0, -19); p.quadraticCurveTo(8, -29, 17, -15); p.quadraticCurveTo(8, -21.5, 0, -13.5); p.quadraticCurveTo(-8, -21.5, -17, -15); p.closePath(); }, C.canvas, null);
  },
  envelope(g, D) {
    const bal = (p, f = 1) => { p.moveTo(0, 13); p.bezierCurveTo(-26 * f, -1, -22 * f, -29, 0, -29); p.bezierCurveTo(22 * f, -29, 26 * f, -1, 0, 13); p.closePath(); };
    ln(g, D, p => { p.moveTo(-8, 8); p.lineTo(-5, 20); p.moveTo(8, 8); p.lineTo(5, 20); p.moveTo(0, 13); p.lineTo(0, 20); }, .65);
    solid(g, D, p => RR(p, -7, 19, 14, 9, 2.2), C.wood, C.wood2, 2.4);
    solid(g, D, bal, C.red, C.red2);
    g.save(); g.beginPath(); bal(g); g.clip();
    g.beginPath(); bal(g, .62); bal(g, .3); g.fillStyle = C.canvas; g.fill('evenodd');
    const s = D.small ? 11 : 7.5;
    g.lineWidth = .5 * D.L; g.strokeStyle = 'rgba(34,40,58,.75)'; g.beginPath();
    for (let i = -60; i <= 60; i += s) { g.moveTo(i - 30, -32); g.lineTo(i + 30, 28); g.moveTo(i + 30, -32); g.lineTo(i - 30, 28); }
    g.stroke(); g.restore();
    g.beginPath(); bal(g); g.lineWidth = D.L; g.strokeStyle = INK; g.stroke();
    hi(g, p => E(p, -10, -18, 2.4, 4.4, rad(30)));
  },
  // Score
  odometer(g, D) {
    tube(g, D, p => { p.moveTo(24, 0); p.lineTo(29, 0); p.lineTo(29, 9); }, 2.4, C.tin2);
    solid(g, D, p => O(p, 29, 10.5, 3.2), C.red, null);
    solid(g, D, p => RR(p, -28, -13, 52, 27, 5), C.tin, C.tin2);
    for (let i = 0; i < 3; i++) {
      const x = -22.5 + i * 14.5, last = i === 2;
      solid(g, D, p => RR(p, x, -8, 11.5, 17, 2), last ? C.brass : C.canvas, last ? C.brass2 : C.paper2, 2.2);
      const off = last ? 3 : 0;
      if (!D.small) for (const y of [-4 + off, 4 + off]) if (y < 8) ln(g, D, p => { p.moveTo(x + 3, y); p.lineTo(x + 8.5, y); }, .55);
      ln(g, D, p => { p.moveTo(x + 2.5, .5 + off); p.lineTo(x + 9, .5 + off); }, .9);
    }
    hiLn(g, D, p => { p.moveTo(-24, -9.5); p.lineTo(-3, -9.5); });
  },
  wingman(g, D) {
    planeTop(g, D, 9, -7, 1, rad(40), C.red, C.red2);
    planeTop(g, D, -12, 12, .78, rad(40), C.teal, C.teal2);
    if (!D.small) ln(g, D, p => { p.moveTo(-20, -6); p.lineTo(-27, 1); p.moveTo(-3, 26); p.lineTo(-9, 32); }, .7);
  },
  hauler(g, D) {
    const barrel = (x, y) => {
      solid(g, D, p => { p.moveTo(x - 9, y); p.lineTo(x + 9, y); p.quadraticCurveTo(x + 12, y + 11, x + 9, y + 22); p.lineTo(x - 9, y + 22); p.quadraticCurveTo(x - 12, y + 11, x - 9, y); p.closePath(); }, C.teal, C.teal2, 3);
      for (const t of [6.5, 15.5]) ln(g, D, p => { p.moveTo(x - 10.6, y + t); p.quadraticCurveTo(x, y + t + 1.6, x + 10.6, y + t); }, .7);
      hiLn(g, D, p => { p.moveTo(x - 5.5, y + 3); p.lineTo(x - 5.5, y + 5); p.moveTo(x - 6, y + 9.5); p.lineTo(x - 6, y + 12.5); });
    };
    barrel(-11, 6); barrel(11.5, 6); barrel(0, -17);
  },
  altimeter(g, D) {
    solid(g, D, p => RR(p, -28, 13, 9, 9, 2), C.brass, C.brass2, 2);
    solid(g, D, p => O(p, 0, 0, 25), C.brass, C.brass2);
    hiLn(g, D, p => p.arc(0, 0, 22, rad(195), rad(250)));
    solid(g, D, p => O(p, 0, 0, 19), C.canvas, C.paper2, 2.6);
    const n = D.small ? 4 : 10;
    for (let i = 0; i < n; i++) { const a = i * TAU / n - PI / 2; ln(g, D, p => { p.moveTo(14.8 * Math.cos(a), 14.8 * Math.sin(a)); p.lineTo(18 * Math.cos(a), 18 * Math.sin(a)); }, .6); }
    fillP(g, p => P(p, [-7, 13, -1, 6, 2, 9, 4, 7.5, 8, 13]), C.teal);
    ln(g, D, p => { p.moveTo(-8.5, 13); p.lineTo(9.5, 13); }, .55);
    const a = rad(-58);
    tube(g, D, p => { p.moveTo(0, 0); p.lineTo(9 * Math.cos(rad(195)), 9 * Math.sin(rad(195))); }, 2.6, C.night, 'round');
    solid(g, D, p => { const c = Math.cos(a), s = Math.sin(a); P(p, [-2 * s, 2 * c, 16 * c, 16 * s, 2 * s, -2 * c]); }, C.night, null);
    solid(g, D, p => O(p, 0, 0, 3.4), C.red, null);
  },
  speedtrap(g, D) {
    tube(g, D, p => { p.moveTo(-2, 10); p.lineTo(-16, 30); p.moveTo(2, 10); p.lineTo(15, 30); p.moveTo(0, 10); p.lineTo(0.5, 30); }, 2.4, C.wood);
    tube(g, D, p => { p.moveTo(-14, -9); p.lineTo(-14, -16); }, 2, C.tin2);
    solid(g, D, p => star(p, -14, -20.5, 8, 10, 5.2, rad(10)), C.brass, C.brass2, 2);
    solid(g, D, p => RR(p, -20, -9, 36, 22, 3.5), C.wood, C.wood2);
    if (!D.small) ln(g, D, p => { p.moveTo(-16, -2); p.lineTo(-10, -2); p.moveTo(9, 7); p.lineTo(13, 7); }, .55, C.wood2);
    solid(g, D, p => O(p, 4, 2, 10), C.tin, C.tin2, 2.6);
    solid(g, D, p => O(p, 4, 2, 5.8), C.teal, C.teal2, 2);
    hi(g, p => O(p, 2, 0, 1.8), .7);
  },
  duster(g, D) {
    for (const x of D.small ? [-18, 0, 18] : [-22, -11, 0, 11, 22]) {
      ln(g, D, p => { p.moveTo(x, 31); p.quadraticCurveTo(x + 1, 24, x + 2, 17); }, .7, C.grass2);
      solid(g, D, p => E(p, x + 2.4, 13.5, 2.8, 5.6, rad(12)), C.brass, null);
    }
    for (const [x, y, r] of D.small ? [[-22, 5, 4.6]] : [[-27, 3, 3.6], [-20, 6.5, 4.4], [-12, 9, 3.4]]) solid(g, D, p => O(p, x, y, r), C.canvas, null);
    g.save(); g.translate(1, -10); g.rotate(rad(-4));
    solid(g, D, p => P(p, [-23, -1, -27, -12, -20.5, -12, -15, -3]), C.red, C.red2, 2);
    solid(g, D, p => RR(p, -6, 3, 17, 4, 2), C.canvas, null);
    ln(g, D, p => { p.moveTo(-2, -9); p.lineTo(-2, -2); p.moveTo(8, -9); p.lineTo(8, -2); p.moveTo(6, 6); p.lineTo(5, 11); }, .65);
    solid(g, D, p => { p.moveTo(17, -5); p.lineTo(17, 5); p.quadraticCurveTo(0, 7, -24, 1); p.lineTo(-24, -2); p.quadraticCurveTo(-4, -7, 17, -5); p.closePath(); }, C.red, C.red2, 2.4);
    solid(g, D, p => O(p, 5, 11.5, 3), C.night, null);
    solid(g, D, p => RR(p, -8, -13, 20, 4.5, 2), C.canvas, C.paper2, 1.6);
    solid(g, D, p => E(p, 20, 0, 1.6, 9.5), C.tin, null);
    g.restore();
  },
  stunt(g, D) {
    tube(g, D, p => { p.moveTo(-30, 23); p.bezierCurveTo(-8, 23, 15, 16, 15, -4); p.bezierCurveTo(15, -21, -11, -24, -12, -7); }, 5, C.red);
    tube(g, D, p => { p.moveTo(-12, -7.5); p.bezierCurveTo(-13, 8, 4, 16, 22, 12); }, 5, C.red);
    solid(g, D, p => P(p, [30, 10, 19, 4, 21, 18.5]), C.red, C.red2, 2.2);
    if (!D.small) hiLn(g, D, p => { p.moveTo(12, -6); p.bezierCurveTo(12, -16, 0, -19, -6, -15); });
  },
  collector(g, D) {
    coin(g, D, 5, 4, 20, rad(8));
    if (!D.small) solid(g, D, p => star(p, 5, 4, 5, 7.5, 3.4, rad(-90)), C.brass2, null);
    solid(g, D, p => sparkle(p, -19, -19, 9.5), C.canvas, null);
    solid(g, D, p => sparkle(p, -26, -4, 4.5), C.canvas, null);
  },
  opening(g, D) {
    g.scale(.9, .9); D = sc(D, .9);
    if (!D.small) for (const [x, y] of [[-7, 26], [7, 26]]) fillP(g, p => E(p, x, y, 3, 1.2), 'rgba(34,40,58,.25)');
    solid(g, D, p => star(p, 0, 15, 5, 7.5, 3.4), C.brass, C.brass2, 2);
    const drape = s => p => { p.moveTo(-28 * s, -20); p.lineTo(-4 * s, -20); p.bezierCurveTo(-5 * s, -6, -12 * s, 3, -17 * s, 6); p.bezierCurveTo(-13 * s, 13, -12 * s, 22, -9 * s, 29); p.lineTo(-29 * s, 29); p.closePath(); };
    for (const s of [1, -1]) {
      solid(g, D, drape(s), C.red, C.red2);
      if (!D.small) ln(g, D, p => { p.moveTo(-14 * s, -19); p.quadraticCurveTo(-15 * s, -6, -21 * s, 4); p.moveTo(-21 * s, 10); p.quadraticCurveTo(-21 * s, 20, -19 * s, 28); }, .6, C.red2);
      solid(g, D, p => RR(p, s > 0 ? -21 : 15, 4, 6, 4, 1.5), C.brass, null);
    }
    solid(g, D, p => { p.moveTo(-31, -30); p.lineTo(31, -30); p.lineTo(31, -20); for (let i = 0; i < 5; i++) { const x0 = 31 - i * 12.4; p.quadraticCurveTo(x0 - 6.2, -12, x0 - 12.4, -20); } p.closePath(); }, C.brass, C.brass2, 2.6);
  },
  third(g, D) {
    tube(g, D, p => { p.moveTo(0, 2); p.quadraticCurveTo(2, 17, 11, 29); }, 3.4, C.grass2);
    const leaf = p => { p.moveTo(0, 0); p.bezierCurveTo(-4, -4, -14, -6, -14, -14.5); p.bezierCurveTo(-14, -21.5, -4.5, -22.5, 0, -15.5); p.bezierCurveTo(4.5, -22.5, 14, -21.5, 14, -14.5); p.bezierCurveTo(14, -6, 4, -4, 0, 0); p.closePath(); };
    for (const a of [rad(4), rad(122), rad(238)]) {
      g.save(); g.translate(0, -1); g.rotate(a);
      solid(g, D, leaf, C.grass, C.grass2, 3);
      if (!D.small) ln(g, D, p => { p.moveTo(0, -2); p.lineTo(0, -12); }, .55, C.grass2);
      g.restore();
    }
    hi(g, p => E(p, -6, -16, 2.2, 3.2, rad(-30)));
  },
  frugal(g, D) {
    solid(g, D, p => O(p, 0, -23, 7.5), C.brass, C.brass2, 2.4);
    const jar = p => RR(p, -15.5, -13, 31, 40, 7);
    solid(g, D, jar, C.canvas, C.paper2, 3);
    g.save(); g.beginPath(); jar(g); g.clip();
    const fuel = p => { p.moveTo(-17, 13); p.quadraticCurveTo(-8, 10.5, 0, 13); p.quadraticCurveTo(8, 15.5, 17, 13); p.lineTo(17, 29); p.lineTo(-17, 29); p.closePath(); };
    solid(g, D, fuel, C.brass, C.brass2, 3.4);
    g.restore();
    g.beginPath(); jar(g); g.lineWidth = D.L; g.strokeStyle = INK; g.stroke();
    hiLn(g, D, p => { p.moveTo(-10, -7); p.lineTo(-10, 8); }, 1.1, .9);
    solid(g, D, p => RR(p, -17.5, -19, 35, 8, 2.5), C.tin, C.tin2, 2.4);
    ln(g, D, p => { p.moveTo(-6, -15); p.lineTo(6, -15); }, 1.1);
  },
  minimal(g, D) {
    g.save(); g.rotate(rad(16)); g.translate(0, -2);
    solid(g, D, p => { p.moveTo(-5, -9); p.lineTo(5, -9); p.lineTo(5, 20); p.lineTo(2.5, 23.5); p.lineTo(-2.5, 23.5); p.lineTo(-5, 20); p.closePath(); }, C.tin, C.tin2, 2.4);
    if (!D.small) for (let y = -4; y <= 18; y += 4.4) ln(g, D, p => { p.moveTo(-5, y + 1.6); p.lineTo(5, y - 1.6); }, .55);
    solid(g, D, p => RR(p, -10, -12, 20, 4, 1.4), C.tin2, null);
    solid(g, D, p => RR(p, -11.5, -24, 23, 12, 2.4), C.tin, C.tin2, 2.6);
    ln(g, D, p => { p.moveTo(-4, -23); p.lineTo(-4, -13); p.moveTo(4, -23); p.lineTo(4, -13); }, .6);
    hiLn(g, D, p => { p.moveTo(-8.5, -21); p.lineTo(-8.5, -15); });
    g.restore();
  },
  sonic(g, D) {
    const cy = 8;
    solid(g, D, p => { p.moveTo(-28, cy + 4); p.lineTo(-28, cy); p.arc(0, cy, 28, PI, TAU); p.lineTo(28, cy + 4); p.quadraticCurveTo(28, cy + 9, 23, cy + 9); p.lineTo(-23, cy + 9); p.quadraticCurveTo(-28, cy + 9, -28, cy + 4); p.closePath(); }, C.night, null);
    solid(g, D, p => { p.moveTo(-22.5, cy); p.arc(0, cy, 22.5, PI, TAU); p.closePath(); }, C.canvas, C.paper2, 2.6);
    g.save(); g.lineCap = 'butt'; g.beginPath(); g.arc(0, cy, 17.5, rad(-52), rad(-2)); g.lineWidth = 6.5; g.strokeStyle = C.red; g.stroke(); g.restore();
    const n = D.small ? 4 : 7;
    for (let i = 0; i < n; i++) { const a = PI + i * PI / (n - 1); ln(g, D, p => { p.moveTo(17 * Math.cos(a), cy + 17 * Math.sin(a)); p.lineTo(21 * Math.cos(a), cy + 21 * Math.sin(a)); }, .6); }
    const a = rad(-30), c = Math.cos(a), s = Math.sin(a);
    solid(g, D, p => P(p, [-2.6 * s, cy + 2.6 * c, 21 * c, cy + 21 * s, 2.6 * s, cy - 2.6 * c]), C.night, null);
    solid(g, D, p => O(p, 0, cy, 4.4), C.brass, null);
  },
  escape(g, D) {
    // a rope ladder dangling from cloud nine
    g.save(); g.translate(11, -5); g.rotate(rad(-17));
    const rails = p => { p.moveTo(-6, 0); p.lineTo(-6, 36); p.moveTo(6, 0); p.lineTo(6, 36); };
    if (D.small) ln(g, D, rails, 1); else tube(g, D, rails, 1.8, C.wood2);
    for (const y of D.small ? [14, 28] : [10, 19, 28]) {
      if (D.small) ln(g, D, p => { p.moveTo(-6, y); p.lineTo(6, y); }, 1);
      else tube(g, D, p => { p.moveTo(-6, y); p.lineTo(6, y); }, 2.4, C.wood, 'butt');
    }
    g.restore();
    blob(g, D, p => { O(p, -13, -12, 10.5); O(p, 1, -19, 12.5); O(p, 15, -12, 10); O(p, 24, -5, 7); O(p, -23, -5, 7.5); RR(p, -29, -11, 58, 11, 5.5); }, C.canvas, C.paper2, 3.4);
    hi(g, p => E(p, -4, -26, 4.4, 2.2, rad(-20)), .9);
  },
  greaser(g, D) {
    // a pump oil can with a long spout and a drip
    tube(g, D, p => { p.moveTo(-15, -1); p.bezierCurveTo(-30, -3, -31, 18, -16, 17); }, 3, C.brass2);
    tube(g, D, p => { p.moveTo(1, -12); p.lineTo(25, -27); }, 2.6, C.tin);
    solid(g, D, p => drop(p, 26, -16.5, 3), C.night, null);
    solid(g, D, p => RR(p, -10, -19, 7, 6, 1.6), C.tin, C.tin2, 1.6);
    solid(g, D, p => { p.moveTo(-17, 21); p.lineTo(-17, 0); p.lineTo(-3.5, -13.5); p.lineTo(3.5, -13.5); p.lineTo(17, 0); p.lineTo(17, 21); p.quadraticCurveTo(17, 25, 13, 25); p.lineTo(-13, 25); p.quadraticCurveTo(-17, 25, -17, 21); p.closePath(); }, C.brass, C.brass2);
    ln(g, D, p => { p.moveTo(-17, 0); p.lineTo(17, 0); }, .75);
    if (!D.small) ln(g, D, p => { p.moveTo(-17, 19); p.lineTo(17, 19); }, .6, C.brass2);
    hiLn(g, D, p => { p.moveTo(-12.5, 4); p.lineTo(-12.5, 15); }, 1.1, .7);
  },
  crashtest(g, D) {
    g.save(); g.rotate(rad(14));
    const r = 20;
    fillP(g, p => O(p, 0, 0, r), C.brass);
    fillP(g, p => { p.moveTo(0, 0); p.arc(0, 0, r, -PI / 2, 0); p.closePath(); p.moveTo(0, 0); p.arc(0, 0, r, PI / 2, PI); p.closePath(); }, C.night);
    hi(g, p => { p.moveTo(-4, -4); p.arc(0, 0, r - 5, PI * 1.1, PI * 1.4); p.closePath(); }, .5);
    g.beginPath(); O(g, 0, 0, r); g.lineWidth = D.L; g.strokeStyle = INK; g.stroke();
    g.restore();
    ln(g, D, p => { p.moveTo(-24, 14); p.lineTo(-31, 18); p.moveTo(-19, 21); p.lineTo(-22, 28); p.moveTo(24, -14); p.lineTo(31, -18); p.moveTo(19, -21); p.lineTo(22, -28); }, .9);
  },
  logbook(g, D) {
    const page = s => p => { p.moveTo(0, -11); p.bezierCurveTo(-8 * s, -15, -19 * s, -15, -28 * s, -11); p.lineTo(-28 * s, 14); p.bezierCurveTo(-19 * s, 10, -8 * s, 10, 0, 14); p.closePath(); };
    solid(g, D, p => { p.moveTo(0, -7); p.bezierCurveTo(-10, -11, -21, -11, -31, -7); p.lineTo(-31, 18); p.bezierCurveTo(-21, 14, -10, 14, 0, 18); p.bezierCurveTo(10, 14, 21, 14, 31, 18); p.lineTo(31, -7); p.bezierCurveTo(21, -11, 10, -11, 0, -7); p.closePath(); }, C.red, C.red2, 2.6);
    for (const s of [1, -1]) {
      solid(g, D, page(s), C.canvas, C.paper2, 2.6);
      if (!D.small) for (const y of [-6, -1, 4]) ln(g, D, p => { p.moveTo(-5 * s, y); p.bezierCurveTo(-11 * s, y - 2.6, -17 * s, y - 2.6, -23 * s, y - 1.5); }, .5, C.tin2);
    }
    g.save(); g.translate(9, 2); g.rotate(rad(-52));
    solid(g, D, p => P(p, [-14, -3.5, -21, 0, -14, 3.5]), C.wood3, null);
    fillP(g, p => P(p, [-18.6, -1.2, -21.3, 0, -18.6, 1.2]), INK);
    solid(g, D, p => RR(p, -14, -3.5, 25, 7, 1), C.brass, C.brass2, 1.8);
    solid(g, D, p => RR(p, 11, -3.5, 4, 7, .8), C.tin, null);
    solid(g, D, p => RR(p, 15, -3.5, 5.5, 7, 2.2), C.red, null);
    g.restore();
  },
  compound(g, D) {
    const h = D.small ? 8.5 : 5.6, rx = D.small ? 9 : 8.2, ry = D.small ? 3.8 : 3.3, base = D.small ? 24 : 26;
    const stacks = D.small ? [[-19, 1], [0, 2], [19, 3]] : [[-17.5, 2], [0, 3.6], [17.5, 5.2]];
    for (const [x, n0] of stacks) {
      const n = Math.round(D.small ? n0 : n0 * 1.0);
      for (let i = 0; i < n; i++) {
        const yb = base - i * h, yt = yb - h;
        solid(g, D, p => { p.moveTo(x - rx, yt); p.lineTo(x - rx, yb); p.ellipse(x, yb, rx, ry, 0, PI, 0, true); p.lineTo(x + rx, yt); p.closePath(); }, C.brass2, null);
        solid(g, D, p => E(p, x, yt, rx, ry), C.brass, null);
      }
      hi(g, p => E(p, x - 3.5, base - n * h - .6, 2.2, 1, 0), .7);
    }
    if (D.small) return;
    tube(g, D, p => { p.moveTo(-26, -10); p.quadraticCurveTo(-8, -12, 8, -24); }, 2.6, C.canvas);
    solid(g, D, p => P(p, [13, -28, 2.5, -26.5, 8.5, -18]), C.canvas, null);
  },
  // Coins
  piggy(g, D) {
    for (const [x, c] of [[-14, C.red2], [8, C.red2], [-9, C.red], [13, C.red]]) solid(g, D, p => RR(p, x - 3.6, 12, 7.2, 12, 2.2), c, null);
    tube(g, D, p => { p.moveTo(-20, -1); p.bezierCurveTo(-27, -3, -29, -10, -25, -11); p.bezierCurveTo(-21, -12, -21, -5, -27, -5); }, 1.8, C.red);
    solid(g, D, p => P(p, [1, -10, 4, -19, 9, -11]), C.red2, null, 2);
    solid(g, D, p => E(p, -1, 3, 21, 15.5), C.red, C.red2);
    solid(g, D, p => P(p, [8, -9, 12.5, -21, 17.5, -7]), C.red, C.red2, 2);
    solid(g, D, p => RR(p, 17, -2.5, 8.5, 12, 3.6), C.red, C.red2, 2);
    fillP(g, p => { E(p, 22.2, 1, 1, 1.5); E(p, 22.2, 6, 1, 1.5); }, INK);
    fillP(g, p => O(p, 11, -1.5, 1.9), INK);
    hi(g, p => E(p, -9, -6, 5, 2.4, rad(-18)));
    solid(g, D, p => O(p, -3, -21, 6.6), C.brass, C.brass2, 2.2);
    fillP(g, p => RR(p, -9.5, -13.8, 13, 3, 1.5), INK);
  },
  coupon(g, D) {
    // a coupon with a dashed cut line around it, scissors snipping along the top edge
    g.save(); g.rotate(rad(-6));
    const tk = p => RR(p, -24, -9, 50, 32, 2.5);
    g.beginPath(); tk(g); g.fillStyle = C.paper2; g.fill(); shadeBand(g, D, tk, C.canvas, D.k);
    g.save(); g.setLineDash([D.L * 1.2, D.L * 1.2]); ln(g, D, tk, .8); g.restore();
    solid(g, D, p => star(p, 2, 8, 5, 9.5, 4.3), C.red, C.red2, 2.2);
    g.save(); g.translate(-12, -9);
    for (const s of [1, -1]) {
      g.save(); g.rotate(s * rad(18));
      solid(g, D, p => { p.moveTo(-1, -3.6 * s); p.lineTo(22, -.4 * s); p.quadraticCurveTo(23.5, .6 * s, 21, 1.8 * s); p.lineTo(-1, 3.6 * s); p.closePath(); }, C.canvas, C.tin, 2);
      g.restore();
      g.save(); g.rotate(-s * rad(24));
      tube(g, D, p => { p.moveTo(0, 0); p.lineTo(-7, 0); }, 3.4, C.red);
      tube(g, D, p => E(p, -12.5, 0, 5.4, 4.2), 3.4, C.red);
      g.restore();
    }
    solid(g, D, p => O(p, 0, 0, 2.4), C.tin, null);
    g.restore(); g.restore();
  },
  magnet(g, D) {
    for (const [x, y, r] of [[22, -9, 6.5], [20, 11, 7]]) {
      if (!D.small) ln(g, D, p => { p.moveTo(x + r + 2.5, y - 3); p.lineTo(x + r + 7, y - 3); p.moveTo(x + r + 3.5, y + 2.5); p.lineTo(x + r + 7.5, y + 2.5); }, .7);
      coin(g, D, x, y, r, rad(10));
    }
    g.save(); g.translate(-7, 1); g.rotate(rad(-14));
    const U = p => { p.moveTo(14, -19); p.lineTo(0, -19); p.arc(0, 0, 19, -PI / 2, PI / 2, true); p.lineTo(14, 19); p.lineTo(14, 8); p.lineTo(0, 8); p.arc(0, 0, 8, PI / 2, -PI / 2, false); p.lineTo(14, -8); p.closePath(); };
    solid(g, D, U, C.red, C.red2, 3.4);
    for (const y of [-19, 8]) solid(g, D, p => RR(p, 7, y, 7.5, 11, 1), C.tin, C.tin2, 2);
    hiLn(g, D, p => p.arc(0, 0, 15, rad(200), rad(250)));
    g.restore();
  },
  sponsor(g, D) {
    tube(g, D, p => { p.moveTo(-20, 31); p.lineTo(-20, -23); }, 3.2, C.wood);
    solid(g, D, p => { p.moveTo(-18.5, -22); p.bezierCurveTo(-4, -26, 12, -14, 29, -9); p.bezierCurveTo(12, -5, -2, 9, -18.5, 6); p.closePath(); }, C.red, C.red2);
    g.save(); g.beginPath(); g.moveTo(-18.5, -22); g.bezierCurveTo(-4, -26, 12, -14, 29, -9); g.bezierCurveTo(12, -5, -2, 9, -18.5, 6); g.closePath(); g.clip();
    fillP(g, p => RR(p, -19, -30, 6, 40, 0), C.brass);
    g.restore();
    ln(g, D, p => { p.moveTo(-13, -23); p.lineTo(-13, 7); }, .7);
    coin(g, D, 1, -7.5, 6.2, 0);
    solid(g, D, p => O(p, -20, -26, 3.6), C.brass, C.brass2, 1.6);
  },
  // added in 0.4
  silent(g, D) {
    // a glider sliding by, three soft wind lines behind it and no engine anywhere
    for (const [y, x0, len] of [[-12, -30, 16], [0, -31, 20], [12, -28, 14]]) ln(g, D, p => { p.moveTo(x0, y); p.lineTo(x0 + len, y); }, .8, C.teal2);
    planeTop(g, D, 6, 0, 1.15, rad(90), C.canvas, C.paper2);
    if (!D.small) solid(g, D, p => sparkle(p, 22, -20, 6), C.canvas, null);
  },
  bouquet(g, D) {
    // three balloons tied together with a bow
    const bal = (x, y, col, col2) => { solid(g, D, p => { p.moveTo(x, y + 12); p.bezierCurveTo(x - 13, y + 4, x - 11, y - 13, x, y - 13); p.bezierCurveTo(x + 11, y - 13, x + 13, y + 4, x, y + 12); p.closePath(); }, col, col2); hi(g, p => E(p, x - 4.5, y - 6, 1.8, 3.4, rad(30))); };
    ln(g, D, p => { p.moveTo(-13, 0); p.lineTo(0, 24); p.moveTo(0, -6); p.lineTo(0, 24); p.moveTo(13, 0); p.lineTo(0, 24); }, .7);
    bal(-13, -10, C.teal, C.teal2); bal(13, -10, C.brass, C.brass2); bal(0, -16, C.red, C.red2);
    solid(g, D, p => { p.moveTo(0, 22); p.lineTo(-8, 18); p.lineTo(-8, 27); p.closePath(); p.moveTo(0, 22); p.lineTo(8, 18); p.lineTo(8, 27); p.closePath(); }, C.red, C.red2, 1.6);
  },
  hedgehop(g, D) {
    // a hedge with a little plane skimming just over it
    blob(g, D, p => { O(p, -16, 18, 10); O(p, -2, 15, 12); O(p, 13, 18, 10); RR(p, -26, 18, 50, 10, 2); }, C.grass, C.grass2);
    if (!D.small) for (const [x, y] of [[-14, 14], [0, 10], [12, 15]]) ln(g, D, p => { p.moveTo(x - 3, y); p.lineTo(x, y - 3); p.lineTo(x + 3, y); }, .6, C.grass2);
    planeTop(g, D, 2, -14, .9, rad(90), C.red, C.red2);
    ln(g, D, p => { p.moveTo(-30, -14); p.lineTo(-18, -14); }, .8, C.teal2);
  },
  touchgo(g, D) {
    // a flight path that dips to touch the ground and climbs away
    tube(g, D, p => { p.moveTo(-30, -16); p.bezierCurveTo(-14, -14, -8, 16, 0, 16); p.bezierCurveTo(8, 16, 14, -8, 24, -18); }, 4.5, C.red);
    solid(g, D, p => P(p, [30, -24, 18, -21, 26, -12]), C.red, C.red2, 2);
    solid(g, D, p => RR(p, -28, 20, 56, 7, 2), C.wood, C.wood2, 2);
    for (const x of [-6, 0, 6]) if (!D.small) ln(g, D, p => { p.moveTo(x, 19); p.lineTo(x - 3, 13); }, .7, C.brass2);
  },
  bullseye(g, D) {
    for (const [r, col] of [[26, C.red], [18, C.canvas], [10, C.red]]) solid(g, D, p => O(p, 0, 2, r), col, col === C.red ? C.red2 : C.paper2, r > 20 ? D.k : 2.2);
    solid(g, D, p => O(p, 0, 2, 3.6), C.brass, null);
    tube(g, D, p => { p.moveTo(2, 0); p.lineTo(27, -25); }, 3, C.wood);
    solid(g, D, p => P(p, [24, -31, 31, -23, 33, -33]), C.teal, C.teal2, 1.8);
  },
  showboat(g, D) {
    // three stars chained by a ribbon: tricks back to back
    tube(g, D, p => { p.moveTo(-22, 14); p.quadraticCurveTo(-11, -6, 0, 4); p.quadraticCurveTo(11, 14, 22, -10); }, 3, C.teal);
    for (const [x, y, r] of [[-22, 14, 9], [0, 4, 11], [22, -10, 13]]) { solid(g, D, p => star(p, x, y, 5, r, r * .45), C.brass, C.brass2, 2.4); hi(g, p => E(p, x - r * .25, y - r * .3, r * .1, r * .18, .4)); }
  },
  flyer(g, D) {
    // a ticket stub with punched holes, one per landing
    g.save(); g.rotate(rad(-10));
    solid(g, D, p => { p.moveTo(-26, -14); p.lineTo(26, -14); p.lineTo(26, -6); p.arc(26, 0, 6, -PI / 2, PI / 2, true); p.lineTo(26, 14); p.lineTo(-26, 14); p.lineTo(-26, 6); p.arc(-26, 0, 6, PI / 2, -PI / 2, true); p.closePath(); }, C.paper, C.paper2);
    ln(g, D, p => { p.setLineDash([2.5, 2.5]); p.moveTo(10, -14); p.lineTo(10, 14); }, .6); g.setLineDash([]);
    for (const x of [-15, -6, 3]) solid(g, D, p => O(p, x, 0, 3.4), C.night, null);
    solid(g, D, p => planeTopShape(p, 18, 0, .32), C.red, null);
    g.restore();
  },
  fanclub(g, D) {
    // a pennant on a stick with a heart
    tube(g, D, p => { p.moveTo(-22, 30); p.lineTo(-22, -26); }, 3, C.wood);
    solid(g, D, p => { p.moveTo(-20, -25); p.lineTo(28, -12); p.lineTo(-20, 3); p.closePath(); }, C.red, C.red2);
    solid(g, D, p => { const x = -4, y = -11, r = 4.2; p.moveTo(x, y + 6.5); p.bezierCurveTo(x - 9, y + 1, x - 6, y - 7, x, y - 3); p.bezierCurveTo(x + 6, y - 7, x + 9, y + 1, x, y + 6.5); p.closePath(); }, C.canvas, null);
  },
  understudy(g, D) {
    // an empty dashed slot waiting in the wings, a star outline inside
    g.save(); g.setLineDash([4, 3]); ln(g, D, p => RR(p, -24, -24, 48, 48, 6), 1); g.restore();
    solid(g, D, p => star(p, 0, 2, 5, 16, 7), C.canvas, C.paper2);
    if (!D.small) solid(g, D, p => sparkle(p, 17, -16, 5), C.brass, null);
  },
  carpenter(g, D) {
    // a hammer over a wooden plank
    solid(g, D, p => RR(p, -28, 8, 56, 12, 2), C.wood, C.wood2);
    if (!D.small) { ln(g, D, p => { p.moveTo(-20, 12); p.quadraticCurveTo(0, 15, 18, 12); }, .6, C.wood2); for (const x of [-22, 22]) solid(g, D, p => O(p, x, 14, 1.6), C.tin2, null); }
    g.save(); g.rotate(rad(-35));
    tube(g, D, p => { p.moveTo(0, 18); p.lineTo(0, -10); }, 4.5, C.wood3);
    solid(g, D, p => RR(p, -12, -20, 24, 10, 2), C.tin, C.tin2, 2.4);
    hiLn(g, D, p => { p.moveTo(-9, -17.5); p.lineTo(6, -17.5); });
    g.restore();
  },
  divebomb(g, D) {
    // a plane diving nose-first with speed lines
    for (const [x, len] of [[-12, 20], [0, 26], [12, 18]]) ln(g, D, p => { p.moveTo(x, -30); p.lineTo(x, -30 + len); }, .8, C.teal2);
    planeTop(g, D, 0, 6, 1.1, rad(180), C.red, C.red2);
    if (!D.small) solid(g, D, p => P(p, [-6, 27, 0, 33, 6, 27]), C.brass, C.brass2, 1.6);
  },
  sailplane(g, D) {
    // a long-winged glider side view on a gentle swoop
    tube(g, D, p => { p.moveTo(-30, 22); p.quadraticCurveTo(0, 30, 30, 18); }, 3, C.teal);
    solid(g, D, p => { p.moveTo(-30, -2); p.quadraticCurveTo(0, -10, 30, -6); p.quadraticCurveTo(0, -3, -30, 2); p.closePath(); }, C.canvas, C.paper2, 2);
    solid(g, D, p => { p.moveTo(-18, 2); p.quadraticCurveTo(-4, -6, 16, -2); p.quadraticCurveTo(22, 2, 16, 5); p.quadraticCurveTo(0, 8, -22, 6); p.lineTo(-27, -4); p.closePath(); }, C.red, C.red2, 2.4);
    solid(g, D, p => E(p, 8, -1, 4, 2.6), C.night, null);
  },
  booster(g, D) {
    // a fat rocket kicking off with a big flame
    g.save(); g.rotate(rad(45));
    solid(g, D, p => curve(p, [-7, 14, -11, 24, -4, 36, 0, 30, 4, 36, 11, 24, 7, 14]), C.red, C.red2, 2.4);
    fillP(g, p => curve(p, [-4, 15, -6, 24, 0, 31, 6, 24, 4, 15]), C.brass);
    solid(g, D, p => { p.moveTo(-8, 15); p.lineTo(-8, -10); p.quadraticCurveTo(0, -30, 8, -10); p.lineTo(8, 15); p.closePath(); }, C.tin, C.tin2);
    solid(g, D, p => P(p, [-8, 15, -15, 18, -8, 4]), C.red, C.red2, 1.6); solid(g, D, p => P(p, [8, 15, 15, 18, 8, 4]), C.red, C.red2, 1.6);
    solid(g, D, p => O(p, 0, -6, 3.6), C.night, null);
    g.restore();
  },
  supercharge(g, D) {
    // a cog with an arrow climbing out of it
    solid(g, D, p => star(p, -4, 6, 10, 22, 17, rad(-90)), C.tin, C.tin2);
    solid(g, D, p => O(p, -4, 6, 8), C.night, null);
    tube(g, D, p => { p.moveTo(-14, 18); p.lineTo(16, -14); }, 4.5, C.brass);
    solid(g, D, p => P(p, [26, -24, 10, -19, 21, -8]), C.brass, C.brass2, 2);
  },
  burner(g, D) {
    // a balloon over a basket with a burner flame
    solid(g, D, p => { p.moveTo(0, 6); p.bezierCurveTo(-24, -4, -20, -30, 0, -30); p.bezierCurveTo(20, -30, 24, -4, 0, 6); p.closePath(); }, C.brass, C.brass2);
    if (!D.small) ln(g, D, p => { p.moveTo(0, -30); p.lineTo(0, 6); p.moveTo(-10, -27); p.quadraticCurveTo(-14, -10, -5, 3); p.moveTo(10, -27); p.quadraticCurveTo(14, -10, 5, 3); }, .6, C.brass2);
    solid(g, D, p => curve(p, [-4, 16, -6, 10, 0, 4, 6, 10, 4, 16]), C.red, C.red2, 1.6);
    ln(g, D, p => { p.moveTo(-8, 18); p.lineTo(-4, 6); p.moveTo(8, 18); p.lineTo(4, 6); }, .6);
    solid(g, D, p => RR(p, -9, 18, 18, 11, 2), C.wood, C.wood2, 2.2);
    hi(g, p => E(p, -9, -18, 2.2, 4, rad(30)));
  },
  // added in 0.5
  longhaul(g, D) {
    // a pocket watch with little wings
    for (const sx of [-1, 1]) solid(g, D, p => { p.moveTo(sx * 16, -4); p.quadraticCurveTo(sx * 31, -16, sx * 30, -2); p.quadraticCurveTo(sx * 27, 4, sx * 18, 6); p.closePath(); }, C.canvas, C.paper2, 2);
    solid(g, D, p => RR(p, -4, -27, 8, 6, 2), C.brass, C.brass2, 1.6);
    solid(g, D, p => O(p, 0, 4, 19), C.brass, C.brass2);
    solid(g, D, p => O(p, 0, 4, 14), C.canvas, C.paper2, 2);
    ln(g, D, p => { p.moveTo(0, 4); p.lineTo(0, -6); p.moveTo(0, 4); p.lineTo(7, 8); }, 1.1);
    if (!D.small) for (let i = 0; i < 12; i++) { const a = i * PI / 6; ln(g, D, p => { p.moveTo(12 * Math.cos(a), 4 + 12 * Math.sin(a)); p.lineTo(13.6 * Math.cos(a), 4 + 13.6 * Math.sin(a)); }, .5); }
  },
  investor(g, D) {
    // a stack of coins with an arrow going up
    for (let i = 0; i < 4; i++) coin(g, D, -8, 20 - i * 7, 12, 0);
    tube(g, D, p => { p.moveTo(6, 18); p.lineTo(22, -14); }, 4, C.good);
    solid(g, D, p => P(p, [27, -26, 14, -18, 26, -10]), C.good, '#3b7f45', 2);
  },
  overachiever(g, D) {
    // a gauge with the needle past the red
    solid(g, D, p => { p.moveTo(-27, 14); p.arc(0, 14, 27, PI, TAU); p.closePath(); }, C.canvas, C.paper2);
    g.save(); g.lineCap = 'butt'; g.beginPath(); g.arc(0, 14, 21, rad(-40), rad(-2)); g.lineWidth = 6; g.strokeStyle = C.red; g.stroke(); g.restore();
    g.save(); g.lineCap = 'butt'; g.beginPath(); g.arc(0, 14, 21, rad(-90), rad(-40)); g.lineWidth = 6; g.strokeStyle = C.brass; g.stroke(); g.restore();
    const a = rad(8); solid(g, D, p => P(p, [-2.4 * Math.sin(a), 14 + 2.4 * Math.cos(a), 25 * Math.cos(a), 14 + 25 * Math.sin(a), 2.4 * Math.sin(a), 14 - 2.4 * Math.cos(a)]), C.night, null);
    solid(g, D, p => O(p, 0, 14, 4), C.brass, null);
    if (!D.small) solid(g, D, p => sparkle(p, 22, -14, 6), C.brass, null);
  },
  magpie(g, D) {
    // a black-and-white bird carrying a coin
    solid(g, D, p => { p.moveTo(-26, 10); p.quadraticCurveTo(-10, 2, 4, -2); p.quadraticCurveTo(18, -6, 22, -14); p.quadraticCurveTo(24, -4, 14, 6); p.quadraticCurveTo(0, 16, -26, 10); p.closePath(); }, C.night, null);
    solid(g, D, p => { p.moveTo(-8, 4); p.quadraticCurveTo(2, -16, 14, -22); p.quadraticCurveTo(10, -6, -2, 6); p.closePath(); }, C.canvas, C.paper2, 1.6);
    solid(g, D, p => P(p, [22, -14, 30, -12, 23, -9]), C.brass, C.brass2, 1.4);
    solid(g, D, p => O(p, 17, -12, 1.4), C.canvas, null);
    coin(g, D, 22, 10, 9, 0);
  },
};
// fallback for ids without a motif: a plain star
function fallback(g, D) {
  solid(g, D, p => star(p, 0, 2, 5, 25, 11, rad(-90)), C.brass, C.brass2);
  hi(g, p => E(p, -5, -6, 2.4, 4.4, rad(30)));
}

export const DECAL_IDS = Object.keys(MOTIF);

/* ---------- rarity materials ---------- */
function paperShape(rnd) {
  const W = 35, H = 32, c = 8.5, pts = [], torn = Math.floor(rnd() * 3);
  const edge = (x0, y0, x1, y1, ragged) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / (ragged ? 4.2 : 9))), nx = (y0 - y1) / len, ny = (x1 - x0) / len;
    for (let i = 0; i < n; i++) {
      const t = i / n, j = i === 0 ? (rnd() - .5) * 1.2 : ragged ? (i % 2 ? 1.5 : -1.1) * (.6 + rnd() * .8) : (rnd() - .5) * 1.2;
      pts.push(x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j);
    }
  };
  edge(-W, -H, W, -H, torn === 0); edge(W, -H, W, H - c, false); edge(W, H - c, W - c, H, false); edge(W - c, H, -W, H, torn === 2); edge(-W, H, -W, -H, torn === 1);
  return { pts, W, H, c };
}
function tinPath(rnd) {
  const W = 37, H = 33, j = () => (rnd() - .5) * 1.6, r = [9 + j(), 9 + j(), 9 + j(), 9 + j()];
  const c = [[-W + j(), -H + j()], [W + j(), -H + j()], [W + j(), H + j()], [-W + j(), H + j()]];
  return g => {
    g.moveTo((c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2);
    for (let i = 1; i <= 4; i++) { const a = c[i % 4], b = c[(i + 1) % 4]; g.arcTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, r[i % 4]); }
    g.closePath();
  };
}
function shieldPath(rnd) {
  const j = () => (rnd() - .5) * 1.4, l = -37 + j(), r = 37 + j(), ty = -39 + j(), bx = j();
  return (g, s = 1) => {
    const X = x => x * s, Y = y => y * s;
    g.moveTo(X(l), Y(-39)); g.quadraticCurveTo(X(0), Y(-45), X(r), Y(ty));
    g.lineTo(X(r + .4), Y(3));
    g.bezierCurveTo(X(r), Y(23), X(19), Y(35), X(bx), Y(43));
    g.bezierCurveTo(X(-19), Y(35), X(l), Y(23), X(l - .4), Y(3));
    g.closePath();
  };
}
function material(r, rnd) {
  if (r === 'U') return { r, tilt: (rnd() - .5) * rad(3), path: tinPath(rnd), ms: .98, my: 0, spark: [31, -28], ext: 39 };
  if (r === 'R') { const sp = shieldPath(rnd); return { r, tilt: (rnd() - .5) * rad(2), path: g => sp(g), inner: g => sp(g, .8), ms: .86, my: -2, spark: [32, -34], ext: 43 }; }
  const sh = paperShape(rnd), tilt = (rnd() < .5 ? -1 : 1) * rad(2.5 + rnd() * 3.5);
  return { r: 'C', tilt, path: g => P(g, sh.pts), ms: 1, my: 0, spark: [sh.W - 3, -sh.H + 3], ext: 40, sh };
}
function drawMaterial(g, D, m) {
  const k = .5 * D.L + 2.6;
  if (m.r === 'U') {
    solid(g, D, m.path, C.tin, C.tin2, k + .6);
    hiLn(g, D, p => { p.moveTo(-33, 16); p.lineTo(-33, -22); p.quadraticCurveTo(-33, -29, -26, -29); p.lineTo(14, -29); }, .9, .55);
    for (const [x, y] of [[-31, -27], [31, -27], [-31, 27], [31, 27]]) {
      if (D.small) fillP(g, p => O(p, x, y, 2.4), C.tin2);
      else { solid(g, D, p => O(p, x, y, 2.7), C.tin, C.tin2, 1.4); }
    }
    if (!D.small) { ln(g, D, p => { p.moveTo(-17, 30.2); p.quadraticCurveTo(-13, 27.6, -9, 30.2); }, .6, C.tin2); }
  } else if (m.r === 'R') {
    solid(g, D, m.path, C.brass, C.brass2, k + .6);
    hiLn(g, D, p => { p.moveTo(-34, 12); p.lineTo(-34, -35); p.quadraticCurveTo(-20, -40, -6, -40.5); }, .9, .7);
    solid(g, D, m.inner, C.rare, C.rare2, k);
    g.save(); g.beginPath(); m.inner(g); g.clip();
    fillP(g, p => P(p, [-34, -12, -12, -40, -4, -40, -34, -4]), 'rgba(255,255,255,.13)');
    g.restore();
  } else {
    const { W, H, c } = m.sh;
    solid(g, D, m.path, C.paper, C.paper2, k);
    hiLn(g, D, p => { p.moveTo(-W + 3.4, H - 9); p.lineTo(-W + 3.4, -H + 3.4); p.lineTo(W - 10, -H + 3.4); }, .9, .75);
    // curled corner: the flap folds back over the decal and shows its pale underside
    fillP(g, p => P(p, [W - c + 1.5, H + 1.2, W + 1.2, H - c + 1.5, W - c + 1.5, H - c + 1.5]), SHADOW);
    solid(g, D, p => { p.moveTo(W, H - c); p.quadraticCurveTo(W - c * .35, H - c * 1.02, W - c, H - c); p.quadraticCurveTo(W - c * 1.02, H - c * .35, W - c, H); p.closePath(); }, C.canvas, null);
  }
}

/* ---------- public API ---------- */
// Draw the decal for mod `id` centred at (x, y), fitting a size×size box. Levels: 1 plain, 2 brass trim, 3 trim + sparkle.
// opts: rarity ('C'|'U'|'R', defaults to MODS[id].r), line (outline px, defaults to a size-based weight), shadow (default true).
export function drawDecal(ctx, id, x, y, size, level = 1, opts = {}) {
  const motif = MOTIF[id] || fallback, lv = Math.max(1, Math.min(3, Math.round(level) || 1));
  const r = opts.rarity || (MOTIF[id] && MODS[id] && MODS[id].r) || 'C';
  const rnd = rng(String(id)), m = material(r, rnd), px = opts.line || linePx(size), small = size < 36;
  // fit decal, trim and shadow into the box; lines are set in decal units so they keep their on-screen weight
  let fit = 1, L = 0, b = 0;
  for (let i = 0; i < 3; i++) { const s = size / 100 * fit; L = px / s; b = L / 2 + Math.max(3, 1.1 * px / s); fit = Math.min(1, 48.5 / (m.ext + (lv >= 2 ? b + L : L / 2) + 2)); }
  const s = size / 100 * fit;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(m.tilt);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  const D = { L, k: .5 * L + 2.2, small, base: ctx.getTransform() };
  if (opts.shadow !== false) {
    const [dx, dy] = lvec(ctx, D, 1.8, 2.6);
    ctx.save(); ctx.translate(dx, dy); ctx.beginPath(); m.path(ctx);
    if (lv >= 2) { ctx.lineWidth = 2 * (b + L); ctx.strokeStyle = SHADOW; ctx.stroke(); } else { ctx.fillStyle = SHADOW; ctx.fill(); }
    ctx.restore();
  }
  if (lv >= 2) {
    ctx.beginPath(); m.path(ctx); ctx.lineWidth = 2 * (b + L); ctx.strokeStyle = INK; ctx.stroke(); ctx.lineWidth = 2 * b; ctx.strokeStyle = C.brass; ctx.stroke();
  }
  drawMaterial(ctx, D, m);
  ctx.save(); ctx.translate(0, m.my); ctx.rotate((rnd() - .5) * rad(5)); const ms = m.ms * (small ? 1.12 : 1); ctx.scale(ms, ms);
  motif(ctx, sc(D, ms));
  ctx.restore();
  if (lv >= 3) {
    const [sx, sy] = m.spark, R = small ? 12 : 10;
    solid(ctx, D, p => sparkle(p, sx, sy, R, .22), C.canvas, null);
    if (!small) solid(ctx, D, p => sparkle(p, sx - 11, sy - 4, 4.6, .24), C.canvas, null);
  }
  ctx.restore();
}

// PNG data URL of a decal, rendered at devicePixelRatio (capped at 2) and cached per id/size/level. Browser only.
const cache = new Map();
export function decalURL(id, size = 96, level = 1) {
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1);
  const key = id + '|' + size + '|' + level + '|' + dpr;
  let url = cache.get(key);
  if (!url) {
    const c = document.createElement('canvas'); c.width = c.height = Math.ceil(size * dpr);
    const g = c.getContext('2d'); g.scale(dpr, dpr); drawDecal(g, id, size / 2, size / 2, size, level);
    url = c.toDataURL('image/png'); cache.set(key, url);
  }
  return url;
}
