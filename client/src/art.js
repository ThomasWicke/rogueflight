// Flying Circus art: craft parts, the goat pilot and the parachute. Pure Canvas 2D, no DOM access.
// Style rules: docs/circus-style.md (ink outline, flat shade lower right, highlight upper left, junk materials).
//
// Part coordinates: the caller translates to the cell centre and scales so 1 unit = 1 grid cell.
// The cell spans -0.5..+0.5 on both axes, y points down, +x is the nose (the craft flies to the right).
// Parts stay inside the cell; only the rocket flame (and its sparks) reaches up to ~1 cell beyond -x.
// Every socket edge has a plate, bracket or body touching the cell boundary; edges without a socket stay
// clear of it, so adjacent connected parts look bolted together and players can see where things attach.

const TAU = Math.PI * 2;

// palette (same hex values as the CSS tokens)
const INK = '#22283a', PAPER2 = '#e6d4ae', CANVAS = '#fbf5e8',
  RED = '#d2402f', RED2 = '#a92f22', BRASS = '#e9a93b', BRASS2 = '#b97d1c',
  TEAL = '#3b9aa6', WOOD = '#b7793f', WOOD2 = '#8a5428', WOOD3 = '#d9a066',
  TIN = '#b9c3c9', TIN2 = '#7f8d96';
// extra material colours for the goat and a few details
const FUR = '#f9f2e4', FUR2 = '#e5d4b4', HORN = '#dcc59a', HORN2 = '#b59c6e',
  LEATHER = '#7d4a2a', LEATHER2 = '#5a331d', PINK = '#ec9c8c', MOUTH = '#5e2230',
  GLASS_DARK = '#2e3650', TAPE = '#d9d8cb', SOOT = 'rgba(34,40,58,.42)';
const SHADE = 'rgba(34,40,58,.17)', SHADE2 = 'rgba(34,40,58,.32)', HI = 'rgba(255,255,255,.5)';

// constant dash patterns (no per-frame allocation)
const DASH = [.042, .036], NODASH = [];

export const PILOT_MOODS = ['idle', 'focus', 'grin', 'scared', 'dizzy', 'cheer', 'crash', 'sad'];

/* ---------------- small helpers ---------------- */
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function ell(g, x, y, rx, ry, a) { g.beginPath(); g.ellipse(x, y, rx, ry, a || 0, 0, TAU); }
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
function seg(g, x0, y0, x1, y1) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
function dot(g, x, y, r, c) { circ(g, x, y, r); g.fillStyle = c; g.fill(); }
function fillStroke(g, c) { g.fillStyle = c; g.fill(); g.stroke(); }
function ink(g, lw) { g.strokeStyle = INK; g.lineWidth = lw; }
// thin detail stroke (grain, seams) in a given colour
function detail(g, c, w) { g.strokeStyle = c; g.lineWidth = w; }
// stroke the current path as a stitched seam (short dashes)
function stitch(g) { g.setLineDash(DASH); g.stroke(); g.setLineDash(NODASH); }
// nail head: an ink dot
function nail(g, x, y, r) { dot(g, x, y, r, INK); }
// rivet: a tin dome with a tiny highlight
function rivet(g, x, y, r) { dot(g, x, y, r, TIN2); dot(g, x - r * .35, y - r * .35, r * .45, CANVAS); }
// wobbly wood-grain line
function grain(g, x0, y, x1, k) {
  g.beginPath(); g.moveTo(x0, y);
  g.bezierCurveTo(x0 + (x1 - x0) * .3, y - k, x0 + (x1 - x0) * .6, y + k, x1, y); g.stroke();
}
// duct tape: a pale strip with ragged ends, centred at (x,y) and rotated by a
function tape(g, x, y, w, h, a, lw) {
  g.save(); g.translate(x, y); g.rotate(a);
  const hw = w / 2, hh = h / 2, z = h * .22;
  g.beginPath(); g.moveTo(-hw, -hh); g.lineTo(hw, -hh);
  g.lineTo(hw - z, -hh + h * .3); g.lineTo(hw + z * .5, -hh + h * .55); g.lineTo(hw - z * .5, -hh + h * .8); g.lineTo(hw, hh);
  g.lineTo(-hw, hh);
  g.lineTo(-hw + z * .6, hh - h * .25); g.lineTo(-hw - z * .4, hh - h * .5); g.lineTo(-hw + z * .4, hh - h * .75); g.closePath();
  g.fillStyle = TAPE; g.fill(); ink(g, lw * .75); g.stroke();
  detail(g, 'rgba(255,255,255,.7)', lw * .5); seg(g, -hw * .6, -hh * .4, hw * .6, -hh * .4);
  g.restore();
}

// mount plate with a bolt: drawn at every socket edge so it touches the cell boundary.
// Edges without a socket never reach the boundary, which shows players where a part can attach.
function mount(g, x, y, w, h, lw, c) {
  rr(g, x, y, w, h, Math.min(w, h) * .25); g.fillStyle = c || TIN; g.fill(); ink(g, lw); g.stroke();
  dot(g, x + w / 2, y + h / 2, Math.min(.026, Math.min(w, h) * .28), INK);
}

/* ---------------- parts ---------------- */
// Sockets per part (sim.js SOCK, [right, top, left, bottom]): cockpit, frame, tank all four;
// wing right, left, bottom; prop left; rocket right, top, bottom; balloon bottom.
// drawPart(g, type, t, o): o.lw outline width in cell units (default 0.05, clamped to 0.12 so tiny cells
// stay legible), o.frac fuel 0..1 (tank), o.on engine firing (prop blur / rocket flame), o.mood (cockpit).
export function drawPart(g, type, t, o) {
  o = o || {}; t = t || 0;
  const lw = Math.min(o.lw || .05, .12), fine = lw < .075; // fine = enough pixels (>~33 px/cell) for grain, stitches, rivets
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; ink(g, lw);
  switch (type) {
    case 'cockpit': cockpit(g, t, lw, fine, o.mood || 'idle'); break;
    case 'frame': frame(g, lw, fine); break;
    case 'tank': tank(g, lw, fine, o.frac == null ? 1 : Math.max(0, Math.min(1, o.frac))); break;
    case 'wing': wing(g, lw, fine); break;
    case 'prop': prop(g, t, lw, fine, !!o.on); break;
    case 'rocket': rocket(g, t, lw, fine, !!o.on); break;
    case 'balloon': balloon(g, lw, fine); break;
  }
  g.restore();
}

