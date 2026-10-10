// How-to-play drawer: a swipeable slide show that explains the parts of the game a player would not guess.
// Content only; ui.js passes in the part icons and opens it from the title screen and the hangar.
let ICON = {}, onSeen = () => {};
const $ = (id) => document.getElementById(id);
const img = (t, cls = '') => `<img class="${cls}" alt="" src="${ICON[t]}">`;

/* ---------- illustrations (small HTML/SVG pictures, styled in style.css under .gr-) ---------- */
const artRun = () => `<div class="gr-run">
  <div class="gr-pips">${Array.from({ length: 8 }, (_, i) => `<i class="${i < 2 ? 'done' : i === 2 ? 'now storm' : i === 5 || i === 7 ? 'storm' : ''}">${i + 1}</i>`).join('')}</div>
  <div class="gr-flights"><span class="label">Contract 3</span><span class="fpips"><i class="used"></i><i class="used"></i><i></i></span></div>
  <div class="cbar"><i style="transform:scaleX(.72)"></i><span>1,440 / 2,000</span></div></div>`;
const artScore = () => `<div class="gr-eq"><b>1,240 m</b><span>×</span><b class="m">1.55</b><span>=</span><b class="t">1,922</b></div>
  <div class="gr-chips"><span>Touchdown +0.5</span><span>Loop +0.5</span><span>Low pass +0.25</span><span>Thermal +0.1</span><span>Coin +0.05</span><span>Mach +1</span><span>Space +2</span></div>`;
const artPacks = () => `<div class="gr-packs"><div class="gr-pack"><div class="pk-face"><div class="pk-mark">?</div><div class="pk-band">PARTS</div></div></div>
  <svg class="gr-arrow" viewBox="0 0 40 20" aria-hidden="true"><path d="M2 10h30M26 4l8 6-8 6"/></svg>
  <div class="gr-four">${img('tank')}${img('wing')}${img('prop')}<span>?</span></div></div>
  <div class="gr-row"><span class="label">Contract 1</span><b>4 packs</b><span class="label">Then</span><b>2 per contract</b></div>`;
const artShop = () => `<div class="gr-shop"><div>${img('frame')}<b><i class="cn"></i>3</b></div><div><span class="glyph C">+</span><b><i class="cn"></i>4</b></div><div><span class="glyph R">S</span><b><i class="cn"></i>5</b></div></div>
  <div class="gr-coins"><span><i class="cn"></i>3 per flight</span><span><i class="cn"></i>coins in the air</span><span><i class="cn"></i>6+ per cleared contract</span></div>`;
// a small bench: amber bolts where parts connect, and a balloon that touches nothing structural (loose, so it stays behind)
function artBuild() {
  const L = { '1,0': 'wing', '2,0': 'wing', '0,1': 'rocket', '1,1': 'cockpit', '2,1': 'frame', '3,1': 'prop', '1,2': 'tank', '4,0': 'balloon' };
  let h = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    const t = L[c + ',' + r];
    h += `<i class="${t ? 'on' : ''}${t === 'cockpit' ? ' cock' : ''}${t === 'balloon' ? ' loose' : ''}${c === 4 && r === 1 ? ' free' : ''}">${t ? img(t) : ''}</i>`;
  }
  // joints as [column, row] of the edge midpoint, in cells; one cell is 44 px plus a 3 px gap
  const at = (u) => u * 47 - 1.5;
  const bolts = [[1.5, 1], [2.5, 1], [1, 1.5], [2, 1.5], [3, 1.5], [1.5, 2]].map(([x, y]) => `<circle cx="${at(x)}" cy="${at(y)}" r="4.5"/>`).join('');
  return `<div class="gr-bench"><div class="gr-grid">${h}</div><svg class="gr-bolts" viewBox="0 0 232 138" aria-hidden="true">${bolts}</svg></div>
  <div class="legend" style="justify-content:center"><span><i class="gr-bolt"></i>Bolt</span><span><i class="gr-loose"></i>Loose</span><span><i class="gr-free"></i>Keep free</span><span>Nose →</span></div>`;
}
// side view: wing above the cockpit, mass marker just ahead of the lift arrow
const balanceSvg = (liftX, ok) => `<svg viewBox="0 0 120 92" class="gr-bal ${ok ? 'ok' : 'bad'}" aria-hidden="true">
  <image href="${ICON.wing}" x="22" y="6" width="34" height="34"/><image href="${ICON.cockpit}" x="22" y="38" width="34" height="34"/>
  <image href="${ICON.frame}" x="54" y="38" width="34" height="34"/><image href="${ICON.prop}" x="86" y="38" width="34" height="34"/>
  <g class="col"><line x1="${liftX}" y1="58" x2="${liftX}" y2="30"/><path d="M${liftX - 5} 33L${liftX} 24L${liftX + 5} 33Z"/></g>
  <circle cx="62" cy="58" r="6" class="c0"/><path d="M62 58h6a6 6 0 0 1-6 6zM62 58h-6a6 6 0 0 1 6-6z" class="c1"/>
  <text x="60" y="88">${ok ? '✓' : '✗'}</text></svg>`;
