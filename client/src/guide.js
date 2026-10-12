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
const artPacks = () => `<div class="gr-packs"><div class="gr-pack"><div class="pk-face"><div class="pk-brace"></div><div class="pk-mark">?</div><div class="pk-band">PARTS</div></div></div>
  <svg class="gr-arrow" viewBox="0 0 40 20" aria-hidden="true"><path d="M2 10h30M26 4l8 6-8 6"/></svg>
  <div class="gr-four">${img('tank')}${img('wing')}${img('prop')}<span>?</span></div></div>
  <div class="gr-row"><span class="label">Contract 1</span><b>4 packs</b><span class="label">Then</span><b>1 per contract</b></div>`;
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
  <div class="gr-altlbl"><span style="bottom:88%"><b>5 km</b> cloud nine · +2 mult</span><span style="bottom:58%"><b>2 km</b> balloons burst</span>
  <span style="bottom:28%"><b>1 km</b> thinner air · faster, less lift</span><span style="bottom:2%"><b>0 m</b> thick air · lift, thrust, drag</span></div></div>
  <div class="gr-clock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/></svg><b>2:00</b><span>per flight</span></div>`;
/* ---------- slides ---------- */
const SLIDES = [
  { t: 'The run', art: artRun, p: [
    '8 contracts, 3 flights each. Your flights add up: reach the target or the run ends.',
    'Storm clouds on the route mark storm contracts, known from the start. Build for them early.'] },
  { t: 'Packs & shop', art: artPacks, p: [
    'Each contract starts with packs of parts: 4 in the first (tank, wing, engine + 1), then 1, which can hold a rare part with a brass star. The shop sometimes sells a rare parts pack.',
    'The shop is always open, but new stock only arrives after you clear a contract.'] },
  { t: 'Building', art: artBuild, p: [
    'Everything connects to the cockpit through frames and tanks. Hold a part to move it.',
    'Propellers need a free square in front, rockets one behind. Blocked engines do nothing.'] },
  { t: 'Balance', art: artBalance, p: [
    'Keep the mass marker a little in front of the lift arrow. Lift ahead of it flips the craft.',
    'Keep thrust lines through the mass marker. Red dashes mean the engine pitches the nose.'] },
  { t: 'Flying', art: artFly, p: [
    'Wings need airspeed. Climb at about 30–35°; steeper bleeds speed until you stall.',
    'Out of fuel? Let go and the craft glides on its own. Throttle down to make fuel last.'] },
  { t: 'Altitude & time', art: artAlt, p: [
    'Thin air up high: less drag, but weaker wings and props. Balloons rise until they burst at 2 km.',
    'A flight lasts 2 minutes (Flight permits add more). Hanging in the air without power also ends it. The ▸▸ button plays it at double speed.'] },
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