// --- frame: a wooden crate seen from the front: rim boards, one diagonal brace, dark back slats
// the crate fills the cell (sockets on all four sides), corners nudged a hair for wonkiness
function crateOutline(g) { g.beginPath(); g.moveTo(-.5, -.49); g.lineTo(.495, -.5); g.lineTo(.5, .495); g.lineTo(-.495, .5); g.closePath(); }
const CX0 = -.31, CY0 = -.31, CX1 = .32, CY1 = .325; // inner opening of the crate
function frame(g, lw, fine) {
  crateOutline(g); g.fillStyle = WOOD; g.fill();
  // rim shading: bottom and right boards darker, top edge highlight
  g.save(); crateOutline(g); g.clip();
  g.fillStyle = SHADE; g.beginPath(); g.moveTo(.5, -.5); g.lineTo(CX1, CY0); g.lineTo(CX1, CY1); g.lineTo(CX0, CY1); g.lineTo(-.5, .5); g.lineTo(.5, .5); g.closePath(); g.fill();
  g.fillStyle = WOOD3; g.fillRect(-.5, -.5, 1, .07);
  g.restore();
  // back slats
  g.beginPath(); g.rect(CX0, CY0, CX1 - CX0, CY1 - CY0); g.fillStyle = WOOD2; g.fill();
  g.save(); g.clip();
  detail(g, 'rgba(34,40,58,.45)', lw * .55); seg(g, -.1, CY0, -.1, CY1); seg(g, .11, CY0, .11, CY1);
  g.fillStyle = SHADE2; g.fillRect(CX0, CY0, CX1 - CX0, .07); g.fillRect(CX0, CY0, .06, CY1 - CY0); // rim casts shade inside
  // diagonal brace, bottom-left to top-right
  g.beginPath(); g.moveTo(CX0 - .2, CY1 + .12); g.lineTo(CX1 + .12, CY0 - .2); g.lineTo(CX1 + .2, CY0 - .12); g.lineTo(CX0 - .12, CY1 + .2); g.closePath();
  g.fillStyle = WOOD; g.fill(); ink(g, lw); g.stroke();
  g.fillStyle = SHADE; g.beginPath(); g.moveTo(CX0 - .15, CY1 + .17); g.lineTo(CX1 + .17, CY0 - .15); g.lineTo(CX1 + .2, CY0 - .12); g.lineTo(CX0 - .12, CY1 + .2); g.closePath(); g.fill();
  if (fine) { detail(g, WOOD2, lw * .45); grain(g, CX0 + .05, CY1 - .03, CX1 - .12, .03); }
  g.restore();
  ink(g, lw); g.beginPath(); g.rect(CX0, CY0, CX1 - CX0, CY1 - CY0); g.stroke();
  // mitred board joints at the corners
  seg(g, -.5, -.49, CX0, CY0); seg(g, .495, -.5, CX1, CY0); seg(g, .5, .495, CX1, CY1); seg(g, -.495, .5, CX0, CY1);
  if (fine) {
    detail(g, WOOD2, lw * .45);
    grain(g, -.3, -.39, .2, .025); grain(g, -.12, .4, .3, -.02);
    g.beginPath(); g.moveTo(-.39, -.2); g.quadraticCurveTo(-.36, 0, -.4, .2); g.stroke(); // left board, vertical grain
    const n = .022;
    nail(g, -.42, -.41, n); nail(g, .42, -.42, n); nail(g, .42, .41, n); nail(g, -.41, .42, n);
  }
  // bolts at the middle of each rim board: the four sockets
  nail(g, 0, -.41, .026); nail(g, .415, 0, .026); nail(g, 0, .415, .026); nail(g, -.41, 0, .026);
  tape(g, .0, .0, .26, .1, Math.PI / 4, lw); // a cracked brace, taped
  ink(g, lw); crateOutline(g); g.stroke();
}

// --- tank: a tin fuel can with a brass filler cap and a glass gauge showing o.frac
function tankBody(g) { rr(g, -.43, -.41, .86, .84, .13); }
function tank(g, lw, fine, frac) {
  // brass filler cap at the top right (behind the body)
  rr(g, .18, -.47, .17, .1, .03); fillStroke(g, BRASS);
  if (fine) { detail(g, 'rgba(255,255,255,.7)', lw * .5); seg(g, .21, -.45, .27, -.45); ink(g, lw); }
  tankBody(g); g.fillStyle = TIN; g.fill();
  g.save(); g.clip();
  g.fillStyle = SHADE; g.fillRect(.28, -.5, .3, 1); g.fillRect(-.5, .3, 1, .2);
  g.fillStyle = HI; g.fillRect(-.37, -.4, .065, .7);
  // pressed ribs
  detail(g, 'rgba(34,40,58,.45)', lw * .6); seg(g, -.5, -.25, .5, -.25); seg(g, -.5, .3, .5, .3);
  detail(g, 'rgba(255,255,255,.65)', lw * .45); seg(g, -.5, -.22, .5, -.22); seg(g, -.5, .33, .5, .33);
  g.restore();
  ink(g, lw); tankBody(g); g.stroke();
  // mounting tabs riveted on, reaching each edge (four sockets)
  mount(g, -.1, -.5, .2, .13, lw); mount(g, -.1, .37, .2, .13, lw); mount(g, -.5, -.08, .13, .2, lw); mount(g, .37, -.08, .13, .2, lw);
  // gauge: brass frame, dark glass, fuel level (red when nearly dry)
  rr(g, -.15, -.19, .25, .45, .085); fillStroke(g, BRASS2);
  const gx = -.105, gy = -.145, gw = .16, gh = .36;
  rr(g, gx, gy, gw, gh, .06); g.fillStyle = GLASS_DARK; g.fill();
  g.save(); g.clip();
  const h = gh * frac, fy = gy + gh - h;
  g.fillStyle = frac < .25 ? RED : BRASS; g.fillRect(gx, fy, gw, h);
  if (frac > .02 && frac < .98) { detail(g, CANVAS, lw * .5); seg(g, gx, fy, gx + gw, fy); }
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(gx + .025, gy, .03, gh);
  g.restore();
  ink(g, lw * .8); rr(g, gx, gy, gw, gh, .06); g.stroke();
  if (fine) {
    // tick marks, rivets and a dent
    detail(g, INK, lw * .5); for (let i = 1; i < 4; i++) seg(g, .1, gy + gh * i / 4, .15, gy + gh * i / 4);
    const r = .028;
    rivet(g, -.36, -.33, r); rivet(g, .36, -.33, r); rivet(g, -.36, .38, r); rivet(g, .36, .38, r);
    rivet(g, .25, -.33, r); rivet(g, -.25, .38, r);
    ell(g, .3, .17, .055, .035, -.5); g.fillStyle = 'rgba(34,40,58,.22)'; g.fill();
    detail(g, 'rgba(255,255,255,.8)', lw * .5); g.beginPath(); g.ellipse(.3, .17, .055, .035, -.5, .1, 1.9); g.stroke();
  }
}

// --- wing: a canvas airfoil on a wooden spar. Rounded leading edge at +x with a red band, thin trailing
//     edge at -x. Sockets: the spar ends in plates at x=-0.5 and x=+0.5, V-struts end in a plate at y=+0.5.
function foil(g) {
  g.beginPath(); g.moveTo(-.42, -.12);               // thin trailing edge
  g.bezierCurveTo(-.25, -.17, -.04, -.29, .17, -.29); // upper surface
  g.bezierCurveTo(.34, -.29, .44, -.23, .43, -.16);   // rounded nose
  g.bezierCurveTo(.42, -.095, .34, -.08, .27, -.08);
  g.bezierCurveTo(.1, -.08, -.17, -.095, -.42, -.12); // lower surface
  g.closePath();
}
function strut(g, x0, y0, x1, y1, w, lw) {
  ink(g, w + lw * 2); seg(g, x0, y0, x1, y1);
  detail(g, WOOD, w); seg(g, x0, y0, x1, y1);
  detail(g, WOOD3, w * .3); seg(g, x0 - w * .2, y0, x1 - w * .2, y1);
}
const SPAR = -.17; // spar height: where neighbouring wings and side mounts join
function wing(g, lw, fine) {
  // V-struts and a rigging wire under the foil, plate on the bottom edge
  detail(g, INK, lw * .45); seg(g, -.15, -.07, .19, -.07);
  strut(g, -.16, -.09, -.03, .45, .07, lw); strut(g, .2, -.08, .05, .45, .07, lw);
  mount(g, -.14, .43, .3, .07, lw);
  // spar through the wing, end plates at both side edges
  ink(g, lw); g.beginPath(); g.rect(-.47, SPAR - .03, .94, .06); fillStroke(g, WOOD);
  mount(g, -.5, SPAR - .085, .06, .17, lw); mount(g, .44, SPAR - .085, .06, .17, lw);
  foil(g); g.fillStyle = CANVAS; g.fill();
  g.save(); g.clip();
  // shade along the lower surface, red leading-edge band (slightly tilted)
  g.fillStyle = PAPER2; g.beginPath(); g.moveTo(-.5, -.13); g.bezierCurveTo(-.2, -.12, .2, -.13, .5, -.15); g.lineTo(.5, 0); g.lineTo(-.5, 0); g.closePath(); g.fill();
  g.fillStyle = RED; g.beginPath(); g.moveTo(.25, -.4); g.lineTo(.6, -.4); g.lineTo(.6, 0); g.lineTo(.29, 0); g.closePath(); g.fill();
  g.fillStyle = SHADE; g.beginPath(); g.moveTo(.29, -.14); g.bezierCurveTo(.36, -.15, .4, -.17, .6, -.2); g.lineTo(.6, 0); g.lineTo(.29, 0); g.closePath(); g.fill();
  // highlight along the top
  detail(g, 'rgba(255,255,255,.9)', lw * .7); g.beginPath(); g.moveTo(-.18, -.2); g.bezierCurveTo(-.05, -.25, .06, -.26, .17, -.26); g.stroke();
  detail(g, 'rgba(255,255,255,.6)', lw * .6); seg(g, .31, -.25, .37, -.24);
  // rib stitching across the fabric
  if (fine) { detail(g, 'rgba(34,40,58,.5)', lw * .5); for (const x of RIBS) { g.beginPath(); g.moveTo(x, -.3); g.lineTo(x + .01, -.06); stitch(g); } }
  ink(g, lw * .8); seg(g, .25, -.4, .29, 0);
  g.restore();
  ink(g, lw); foil(g); g.stroke();
  tape(g, -.13, -.15, .14, .062, .45, lw); // patched tear
}
const RIBS = [-.26, -.05, .14];