const artBalance = () => `<div class="gr-bals">${balanceSvg(50, true)}${balanceSvg(78, false)}</div>
  <div class="legend" style="justify-content:center"><span><i class="lg-com"></i>Mass</span><span><i class="lg-col"></i>Lift</span></div>`;
const artFly = () => `<svg viewBox="0 0 300 130" class="gr-fly" aria-hidden="true">
  <path class="ground" d="M0 118H300"/><path class="ramp" d="M0 104H18V118"/>
  <path class="ref" d="M18 104H56"/><path class="arc" d="M48 104A30 30 0 0 0 42.6 86.8"/><text x="52" y="98">35°</text>
  <path class="bad" d="M18 104C26 80 34 50 44 36C52 26 60 32 56 44C52 58 58 96 66 118"/>
  <path class="good" d="M18 104C51 81 80 56 110 46C140 38 165 44 200 64C235 84 265 104 292 116"/>
  <text x="58" y="20" class="lbl bad">too steep: stall</text><text x="150" y="38" class="lbl">power: climb</text><text x="214" y="60" class="lbl">fuel out: let go</text></svg>`;
const artAlt = () => `<div class="gr-alt">
  <div class="gr-altbar"></div>
  <div class="gr-altlbl"><span style="bottom:88%"><b>100 km</b> space · rockets only</span><span style="bottom:58%"><b>11 km</b> thin air · fast, little lift</span>
  <span style="bottom:28%"><b>2 km</b> balloons burst</span><span style="bottom:2%"><b>0 m</b> thick air · lift, thrust, drag</span></div></div>`;
const artTime = () => `<div class="gr-time"><div class="gr-clock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/></svg><b>5:00</b></div>
  <div class="gr-land"><span class="ok">soft touchdown <b>+0.5</b></span><span class="bad">hard or nose-first <b>crash</b></span></div></div>`;
const artStorm = () => `<div class="fcast" style="justify-content:center"><span><b>3</b>Headwind</span><span><b>6</b>Thin air</span><span><b>8</b>Thunderheads</span></div>
  <div class="gr-wx">${['Headwind', 'Thunderheads', 'Thin air', 'Gusts', 'Mail run', 'Fuel rationing', 'Short catapult'].map((w) => `<span>${w}</span>`).join('')}</div>`;