// --- prop: wooden mount plate at -x, tin nacelle, red spinner and wooden blades at +x
function nacelle(g) {
  g.beginPath(); g.moveTo(-.42, -.18); g.lineTo(.1, -.21);
  g.quadraticCurveTo(.26, -.21, .27, 0); g.quadraticCurveTo(.26, .21, .1, .21);
  g.lineTo(-.42, .18); g.closePath();
}
function blade(g, x, len, lw, fine) {
  // one wooden blade from the hub, signed length (negative = up)
  const s = Math.sign(len) || 1, L = Math.abs(len);
  if (L < .02) return;
  g.beginPath(); g.moveTo(x - .02, 0);
  g.quadraticCurveTo(x - .075, s * L * .45, x - .03, s * L); g.quadraticCurveTo(x + .02, s * (L + .02), x + .045, s * L * .9);
  g.quadraticCurveTo(x + .06, s * L * .4, x + .02, 0); g.closePath();
  g.fillStyle = WOOD; g.fill(); g.stroke();
  if (L > .2) { // brass tip guard
    g.save(); g.clip(); g.fillStyle = BRASS; g.fillRect(x - .1, s > 0 ? L * .8 : -L - .05, .2, L * .2 + .05); g.restore(); g.stroke();
    if (fine) { detail(g, WOOD3, lw * .5); seg(g, x - .03, s * .08, x - .03, s * L * .7); ink(g, lw); }
  }
}
function prop(g, t, lw, fine, on) {
  // exhaust stack
  rr(g, -.17, -.34, .08, .16, .02); fillStroke(g, TIN2);
  rr(g, -.19, -.37, .12, .05, .02); fillStroke(g, BRASS);
  nacelle(g); g.fillStyle = TIN; g.fill();
  g.save(); g.clip();
  g.fillStyle = SHADE; g.fillRect(-.5, .08, 1, .2);
  g.fillStyle = HI; g.fillRect(-.5, -.17, 1, .05);
  g.fillStyle = RED; g.fillRect(.02, -.25, .1, .5); // cowl band
  g.fillStyle = SHADE; g.fillRect(.02, .08, .1, .2);
  if (fine) { detail(g, 'rgba(34,40,58,.5)', lw * .6); for (let x = -.33; x < -.05; x += .08) seg(g, x, -.13, x, .13); }
  g.restore();
  ink(g, lw); nacelle(g); g.stroke();
  seg(g, .02, -.21, .02, .21); seg(g, .12, -.21, .12, .21);
  if (fine) { rivet(g, -.38, -.1, .025); rivet(g, -.38, .1, .025); }
  // mount plate on the left edge (its only socket), two bolts
  rr(g, -.5, -.3, .1, .6, .03); fillStroke(g, WOOD);
  nail(g, -.45, -.2, .024); nail(g, -.45, .2, .024);
  // propeller at the nose
  const hx = .34;
  if (on) {
    ell(g, hx, 0, .075, .44); g.fillStyle = 'rgba(251,245,232,.55)'; g.fill();
    detail(g, 'rgba(34,40,58,.4)', lw * .7); g.stroke();
    detail(g, 'rgba(255,255,255,.75)', lw * .6); g.beginPath(); g.ellipse(hx, 0, .045, .4, 0, 3.6, 4.6); g.stroke();
    const a = t * 31, c = Math.cos(a) * .41;
    g.globalAlpha = .55; ink(g, lw * .8); blade(g, hx, -c, lw, false); blade(g, hx, c, lw, false); g.globalAlpha = 1;
    ink(g, lw);
  } else { blade(g, hx, -.41, lw, fine); blade(g, hx, .41, lw, fine); }
  // spinner
  g.beginPath(); g.moveTo(.28, -.1); g.quadraticCurveTo(.44, -.075, .455, 0); g.quadraticCurveTo(.44, .075, .28, .1); g.closePath();
  fillStroke(g, RED);
  dot(g, .34, -.05, .022, 'rgba(255,255,255,.7)');
}

// --- rocket: a firework, striped paper tube, red cone at +x, tin fins and nozzle at -x.
//     Sockets: a nose mount plate at x=+0.5 and a clamp with arms to y=-0.5 and y=+0.5; the tail stays clear.
function tube(g) { rr(g, -.36, -.17, .56, .34, .03); }
function cone(g) { g.beginPath(); g.moveTo(.2, -.17); g.quadraticCurveTo(.36, -.15, .41, 0); g.quadraticCurveTo(.36, .15, .2, .17); g.closePath(); }
// one teardrop layer of the flame, scaled by k (1 = outer)
function flameLayer(g, k, x0, L, w, tip, c) {
  g.beginPath(); g.moveTo(x0, -w * k);
  g.quadraticCurveTo(x0 - L * k * .45, -w * k * 1.5, x0 - L * k, tip * k);
  g.quadraticCurveTo(x0 - L * k * .45, w * k * 1.5, x0, w * k); g.closePath();
  g.fillStyle = c; g.fill();
}
function flame(g, t, lw) {
  // flicker from layered sines of t (deterministic, no Math.random); reaches ~0.9 cell beyond -x
  const n = Math.sin(t * 53) * .5 + Math.sin(t * 31 + 1) * .3 + Math.sin(t * 97 + 2) * .2;
  const L = .78 + .17 * n, w = .15 + .02 * Math.sin(t * 71), x0 = -.45, tip = .04 * Math.sin(t * 43);
  flameLayer(g, 1, x0, L, w, tip, RED); ink(g, lw * .8); g.stroke();
  flameLayer(g, .72, x0, L, w, tip, BRASS); flameLayer(g, .4, x0, L, w, tip, CANVAS);
  // firework sparks trailing behind
  for (let i = 0; i < 5; i++) {
    const ph = (t * 2.3 + i / 5) % 1, cyc = Math.floor(t * 2.3 + i / 5);
    const x = x0 - .2 - ph * .85, y = Math.sin(i * 12.9 + cyc * 7.3) * .3 * ph;
    star4(g, x, y, .05 * (1 - ph) + .012, i % 2 ? BRASS : CANVAS);
  }
}
function star4(g, x, y, r, c) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + r * .3, y + r * .3); g.lineTo(x, y + r); g.lineTo(x - r * .3, y + r * .3);
  g.lineTo(x - r, y); g.lineTo(x - r * .3, y - r * .3); g.lineTo(x, y - r); g.lineTo(x + r * .3, y - r * .3); g.closePath();
  g.fillStyle = c; g.fill();
}
function rocket(g, t, lw, fine, on) {
  if (on) flame(g, t, lw);
  ink(g, lw);
  // fins (tin), the bottom one a little bent
  g.beginPath(); g.moveTo(-.1, -.16); g.lineTo(-.34, -.42); g.lineTo(-.44, -.42); g.lineTo(-.4, -.16); g.closePath(); fillStroke(g, TIN);
  g.beginPath(); g.moveTo(-.1, .16); g.lineTo(-.36, .4); g.lineTo(-.45, .38); g.lineTo(-.4, .16); g.closePath(); fillStroke(g, TIN);
  g.fillStyle = SHADE; g.beginPath(); g.moveTo(-.25, .16); g.lineTo(-.4, .33); g.lineTo(-.45, .38); g.lineTo(-.4, .16); g.closePath(); g.fill();
  // nozzle
  g.beginPath(); g.moveTo(-.35, -.1); g.lineTo(-.45, -.15); g.lineTo(-.45, .15); g.lineTo(-.35, .1); g.closePath(); fillStroke(g, TIN2);
  // clamp arms up and down to the top and bottom sockets (behind the tube)
  ink(g, lw); g.beginPath(); g.rect(.03, -.46, .06, .92); fillStroke(g, TIN2);
  mount(g, -.04, -.5, .2, .07, lw); mount(g, -.04, .43, .2, .07, lw);
  // paper tube with tilted red stripes
  tube(g); g.fillStyle = CANVAS; g.fill();
  g.save(); g.clip();
  g.fillStyle = RED;
  for (let x = -.42; x < .3; x += .17) { g.beginPath(); g.moveTo(x, .2); g.lineTo(x + .07, .2); g.lineTo(x + .15, -.2); g.lineTo(x + .08, -.2); g.closePath(); g.fill(); }
  g.fillStyle = SHADE; g.fillRect(-.4, .06, .7, .14);
  g.fillStyle = HI; g.fillRect(-.4, -.14, .7, .04);
  g.fillStyle = TIN; g.fillRect(-.37, -.2, .07, .4); // tin end band
  g.fillStyle = SHADE; g.fillRect(-.37, .06, .07, .14);
  g.restore();
  ink(g, lw); tube(g); g.stroke(); seg(g, -.3, -.17, -.3, .17);
  // clamp strap round the tube
  g.beginPath(); g.rect(.015, -.19, .09, .38); fillStroke(g, TIN);
  g.fillStyle = SHADE; g.fillRect(.015, .06, .09, .13); ink(g, lw); g.stroke();
  // nose cone, then the nose mount: a stub and a plate on the +x edge
  cone(g); g.fillStyle = RED; g.fill();
  g.save(); g.clip(); g.fillStyle = 'rgba(34,40,58,.2)'; g.fillRect(.2, .05, .3, .15); g.restore();
  ink(g, lw); cone(g); g.stroke();
  g.beginPath(); g.rect(.37, -.04, .09, .08); fillStroke(g, TIN2);
  mount(g, .44, -.11, .06, .22, lw);
  if (fine) {
    rivet(g, -.335, -.1, .02); rivet(g, -.335, .1, .02);
    detail(g, 'rgba(255,255,255,.7)', lw * .6); seg(g, .25, -.11, .32, -.09);
    // fuse curling off the back of the tube
    detail(g, INK, lw * .55); g.beginPath(); g.moveTo(-.2, -.17); g.quadraticCurveTo(-.2, -.26, -.12, -.27); g.stroke();
  }
}

// --- balloon: striped circus balloon on a string tied to a plate at y=+0.5
function bal(g, w) {
  // lens through the top and the knot; w = half width of the bulge
  g.beginPath(); g.moveTo(0, .25);
  g.bezierCurveTo(-w * 1.05, .04, -w * 1.1, -.45, 0, -.45);
  g.bezierCurveTo(w * 1.1, -.45, w * 1.05, .04, 0, .25); g.closePath();
}
function balloon(g, lw, fine) {
  // string tied to a plate on the bottom edge (its only socket)
  detail(g, INK, lw * .55); g.beginPath(); g.moveTo(0, .3); g.quadraticCurveTo(-.06, .37, .01, .44); g.stroke();
  mount(g, -.08, .44, .16, .06, lw);
  bal(g, .42); g.fillStyle = RED; g.fill();
  g.save(); g.clip();
  // gores: nested lenses alternate cream and red
  g.save(); g.translate(.02, 0);
  bal(g, .27); g.fillStyle = CANVAS; g.fill();
  bal(g, .11); g.fillStyle = RED; g.fill();
  g.restore();
  // shade crescent on the lower right
  g.fillStyle = SHADE; g.beginPath(); g.rect(-.6, -.6, 1.2, 1.2);
  g.moveTo(-.07, .19); g.bezierCurveTo(-.07 - .44, -.02, -.07 - .46, -.51, -.07, -.51); g.bezierCurveTo(-.07 + .46, -.51, -.07 + .44, -.02, -.07, .19); g.closePath();
  g.fill('evenodd');
  // highlight
  ell(g, -.2, -.27, .05, .1, .5); g.fillStyle = 'rgba(255,255,255,.7)'; g.fill();
  g.restore();
  // patch
  g.save(); g.translate(.2, -.06); g.rotate(.25);
  rr(g, -.07, -.065, .14, .13, .015); g.fillStyle = PAPER2; g.fill(); ink(g, lw * .7); g.stroke();
  if (fine) { detail(g, INK, lw * .4); rr(g, -.045, -.04, .09, .08, .01); stitch(g); }
  g.restore();
  ink(g, lw); bal(g, .42); g.stroke();
  // knot
  g.beginPath(); g.moveTo(-.01, .24); g.lineTo(-.06, .31); g.lineTo(.06, .31); g.lineTo(.02, .24); g.closePath(); fillStroke(g, RED2);
}

// --- cockpit: a wooden tub with a small windscreen inside an open wooden box frame; the goat sits
//     inside facing +x. Sockets on all four sides: the tub reaches the left, right and bottom edges,
//     the frame's posts and top rail reach the top edge (a wing mounted above lands on the rail).
const RIM = .12; // top of the tub wall; the goat's mouth stays above it
function tub(g) {
  g.beginPath(); g.moveTo(-.5, RIM + .01); g.lineTo(.5, RIM - .01); g.lineTo(.5, .36);
  g.quadraticCurveTo(.5, .5, .36, .5); g.lineTo(-.36, .5); g.quadraticCurveTo(-.5, .5, -.5, .36); g.closePath();
}
function boxFrame(g, lw, fine) {
  // two posts and a top rail, behind the goat
  ink(g, lw);
  g.beginPath(); g.rect(-.5, -.45, .07, RIM + .47); fillStroke(g, WOOD);
  g.beginPath(); g.rect(.43, -.45, .07, RIM + .47); fillStroke(g, WOOD);
  g.fillStyle = SHADE; g.fillRect(.465, -.43, .035, RIM + .43); ink(g, lw);
  g.beginPath(); g.moveTo(-.5, -.5); g.lineTo(.5, -.5); g.lineTo(.5, -.43); g.lineTo(-.5, -.425); g.closePath(); fillStroke(g, WOOD);
  g.fillStyle = WOOD3; g.fillRect(-.48, -.49, .96, .018);
  if (fine) { detail(g, WOOD2, lw * .45); grain(g, -.3, -.465, .25, .01); }
  nail(g, -.465, -.465, .02); nail(g, .465, -.465, .02); nail(g, 0, -.465, .024);
}
function cockpit(g, t, lw, fine, mood) {
  boxFrame(g, lw, fine);
  // the goat, big: its face is the main feedback channel; shoulders hide behind the tub wall
  const s = .76;
  g.save(); g.translate(-.06, -.13); g.scale(s, s);
  drawPilot(g, mood, t, { lw: lw / s * .85, scarf: .8, compact: true });
  g.restore();
  ink(g, lw);
  // windscreen: glass in a brass frame
  g.beginPath(); g.moveTo(.25, RIM); g.lineTo(.3, -.07); g.lineTo(.4, -.07); g.lineTo(.42, RIM); g.closePath();
  g.fillStyle = 'rgba(207,232,230,.65)'; g.fill(); g.stroke();
  detail(g, BRASS, lw * .9); seg(g, .31, -.07, .39, -.07);
  detail(g, 'rgba(255,255,255,.9)', lw * .6); seg(g, .32, .08, .34, -.02);
  // the tub
  ink(g, lw); tub(g); g.fillStyle = WOOD; g.fill();
  g.save(); g.clip();
  g.fillStyle = SHADE; g.fillRect(-.5, .38, 1, .2); g.fillRect(.36, 0, .2, .6);
  detail(g, 'rgba(34,40,58,.55)', lw * .6); seg(g, -.5, .325, .5, .32); // plank seam
  if (fine) {
    detail(g, WOOD2, lw * .45); grain(g, .02, .27, .3, .015); grain(g, -.1, .41, .3, -.02);
    nail(g, -.43, .4, .02); nail(g, .43, .4, .02);
  }
  nail(g, -.44, .27, .024); nail(g, .44, .27, .024); nail(g, .1, .44, .024); // bolts at the side and bottom sockets
  // red painted rim
  g.fillStyle = RED; g.beginPath(); g.moveTo(-.5, RIM); g.lineTo(.5, RIM - .02); g.lineTo(.5, RIM + .08); g.lineTo(-.5, RIM + .1); g.closePath(); g.fill();
  ink(g, lw * .8); seg(g, -.5, RIM + .1, .5, RIM + .08);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(-.5, RIM + .01, 1, .025);
  g.restore();
  // circus star decal on the side
  ell(g, -.22, .33, .08, .075); g.fillStyle = CANVAS; g.fill(); ink(g, lw * .7); g.stroke();
  star5(g, -.22, .335, .058); g.fillStyle = RED; g.fill();
  ink(g, lw); tub(g); g.stroke();
}
// five-point star path
function star5(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r * .45 : r; g.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k); }
  g.closePath();
}