/* ---------- slides ---------- */
const SLIDES = [
  { t: 'The run', art: artRun, p: [
    '8 contracts, 3 flights each.',
    'Your flights add up. Reach the quota to clear the contract. Flights you did not need pay bonus coins.',
    'Miss it and the run is over. Quotas climb fast, so keep improving your craft.'] },
  { t: 'Score', art: artScore, p: [
    'Score = distance × mult.',
    'Flying well raises the mult: touch down cleanly, loop, skim the ground, ride thermals, grab coins, break the sound barrier, reach space.',
    'Mods add bigger bonuses, some of them multiply the whole score.'] },
  { t: 'Parts packs', art: artPacks, p: [
    'Every contract starts with packs. Each holds one random part.',
    'The first contract gives 4: always a tank, a wing and an engine, plus one surprise.',
    'Every later contract gives 2.'] },
  { t: 'Shop & coins', art: artShop, p: [
    'The shop is always open: parts, tunings that stack, and up to 5 mods.',
    'New stock only arrives after you clear a contract. Reroll if nothing fits.',
    'Coins come from every flight, from coins you fly through, and from clearing contracts.'] },
  { t: 'Building', art: artBuild, p: [
    'Everything connects to the cockpit. Frames and tanks pass the connection on; wings, engines and balloons must touch one of them.',
    'Each part only bolts on at certain edges: propellers at their back, so they sit on the nose side; wings underneath or at the sides; balloons by their string. The bench shows the open sockets.',
    'Propellers need a free square in front, rockets one behind for the exhaust. Blocked engines do nothing.',
    'Loose parts stay behind on the ground. Tap to place or remove, hold a part to move it.'] },
  { t: 'Balance', art: artBalance, p: [
    'Keep the mass marker a little in front of the lift arrow. Then the craft holds its nose steady.',
    'Lift ahead of the mass flips the craft. Lift far behind it makes the nose drop.',
    'Engines push along their row. Keep thrust lines through the mass marker (red dashes mean off-center).'] },
  { t: 'Flying', art: artFly, p: [
    'Wings only lift with airspeed. Climb at about 30–35°. Steeper bleeds speed until the wings stall.',
    'When the fuel runs out, let go: the craft settles into a glide on its own.',
    'Lower the throttle to make fuel last. Nose down trades height for speed.'] },
  { t: 'Altitude', art: artAlt, p: [
    'Air thins as you climb. Less drag: you fly faster and glide farther.',
    'But wings and propellers get weaker up there. Rockets work all the way to space.',
    'Balloons lift less the higher they go and burst at 2 km. POP drops them early.'] },
  { t: 'Time & landing', art: artTime, p: [
    'A flight lasts at most 5 minutes. The clock is at the top right.',
    'Touch down gently for a bonus. Hitting the ground hard or nose-first is a crash.',
    'Hanging in the air without power also ends the flight.'] },
  { t: 'Storms', art: artStorm, p: [
    'Contracts 3, 6 and 8 have storms.',
    'They are forecast from the start of the run as red chips. Build for them before you get there.'] },
];

/* ---------- drawer ---------- */
let idx = 0;
const track = () => $('grTrack');
function go(i, smooth = true) {
  idx = Math.max(0, Math.min(SLIDES.length - 1, i));
  track().scrollTo({ left: idx * track().clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  sync();
}
function sync() {
  $('grCount').textContent = `${idx + 1} / ${SLIDES.length}`;
  [...$('grDots').children].forEach((d, i) => d.classList.toggle('on', i === idx));
  $('grPrev').disabled = idx === 0;
  $('grNext').textContent = idx === SLIDES.length - 1 ? 'Got it' : 'Next';
}
function openGuide() {
  if (!track().children.length) {
    track().innerHTML = SLIDES.map((s) => `<section class="gr-slide"><div class="gr-art">${s.art()}</div><h3>${s.t}</h3><ul>${s.p.map((x) => `<li>${x}</li>`).join('')}</ul></section>`).join('');
    $('grDots').innerHTML = SLIDES.map((_, i) => `<button type="button" aria-label="Slide ${i + 1}" data-i="${i}"></button>`).join('');
  }
  $('guide').hidden = false;
  requestAnimationFrame(() => { $('guide').classList.add('open'); go(0, false); });
  onSeen();
}
function closeGuide() {
  const g = $('guide');
  g.classList.remove('open');
  setTimeout(() => { g.hidden = true; }, 260);
}
function initGuide(icons, seen) {
  ICON = icons; onSeen = seen || onSeen;
  $('grClose').onclick = closeGuide;
  $('grScrim').onclick = closeGuide;
  $('grPrev').onclick = () => go(idx - 1);
  $('grNext').onclick = () => (idx === SLIDES.length - 1 ? closeGuide() : go(idx + 1));
  $('grDots').onclick = (e) => { const b = e.target.closest('button'); if (b) go(+b.dataset.i); };
  // swiping moves the track natively; follow it to keep the counter and dots right
  let t = 0;
  track().addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => { idx = Math.round(track().scrollLeft / track().clientWidth); sync(); }, 60); });
  document.addEventListener('keydown', (e) => {
    if ($('guide').hidden) return;
    if (e.key === 'Escape') closeGuide();
    if (e.key === 'ArrowRight') go(idx + 1);
    if (e.key === 'ArrowLeft') go(idx - 1);
  });
}

export { initGuide, openGuide };