/* ---------------- the goat pilot ---------------- */
// Head and shoulders, centred at the origin in a ~1x1 box, facing +x in a three-quarter view.
// Moods read mainly through eyes, mouth, ears and goggles. Options:
//   o.lw      outline width in these units (default 0.04)
//   o.scarf   scarf tail length factor (default 1; the tail trails to about x=-0.7)
//   o.compact keep mood effects (dizzy stars, crash smoke) inside the box, as the cockpit does
// Ear angles per mood: [back ear (left), front ear (right)], radians, 0 = +x, positive = down.
const EARS = {
  idle: [Math.PI - .3, -.35], focus: [Math.PI + .12, -.75], grin: [Math.PI + .6, -1.1], scared: [Math.PI + .8, -1.45],
  dizzy: [Math.PI + .4, .7], cheer: [Math.PI + .7, -.95], crash: [Math.PI - .9, .45], sad: [Math.PI - 1.25, 1.15],
};
// face anchors
const E1X = .03, E1Y = -.025, E2X = .19, E2Y = -.045; // near eye, far eye

export function drawPilot(g, mood, t, o) {
  o = o || {}; t = t || 0;
  if (!EARS[mood]) mood = 'idle';
  // the goat has many small shapes: below ~40 px the outline is capped (and face lines thinner still)
  // so a tiny goat keeps its cream face instead of filling in with ink
  const lw = Math.min(o.lw || .04, .065), fine = (o.lw || .04) < .075, fw = Math.min(lw, .05);
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; ink(g, lw);
  jacket(g, lw, fine);
  if (mood === 'scared') g.translate(Math.sin(t * 57) * .007, 0); // trembling
  scarf(g, t * (mood === 'grin' ? 15 : 9), lw, o.scarf == null ? 1 : o.scarf); // flutters faster at speed
  const ea = EARS[mood];
  ear(g, -.19, -.1, ea[0], lw, fine);
  ear(g, .14, -.17, ea[1], lw, fine);
  head(g, lw);
  const askew = mood === 'crash';
  if (askew) { g.save(); g.translate(-.02, -.28); g.rotate(-.24); g.translate(.02, .28); }
  cap(g, lw, fine);
  if (mood !== 'focus' && fine) goggles(g, false, lw, askew); // pushed-up goggles only when there is room
  if (askew) g.restore();
  horns(g, lw, fine);
  face(g, mood, t, fw);
  beard(g, lw);
  if (mood === 'focus') goggles(g, true, fw, false);
  extras(g, mood, t, fw, !!o.compact);
  g.restore();
}

// scarf: a band round the neck, knotted at the back, the tail trailing toward -x and waving with t
const SC_N = 6;
function scarfY(t, i, k) { return .28 - .045 * i / SC_N + Math.sin(t - i * 1.15) * .055 * (i / SC_N) + k; }
function scarf(g, t, lw, len) {
  // t here is already the wave phase (time x flutter speed)
  g.beginPath(); g.moveTo(-.23, .25); g.quadraticCurveTo(0, .33, .25, .24); g.lineTo(.25, .33);
  g.quadraticCurveTo(0, .42, -.22, .35); g.closePath(); fillStroke(g, RED);
  g.save(); g.clip(); g.fillStyle = RED2; g.fillRect(-.3, .35, .6, .1); g.restore(); g.stroke();
  const x0 = -.2, x1 = x0 - .48 * len;
  g.beginPath();
  for (let i = 0; i <= SC_N; i++) { const x = x0 + (x1 - x0) * i / SC_N, w = .055 - .015 * i / SC_N; i ? g.lineTo(x, scarfY(t, i, -w)) : g.moveTo(x, scarfY(t, i, -w)); }
  g.lineTo(x1 + .06, scarfY(t, SC_N, 0)); // swallowtail notch
  for (let i = SC_N; i >= 0; i--) { const x = x0 + (x1 - x0) * i / SC_N, w = .055 - .015 * i / SC_N; g.lineTo(x, scarfY(t, i, w)); }
  g.closePath(); fillStroke(g, RED);
  detail(g, RED2, lw * .9); g.beginPath();
  for (let i = 1; i < SC_N; i++) { const x = x0 + (x1 - x0) * i / SC_N, w = .055 - .015 * i / SC_N; i > 1 ? g.lineTo(x, scarfY(t, i, w * .4)) : g.moveTo(x, scarfY(t, i, w * .4)); }
  g.stroke(); ink(g, lw);
  ell(g, -.19, .3, .055, .05, .3); fillStroke(g, RED2); // knot
}
function jacket(g, lw, fine) {
  g.beginPath(); g.moveTo(-.4, .52); g.quadraticCurveTo(-.38, .3, -.18, .27); g.lineTo(.22, .27);
  g.quadraticCurveTo(.4, .3, .42, .52); g.closePath(); g.fillStyle = LEATHER; g.fill();
  g.save(); g.clip(); g.fillStyle = LEATHER2; g.fillRect(.18, .25, .3, .3); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-.4, .27, .5, .05); g.restore();
  g.stroke();
  // shearling collar
  g.beginPath(); g.moveTo(-.26, .3); g.quadraticCurveTo(-.2, .4, -.08, .36); g.lineTo(-.08, .28); g.closePath(); fillStroke(g, FUR2);
  g.beginPath(); g.moveTo(.3, .31); g.quadraticCurveTo(.25, .41, .14, .37); g.lineTo(.14, .28); g.closePath(); fillStroke(g, FUR2);
  if (fine) { detail(g, LEATHER2, lw * .6); seg(g, .03, .38, .03, .52); ink(g, lw); }
}
function ear(g, bx, by, a, lw, fine) {
  // floppy leaf-shaped ear from base (bx,by), pointing along angle a
  const L = .24, W = .085, c = Math.cos(a), s = Math.sin(a), tx = bx + c * L, ty = by + s * L, px = -s * W, py = c * W;
  g.beginPath(); g.moveTo(bx + px * .5, by + py * .5);
  g.quadraticCurveTo(bx + c * L * .55 + px * 1.3, by + s * L * .55 + py * 1.3, tx, ty);
  g.quadraticCurveTo(bx + c * L * .55 - px * 1.1, by + s * L * .55 - py * 1.1, bx - px * .5, by - py * .5);
  g.closePath(); fillStroke(g, FUR);
  if (fine) {
    g.beginPath(); g.moveTo(bx + c * .05, by + s * .05);
    g.quadraticCurveTo(bx + c * L * .55 + px * .45, by + s * L * .55 + py * .45, bx + c * L * .85, by + s * L * .85);
    g.quadraticCurveTo(bx + c * L * .55 - px * .25, by + s * L * .55 - py * .25, bx + c * .05, by + s * .05);
    g.fillStyle = PINK; g.fill();
  }
}
function headPath(g, dx, dy) {
  // cranium + muzzle (two ellipses in one path, nonzero fill = union)
  g.beginPath(); g.ellipse(dx, -.08 + dy, .26, .25, 0, 0, TAU);
  g.moveTo(.15 + dx + .19, .11 + dy); g.ellipse(.15 + dx, .11 + dy, .19, .14, .32, 0, TAU);
}
function head(g, lw) {
  // union outline: stroke both shapes at double width, then fill over the inner half
  ink(g, lw * 2); headPath(g, 0, 0); g.stroke();
  g.fillStyle = FUR2; g.fill();
  g.save(); g.clip(); headPath(g, -.035, -.045); g.fillStyle = FUR; g.fill(); g.restore();
  ink(g, lw);
}
function cap(g, lw, fine) {
  // leather aviator cap over the top of the head, brim across the forehead, ear flap on the left
  g.beginPath(); g.ellipse(0, -.08, .275, .265, 0, Math.PI * .96, Math.PI * 1.89);
  g.quadraticCurveTo(.05, -.06, -.272, -.06); g.closePath();
  g.fillStyle = LEATHER; g.fill();
  g.save(); g.clip();
  g.fillStyle = LEATHER2; g.beginPath(); g.ellipse(.14, -.04, .2, .2, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.ellipse(-.1, -.27, .12, .05, -.4, 0, TAU); g.fill();
  if (fine) { detail(g, 'rgba(255,240,220,.55)', lw * .5); g.beginPath(); g.ellipse(.02, -.08, .2, .25, 0, Math.PI * 1.05, Math.PI * 1.6); stitch(g); }
  g.restore();
  ink(g, lw); g.stroke();
  // ear flap
  ell(g, -.205, -.07, .075, .095, .2); fillStroke(g, LEATHER);
  if (fine) dot(g, -.2, -.05, .018, BRASS);
}
function horn(g, bx, by, tx, ty, w, lw, fine) {
  // a crescent from a base on the cap to a tip swept back toward -x
  g.beginPath(); g.moveTo(bx + w, by);
  g.bezierCurveTo(bx + w * 1.4, by - .1, tx + .08, ty - .03, tx, ty);       // front edge bulges forward
  g.bezierCurveTo(tx + .05, ty + .03, bx - w * .2, by - .08, bx - w, by);  // inner edge
  g.closePath(); fillStroke(g, HORN);
  if (fine) { detail(g, HORN2, lw * .6); seg(g, bx - w * .6, by - .035, bx + w * 1.05, by - .04); seg(g, bx - w * .1, by - .08, bx + w * 1.1, by - .09); ink(g, lw); }
}
function horns(g, lw, fine) {
  // small horns poking up through the cap
  horn(g, -.09, -.29, -.25, -.44, .043, lw, fine);
  horn(g, .07, -.31, -.08, -.48, .048, lw, fine);
}
function goggles(g, down, lw, cracked) {
  // brass-ring goggles. Down: round, over the eyes, the eyes show through the glass.
  // Up: lying back on the cap, so squashed ovals with tinted glass (they must never read as a second pair of eyes)
  const ax = down ? E1X : -.035, ay = down ? E1Y : -.235, bx = down ? E2X : .12, by = down ? E2Y : -.25;
  const ra = down ? .085 : .066, rb = down ? .076 : .058, sq = down ? 1 : .62, ring = down ? .03 : .024;
  // strap round the head, bridge between the lenses
  ink(g, lw * 2 + .035); g.beginPath(); g.moveTo(ax - ra, ay); g.lineTo(-.27, ay + (down ? .03 : .1)); g.stroke();
  detail(g, LEATHER2, .035); g.stroke();
  ink(g, lw); seg(g, ax + ra, ay - .005, bx - rb, by - .005);
  for (let i = 0; i < 2; i++) {
    const x = i ? bx : ax, y = i ? by : ay, r = i ? rb : ra;
    ell(g, x, y, r, r * sq, down ? 0 : -.08); g.fillStyle = down ? 'rgba(150,212,220,.35)' : TEAL; g.fill();
    ink(g, ring + lw * 1.6); g.stroke(); detail(g, BRASS, ring); g.stroke();
    detail(g, 'rgba(255,255,255,.9)', lw * .8); g.beginPath(); g.ellipse(x, y, r * .55, r * .55 * sq, 0, 3.5, 4.5); g.stroke();
  }
  ink(g, lw);
  if (cracked) { detail(g, CANVAS, lw * .6); g.beginPath(); g.moveTo(bx - .03, by - .02); g.lineTo(bx, by - .005); g.lineTo(bx - .01, by + .01); g.lineTo(bx + .025, by + .02); g.stroke(); ink(g, lw); }
}

// one eye. p: lid (0..1 covered from the top), tilt (+ = outer corner lower), lx/ly look (-1..1),
// iris scale, sq (lower-lid squint 0..1), pup: SLIT (goat), ROUND (soft, happy) or DOT (small, scared).
// side: -1 near eye, +1 far eye.
const SLIT = 0, ROUND = 1, DOT = 2;
function eye(g, x, y, rx, ry, side, p, lw) {
  ell(g, x, y, rx, ry); g.fillStyle = '#fff'; g.fill();
  g.save(); g.clip();
  const ix = x + p.lx * rx * .5, iy = y + p.ly * ry * .5;
  if (p.pup === DOT) dot(g, ix, iy, ry * .26, INK);
  else {
    const ir = ry * .62 * p.iris;
    circ(g, ix, iy, ir); g.fillStyle = BRASS; g.fill();
    if (p.pup === ROUND) { dot(g, ix, iy, ir * .6, INK); dot(g, ix - ir * .28, iy - ir * .3, ir * .3, '#fff'); }
    else {
      rr(g, ix - ir * .78, iy - ir * .24, ir * 1.56, ir * .48, ir * .2); g.fillStyle = INK; g.fill(); // goat pupil
      dot(g, ix - ir * .35, iy - ir * .45, ir * .2, '#fff');
    }
  }
  if (p.lid > 0) {
    const ly = y - ry + 2 * ry * p.lid, yl = ly - p.tilt * side, yr = ly + p.tilt * side;
    g.beginPath(); g.moveTo(x - rx - .02, y - ry - .03); g.lineTo(x + rx + .02, y - ry - .03); g.lineTo(x + rx + .02, yr); g.lineTo(x - rx - .02, yl); g.closePath();
    g.fillStyle = FUR; g.fill(); ink(g, lw * .8); seg(g, x - rx - .02, yl, x + rx + .02, yr);
  }
  if (p.sq > 0) {
    const R = ry * 1.25, cy = y + ry * (1.95 - .9 * p.sq);
    circ(g, x, cy, R); g.fillStyle = FUR; g.fill(); ink(g, lw * .8); g.stroke();
  }
  g.restore();
  ink(g, lw * .85); ell(g, x, y, rx, ry); g.stroke(); ink(g, lw);
}
function closedEye(g, x, y, rx, kind, lw) {
  ink(g, lw * 1.1); g.beginPath();
  if (kind === 'happy') g.arc(x, y + rx * .45, rx * .85, Math.PI * 1.1, Math.PI * 1.9);      // ∩
  else if (kind === 'blink') g.arc(x, y - rx * .6, rx * .9, Math.PI * .2, Math.PI * .8);     // ‿
  else if (kind === 'wince') { const r = rx * .8, s = x < (E1X + E2X) / 2 ? 1 : -1; g.moveTo(x - s * r, y - r * .75); g.lineTo(x + s * r * .65, y); g.lineTo(x - s * r, y + r * .75); } // > <
  g.stroke(); ink(g, lw);
}
function spiralEye(g, x, y, r, a0, lw) {
  ell(g, x, y, r, r * 1.08); g.fillStyle = '#fff'; g.fill(); ink(g, lw * .85); g.stroke();
  ink(g, lw * .6); g.beginPath(); // 1.6 turns stay open enough to read at small sizes
  for (let i = 0; i <= 24; i++) { const k = i / 24, a = a0 + k * TAU * 1.6, rr2 = r * .82 * k; i ? g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2) : g.moveTo(x, y); }
  g.stroke(); ink(g, lw);
}
const P = {}; // scratch eye params (reused, no allocation)
function eyeP(lid, tilt, lx, ly, iris, sq, pup) { P.lid = lid; P.tilt = tilt; P.lx = lx; P.ly = ly; P.iris = iris; P.sq = sq; P.pup = pup; return P; }
function eyes(g, lid, tilt, lx, ly, iris, sq, pup, big, lw) {
  eye(g, E1X, E1Y, .062 * big, .07 * big, -1, eyeP(lid, tilt, lx, ly, iris, sq, pup), lw);
  eye(g, E2X, E2Y, .052 * big, .064 * big, 1, eyeP(lid, tilt, lx, ly, iris, sq, pup), lw);
}
function nose(g, lw) {
  // nose pad and nostrils at the front of the muzzle, plus the split upper lip
  ell(g, .285, .085, .045, .03, .3); g.fillStyle = PINK; g.fill();
  ink(g, lw * .8); seg(g, .265, .075, .28, .09); seg(g, .305, .07, .315, .085);
  seg(g, .3, .105, .295, .14); ink(g, lw);
}
function face(g, mood, t, lw) {
  if (mood === 'grin' || mood === 'cheer') { ell(g, -.04, .08, .055, .035); g.fillStyle = 'rgba(236,140,120,.45)'; g.fill(); }
  switch (mood) {
    case 'idle': {
      if (t % 3.7 < .13) { closedEye(g, E1X, E1Y, .062, 'blink', lw); closedEye(g, E2X, E2Y, .052, 'blink', lw); }
      else eyes(g, .32, .0, .25, .1, 1, 0, SLIT, 1, lw);
      nose(g, lw);
      ink(g, lw * .9); g.beginPath(); g.moveTo(.295, .145); g.quadraticCurveTo(.22, .2, .13, .165); g.stroke();
      break;
    }
    case 'focus': {
      eyes(g, .38, -.025, .45, 0, 1, .15, SLIT, 1, lw);
      nose(g, lw);
      // firm mouth, tongue tip poking out in concentration
      ell(g, .285, .18, .03, .022, .5); fillStroke(g, PINK);
      ink(g, lw * .9); g.beginPath(); g.moveTo(.315, .15); g.quadraticCurveTo(.22, .17, .12, .16); g.stroke(); ink(g, lw);
      break;
    }
    case 'grin': {
      // "wheee": soft squinting eyes, a big closed smile, two buck teeth peeking out
      eyes(g, 0, 0, .3, .05, 1, .58, ROUND, 1.05, lw);
      nose(g, lw);
      rr(g, .205, .17, .062, .048, .012); fillStroke(g, '#fff');
      ink(g, lw * .6); seg(g, .236, .175, .236, .215);
      ink(g, lw); g.beginPath(); g.moveTo(.318, .135); g.quadraticCurveTo(.2, .25, .07, .125); g.stroke();
      ink(g, lw * .8); g.beginPath(); g.arc(.055, .14, .025, -1.9, -.2); g.stroke(); ink(g, lw); // cheek dimple
      break;
    }
    case 'scared': {
      eyes(g, 0, 0, 0, 0, 0, 0, DOT, 1.25, lw);
      nose(g, lw);
      ell(g, .21, .205, .055, .062, .15); g.fillStyle = MOUTH; g.fill();
      g.save(); g.clip(); ell(g, .215, .265, .05, .03); g.fillStyle = PINK; g.fill(); g.restore(); g.stroke();
      rr(g, .19, .14, .05, .035, .01); fillStroke(g, '#fff'); ink(g, lw * .6); seg(g, .215, .145, .215, .175); ink(g, lw);
      break;
    }
    case 'dizzy': {
      spiralEye(g, E1X, E1Y, .065, t * 7, lw); spiralEye(g, E2X, E2Y, .055, -t * 7 + 1, lw);
      nose(g, lw);
      // wobbly mouth + tongue lolling out the side
      g.beginPath(); g.moveTo(.29, .25); g.quadraticCurveTo(.31, .33, .26, .34); g.quadraticCurveTo(.22, .33, .23, .21); g.closePath();
      fillStroke(g, PINK); ink(g, lw * .5); seg(g, .265, .23, .27, .3);
      ink(g, lw * .9); g.beginPath(); g.moveTo(.31, .16); g.quadraticCurveTo(.27, .2, .23, .18); g.quadraticCurveTo(.18, .16, .12, .19); g.stroke();
      ink(g, lw);
      break;
    }
    case 'cheer': {
      closedEye(g, E1X, E1Y, .065, 'happy', lw); closedEye(g, E2X, E2Y, .055, 'happy', lw);
      nose(g, lw);
      g.beginPath(); g.moveTo(.32, .13); g.lineTo(.06, .12); g.quadraticCurveTo(.1, .36, .28, .26); g.quadraticCurveTo(.33, .2, .32, .13); g.closePath();
      g.fillStyle = MOUTH; g.fill();
      g.save(); g.clip();
      g.fillStyle = '#fff'; g.fillRect(.0, .1, .4, .055);
      ell(g, .19, .265, .085, .05); g.fillStyle = PINK; g.fill();
      g.restore(); g.stroke();
      break;
    }
    case 'crash': {
      closedEye(g, E1X, E1Y, .06, 'wince', lw); closedEye(g, E2X, E2Y, .052, 'wince', lw);
      nose(g, lw);
      ink(g, lw * .9); g.beginPath(); g.moveTo(.31, .17); g.quadraticCurveTo(.28, .14, .25, .17); g.quadraticCurveTo(.22, .2, .19, .17); g.quadraticCurveTo(.16, .14, .13, .17); g.stroke(); ink(g, lw);
      break;
    }
    case 'sad': {
      eyes(g, .5, .045, .2, .8, 1, 0, SLIT, 1, lw);
      nose(g, lw);
      ink(g, lw * .9); g.beginPath(); g.moveTo(.29, .2); g.quadraticCurveTo(.22, .15, .15, .2); g.stroke(); ink(g, lw);
      break;
    }
  }
}
function beard(g, lw) {
  // goatee tuft hanging from the chin, over the scarf
  g.beginPath(); g.moveTo(.04, .215); g.quadraticCurveTo(.05, .3, .09, .36); g.lineTo(.08, .38); g.quadraticCurveTo(.1, .4, .13, .44);
  g.quadraticCurveTo(.15, .37, .2, .3); g.quadraticCurveTo(.22, .26, .21, .235); g.quadraticCurveTo(.12, .255, .04, .215); g.closePath();
  g.fillStyle = FUR; g.fill();
  g.save(); g.clip(); g.fillStyle = FUR2; g.fillRect(.14, .2, .1, .26); g.restore(); g.stroke();
}
function extras(g, mood, t, lw, compact) {
  // compact: keep the effects inside the 1x1 box (used inside the cockpit cell)
  if (mood === 'scared') { // sweat drop
    g.beginPath(); g.moveTo(-.3, -.27); g.quadraticCurveTo(-.25, -.19, -.28, -.16); g.quadraticCurveTo(-.33, -.15, -.33, -.2); g.closePath(); fillStroke(g, '#bfe4ea');
  } else if (mood === 'sad') { // tear
    const y = .02 + (t * .12 % .12);
    g.beginPath(); g.moveTo(-.02, y); g.quadraticCurveTo(.02, y + .06, -.01, y + .08); g.quadraticCurveTo(-.05, y + .07, -.02, y); g.closePath(); fillStroke(g, '#bfe4ea');
  } else if (mood === 'dizzy') { // stars orbiting the horns
    for (let i = 0; i < 3; i++) {
      const a = t * 3 + i * TAU / 3, x = Math.cos(a) * .3, y = (compact ? -.4 : -.47) + Math.sin(a) * (compact ? .035 : .06);
      star5(g, x, y, .055); g.fillStyle = BRASS; g.fill(); ink(g, lw * .7); g.stroke(); ink(g, lw);
    }
  } else if (mood === 'crash') { // soot smudges and a wisp of smoke
    g.fillStyle = SOOT; ell(g, -.1, .05, .07, .04, -.3); g.fill(); ell(g, .24, .14, .05, .03, .4); g.fill(); ell(g, .08, -.13, .045, .025); g.fill();
    for (let i = 0; i < 2; i++) { // smoke puffs rising off the cap
      const k = (t * .7 + i * .5) % 1;
      g.globalAlpha = 1 - k; circ(g, .2 + Math.sin(k * 5 + i) * .04, compact ? -.33 - k * .1 : -.36 - k * .22, compact ? .03 + .02 * k : .03 + .045 * k);
      g.fillStyle = TIN; g.fill(); ink(g, lw * .7); g.stroke();
    }
    g.globalAlpha = 1; ink(g, lw);
  } else if (mood === 'grin') { // speed streaks behind the head
    detail(g, 'rgba(34,40,58,.55)', lw * .8);
    for (let i = 0; i < 3; i++) { const y = -.03 + i * .075, x1 = -.31 - i * .025, L = .1 + .04 * Math.sin(t * 19 + i * 2); seg(g, x1 - L, y, x1, y); }
    ink(g, lw);
  } else if (mood === 'cheer') { // two sparkles
    const k = .7 + .3 * Math.sin(t * 8);
    star4(g, .36, -.3, .06 * k, BRASS); star4(g, -.36, -.36, .045 * (1.7 - k), BRASS);
  }
}
/* ---------------- parachute ---------------- */
// The goat hanging under a patched red/cream canopy. The goat's head-and-shoulders box (1 unit, as in
// drawPilot) is centred at the origin; the canopy is above (top near y=-2.4, hem at y=-1.55, x within
// +-1.2), the legs dangle to about y=+1.1. o.lw outline width (default 0.04), o.mood (default 'crash').
const CHUTE = [-1.15, -.72, -.25, .25, .72, 1.15]; // scallop points along the canopy hem (x)
const HEM = -1.55;
function chuteDome(g) {
  g.beginPath(); g.moveTo(-1.15, HEM);
  g.bezierCurveTo(-1.2, -2.55, 1.2, -2.55, 1.15, HEM);
  for (let i = CHUTE.length - 1; i > 0; i--) { const a = CHUTE[i], b = CHUTE[i - 1]; g.quadraticCurveTo((a + b) / 2, HEM - .14, b, HEM); }
  g.closePath();
}
export function drawParachute(g, t, o) {
  o = o || {}; t = t || 0;
  const lw = o.lw || .04, fine = lw < .075, mood = o.mood || 'crash';
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  // gentle pendulum sway about the canopy
  g.translate(0, -1.9); g.rotate(Math.sin(t * 1.4) * .07); g.translate(0, 1.9);
  // rigging lines: hem to the hooves, hooves down to the harness belt
  detail(g, INK, lw * .5); g.beginPath();
  for (let i = 0; i < CHUTE.length; i++) { const x = CHUTE[i]; g.moveTo(x, HEM); g.lineTo(x < 0 ? -.34 : .34, -.08); }
  g.moveTo(-.34, -.08); g.lineTo(-.3, .6); g.moveTo(.34, -.08); g.lineTo(.3, .6);
  g.stroke();
  // canopy: cream with red gores fanning from above the apex
  ink(g, lw); chuteDome(g); g.fillStyle = CANVAS; g.fill();
  g.save(); g.clip();
  g.fillStyle = RED;
  for (let i = 0; i < CHUTE.length - 1; i += 2) {
    g.beginPath(); g.moveTo(0, -3.1); g.lineTo(CHUTE[i] * 1.12, HEM + .1); g.lineTo(CHUTE[i + 1] * 1.12, HEM + .1); g.closePath(); g.fill();
  }
  g.fillStyle = SHADE; g.beginPath(); g.ellipse(.75, -1.5, .7, 1.1, 0, 0, TAU); g.fill();
  detail(g, 'rgba(255,255,255,.75)', lw * 1.3); g.beginPath(); g.ellipse(0, -1.62, .98, .7, 0, Math.PI * 1.15, Math.PI * 1.42); g.stroke();
  if (fine) { detail(g, 'rgba(34,40,58,.5)', lw * .5); for (let i = 1; i < CHUTE.length - 1; i++) { g.beginPath(); g.moveTo(0, -3.1); g.lineTo(CHUTE[i] * 1.12, HEM + .1); g.stroke(); } }
  g.restore();
  ink(g, lw); chuteDome(g); g.stroke();
  // vent cap, a stitched patch and a strip of tape
  ell(g, 0, -2.29, .14, .05); fillStroke(g, RED2);
  g.save(); g.translate(-.45, -1.95); g.rotate(-.18);
  rr(g, -.15, -.12, .3, .24, .02); g.fillStyle = PAPER2; g.fill(); ink(g, lw * .8); g.stroke();
  if (fine) { detail(g, INK, lw * .5); rr(g, -.11, -.08, .22, .16, .015); stitch(g); }
  g.restore();
  tape(g, .62, -1.78, .34, .1, .5, lw);
  // the goat: dangling legs, jacket body, arms up to the lines, then head and shoulders
  const sw = Math.sin(t * 2.1) * .06;
  for (let i = 0; i < 2; i++) {
    const x = i ? .1 : -.12, x2 = x + sw * (i ? -1 : 1) - .03;
    ink(g, .1 + lw * 2); seg(g, x, .6, x2, 1.0); detail(g, FUR, .1); seg(g, x, .6, x2, 1.0);
    detail(g, FUR2, .035); seg(g, x + .03, .62, x2 + .03, .98);
    ink(g, lw); rr(g, x2 - .07, .98, .14, .09, .03); fillStroke(g, INK);
  }
  rr(g, -.33, .3, .66, .42, .1); g.fillStyle = LEATHER; g.fill();
  g.save(); g.clip(); g.fillStyle = LEATHER2; g.fillRect(.14, .3, .22, .45); g.restore();
  ink(g, lw); g.stroke();
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    ink(g, .11 + lw * 2); seg(g, s * .26, .38, s * .34, -.02); detail(g, LEATHER, .11); seg(g, s * .26, .38, s * .34, -.02);
    ink(g, lw); ell(g, s * .34, -.06, .065, .055); fillStroke(g, INK);
  }
  drawPilot(g, mood, t, { lw });
  // harness belt with a brass buckle
  ink(g, lw); g.beginPath(); g.rect(-.33, .57, .66, .07); fillStroke(g, TIN2);
  rr(g, -.06, .55, .12, .11, .02); fillStroke(g, BRASS);
  g.restore();
}
