// RogueFlight sound: everything is synthesized with the Web Audio API (no samples, no libraries).
// Direction (docs/circus-style.md): a small swing/ragtime band, foley (wood, canvas, rope, tin, crowd),
// a procedural engine and a three-note brass signature (G4 C5 E5, "ta-da-DAAH").
//
// Usage: audio.unlock() inside a user gesture (click / pointerup / touchend; safe to repeat), then
// audio.sfx('tap'), audio.music('hangar'), audio.engine({...}) every flight frame, audio.stopEngine().
// Every call is a silent no-op before unlock, while muted, while the page is hidden, or without Web Audio.
//
// Graph: voices -> sfx bus / music layers -> master (mute fader) -> headroom -> compressor -> limiter -> out.
// The engine bus feeds the sfx bus. A short damped echo ("room slap") gives a little space; no reverb tail.

const KEY = 'rogueflight-audio';
const DEV = !!(import.meta.env && import.meta.env.DEV);
const W = typeof window !== 'undefined' ? window : null;
const AC = W && (W.AudioContext || W.webkitAudioContext);
const SFX_LEVEL = 0.85;   // sfx bus gain at volume 1
const MUSIC_LEVEL = 0.24; // music bus gain at volume 1: the band sits well under the sfx
const LOOKAHEAD = 0.12;   // seconds of music scheduled ahead of the clock
const TICK_MS = 25;       // scheduler interval
const MOTIF = [67, 72, 76]; // the signature: G4 C5 E5

// ---------- small helpers ----------
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (x, d) => (x != null && Number.isFinite(+x) ? +x : d);
const rnd = (a, b) => a + Math.random() * (b - a);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const warn = (...a) => { if (DEV) console.warn('[audio]', ...a); };

// ---------- persisted preferences ----------
const prefs = { muted: false, music: 0.7, sfx: 1 };
try {
  const p = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (typeof p.muted === 'boolean') prefs.muted = p.muted;
  prefs.music = clamp(num(p.music, prefs.music), 0, 1);
  prefs.sfx = clamp(num(p.sfx, prefs.sfx), 0, 1);
} catch { /* storage blocked or absent: keep defaults */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

// ---------- module state ----------
let G = null;         // current graph (context + buses), see makeGraph
let E = null;         // live engine layers during a flight
let BUF = null;       // shared noise tables (AudioBuffers work in any context)
const KS = {};        // Karplus-Strong banjo strings, by midi note
let hidden = !!(typeof document !== 'undefined' && document.hidden);
let resuming = false, suspendTimer = 0, engineSeen = 0, lastSfx = {};

// ---------- graph ----------
function makeGraph(c, { raw = false, vol = prefs } = {}) {
  const gain = (v, to) => { const g = c.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
  const G = { c };
  G.master = gain(0);
  if (raw) G.master.connect(c.destination);
  else {
    const comp = c.createDynamicsCompressor();   // glue: gentle 3:1 above -18 dB
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3;
    comp.attack.value = 0.005; comp.release.value = 0.2;
    const lim = c.createDynamicsCompressor();    // safety limiter
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.1;
    G.master.connect(gain(0.6, comp));           // headroom: the compressor adds its own makeup gain
    comp.connect(lim); lim.connect(c.destination);
  }
  G.sfx = gain(vol.sfx * SFX_LEVEL, G.master);
  G.music = gain(vol.music * MUSIC_LEVEL, G.master);
  G.engine = gain(1, G.sfx);
  // room slap: one damped 105 ms echo, fed lightly from sfx and a bit more from the band
  const d = c.createDelay(0.5); d.delayTime.value = 0.105;
  const damp = c.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2200;
  d.connect(damp); damp.connect(gain(0.25, d)); damp.connect(gain(0.5, G.master));
  G.sfx.connect(gain(0.12, d)); G.music.connect(gain(0.3, d));
  G.band = makeBand(c, G.music);
  // custom waveforms (sine partial amplitudes)
  const wave = h => c.createPeriodicWave(new Float32Array(h.length), new Float32Array(h));
  G.wave = {
    clar: wave([0, 1, 0, 0.42, 0, 0.22, 0, 0.11, 0, 0.05]),       // odd harmonics: hollow, clarinet-ish
    reed: wave([0, 1, 0.65, 0.5, 0.42, 0.3, 0.22, 0.14, 0.09]),   // harmonica reed
  };
  return G;
}

// Band layers (hype fades them in and out) behind a fader. Each song gets a fresh set, so a song change
// can fade out notes the old song already queued without touching the new one.
function makeBand(c, dest) {
  const gain = (v, to) => { const g = c.createGain(); g.gain.value = v; g.connect(to); return g; };
  const mix = gain(0, dest);
  const thin = c.createBiquadFilter(); thin.type = 'highpass'; thin.frequency.value = 160; thin.connect(mix);
  return { mix, L: { bass: gain(0, mix), chord: gain(0, thin), lead: gain(0, mix), counter: gain(0, mix), drum: gain(0, mix), full: gain(0, mix) } };
}

// Noise tables, built once: white, brown (rumble), crackle, a smooth random "wobble", applause.
function buffers(c) {
  if (BUF) return BUF;
  const mk = (sec, sr, fill) => { const b = c.createBuffer(1, Math.floor(sec * sr), sr); fill(b.getChannelData(0), sr); return b; };
  const norm = (d, to) => { let pk = 0; for (const x of d) pk = Math.max(pk, Math.abs(x)); for (let i = 0; i < d.length; i++) d[i] *= to / (pk || 1); };
  BUF = {
    white: mk(2, c.sampleRate, d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }),
    brown: mk(2, 22050, d => {
      let v = 0; const n = d.length;
      for (let i = 0; i < n; i++) { v = v * 0.985 + (Math.random() * 2 - 1) * 0.15; d[i] = v; }
      const a = d[0], b = d[n - 1];                 // tilt so the loop point meets itself
      for (let i = 0; i < n; i++) d[i] -= a + (b - a) * i / (n - 1);
      norm(d, 0.9);
    }),
    crackle: mk(2, c.sampleRate, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        if (Math.random() >= 70 / sr) continue;     // ~70 crackles per second
        const a = rnd(0.2, 1) * (Math.random() < 0.5 ? -1 : 1), len = 4 + (Math.random() * 30 | 0);
        for (let k = 0; k < len && i + k < d.length; k++) d[i + k] += a * Math.exp(-4 * k / len) * (Math.random() * 2 - 1);
      }
      norm(d, 0.9);
    }),
    wobble: mk(4, 22050, d => {                     // new random target every 40 ms, cosine-smoothed, loops
      const seg = 882, K = d.length / seg, p = [];
      for (let k = 0; k < K; k++) p.push(Math.random() * 2 - 1);
      p.push(p[0]);
      for (let i = 0; i < d.length; i++) {
        const k = (i / seg) | 0, w = (1 - Math.cos(Math.PI * (i % seg) / seg)) / 2;
        d[i] = p[k] * (1 - w) + p[k + 1] * w;
      }
    }),
    applause: mk(3, 22050, (d, sr) => {             // ~45 claps a second, wrapped so it loops
      const n = d.length, len = (sr * 0.012) | 0;
      for (let j = 0; j < 3 * 45; j++) {
        const s = (Math.random() * n) | 0, a = rnd(0.15, 0.5);
        for (let k = 0; k < len; k++) d[(s + k) % n] += a * (Math.random() * 2 - 1) * Math.exp(-5 * k / len);
      }
      norm(d, 0.9);
    }),
  };
  return BUF;
}

// Karplus-Strong string: a noise burst recirculated through a damped two-tap average.
// Rendered once per note into a 22 kHz buffer; playbackRate corrects the integer delay to exact pitch.
function pluck(m) {
  if (KS[m]) return KS[m];
  const sr = 22050, f = mtof(m), w = 0.35, N = Math.max(2, Math.round(sr / f - w));
  const T = 0.8, len = Math.floor(sr * T), rho = Math.pow(0.001, 1 / (T * f));
  const b = G.c.createBuffer(1, len, sr), d = b.getChannelData(0);
  let mean = 0, prev = 0;
  for (let i = 0; i < N; i++) { prev = d[i] = 0.5 * prev + (Math.random() * 2 - 1); mean += d[i] / N; }  // softened pick
  for (let i = 0; i < N; i++) d[i] -= mean;          // no DC thump
  for (let i = N; i < len; i++) d[i] = rho * ((1 - w) * d[i - N] + w * (i > N ? d[i - N - 1] : 0));
  for (let i = len - 220; i < len; i++) d[i] *= (len - i) / 220;   // 10 ms fade: the end never clicks
  // the burst's upper partials die within milliseconds; normalize on the ringing part (5-150 ms) instead
  let e = 0; const a = (sr * 0.005) | 0, z = (sr * 0.15) | 0;
  for (let i = a; i < z; i++) e += d[i] * d[i];
  const k = Math.min(0.3 / Math.sqrt(e / (z - a) || 1e-9), 2.5 / Math.max(...d.subarray(0, z).map(Math.abs)));
  for (let i = 0; i < len; i++) d[i] *= k;
  return (KS[m] = { b, rate: f * (N + w) / sr });
}

// ---------- voice building blocks (all use the current graph G) ----------
function gn(v, dest) { const g = G.c.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
// Percussive gain: 0 -> peak in `a` s, then an exponential decay that is ~silent by t+dur.
function env(dest, t, a, peak, dur) {
  const g = G.c.createGain(), p = g.gain;
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(0, t + a, Math.max(0.003, (dur - a) / 5));
  g.connect(dest); return g;
}
// Gain following straight lines through [offset, level] points; starts silent (end the list on 0).
function shape(dest, t, ...pts) {
  const g = G.c.createGain(), p = g.gain;
  p.setValueAtTime(0, t);
  for (const [dt, v] of pts) p.linearRampToValueAtTime(v, t + dt);
  g.connect(dest); return g;
}
function osc(type, f, t, dur, dest) {
  const o = G.c.createOscillator();
  if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
  o.frequency.setValueAtTime(f, t); o.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  return o;
}
function noise(t, dur, dest, buf = BUF.white, rate = 1) {
  const s = G.c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  s.connect(dest); s.start(t, Math.random() * buf.duration * 0.9); s.stop(t + dur + 0.02);
  return s;
}
// Biquad. Note: for lowpass/highpass Web Audio's Q is in dB (0 = mild), for bandpass it is linear.
function filt(type, f, q, dest) {
  const b = G.c.createBiquadFilter(); b.type = type; b.frequency.setValueAtTime(f, 0); b.Q.value = q;
  b.connect(dest); return b;
}
// Exponential glide of a param: v0 at t, then through [offset, value] points.
function glide(p, t, v0, ...pts) { p.setValueAtTime(v0, t); for (const [dt, v] of pts) p.exponentialRampToValueAtTime(v, t + dt); }
// Sine LFO added to a param; depth glides from d0 to d1.
function lfo(param, t, dur, rate, d0, d1 = d0) {
  const o = G.c.createOscillator(), g = G.c.createGain();
  o.frequency.value = rate;
  g.gain.setValueAtTime(d0, t); if (d1 !== d0) g.gain.exponentialRampToValueAtTime(d1, t + dur);
  o.connect(g); g.connect(param); o.start(t); o.stop(t + dur + 0.02);
}
function pan(dest, x) {
  if (!G.c.createStereoPanner) return dest;
  const p = G.c.createStereoPanner(); p.pan.value = clamp(x, -1, 1); p.connect(dest); return p;
}

// --- foley pieces ---
function knock(t, f, vol, dest = G.sfx) {           // wood: a pitch-dropping thock plus a click
  glide(osc('sine', f * 1.6, t, 0.09, env(dest, t, 0.001, vol, 0.09)).frequency, t, f * 1.6, [0.015, f]);
  noise(t, 0.03, filt('bandpass', f * 3, 1.5, env(dest, t, 0.001, vol * 0.6, 0.03)));
}
function ping(t, f, vol, dur) {                     // small coin or nail
  osc('triangle', f, t, dur, env(G.sfx, t, 0.001, vol, dur));
  osc('sine', f * 2.76, t, dur * 0.5, env(G.sfx, t, 0.001, vol * 0.3, dur * 0.5));
}
function bell(t, f, vol, dur) {                     // desk bell: inharmonic partials, upper ones die first
  [[1, 1], [2.76, 0.4], [5.4, 0.15]].forEach(([r, a], i) => osc('sine', f * r, t, dur, env(G.sfx, t, 0.002, vol * a, dur / (1 + i))));
}
function tin(t, f, vol) {                           // tin can clank
  const g = env(G.sfx, t, 0.001, vol * 0.4, 0.28);
  for (const r of [1, 1.47, 2.09, 2.56]) osc('sine', f * r, t, 0.28, g);
  noise(t, 0.02, filt('bandpass', 3000, 1, env(G.sfx, t, 0.001, vol * 0.5, 0.02)));
}
// Stick-slip creak (wood, rope): an irregular slow pulse train ringing two narrow resonances.
function stickSlip(t, dur, r0, r1, f1, f2, vol) {
  const g = shape(G.sfx, t, [0.04, vol * 3], [dur * 0.8, vol * 2.4], [dur, 0]);   // narrow resonators pass little: x3
  const o = G.c.createOscillator(), n = 20, curve = new Float32Array(n);
  o.type = 'sawtooth';
  for (let i = 0; i < n; i++) curve[i] = (r0 + (r1 - r0) * i / (n - 1)) * rnd(0.6, 1.4);
  o.frequency.setValueCurveAtTime(curve, t, dur);   // the only event on this param (curves must not overlap others)
  o.connect(filt('bandpass', f1, 10, g)); o.connect(filt('bandpass', f2, 7, g));
  o.start(t); o.stop(t + dur + 0.02);
}
function whistle(t, p, vol) {                       // fingers-in-mouth whistle
  const o = osc('sine', 1700 * p, t, 0.5, shape(G.sfx, t, [0.03, vol], [0.4, vol * 0.8], [0.5, 0]));
  glide(o.frequency, t, 1700 * p, [0.12, 2900 * p], [0.5, 2300 * p]);
}
function wolf(t, vol) {                             // wolf whistle: "fweet - fwee-oo"
  glide(osc('sine', 1400, t, 0.18, shape(G.sfx, t, [0.02, vol], [0.15, vol], [0.18, 0])).frequency, t, 1400, [0.16, 2900]);
  const t2 = t + 0.28;
  glide(osc('sine', 1300, t2, 0.5, shape(G.sfx, t2, [0.03, vol], [0.4, vol * 0.8], [0.5, 0])).frequency, t2, 1300, [0.15, 2700], [0.5, 1100]);
}
function cymbal(t, vol, dest, len = 0.9) {
  noise(t, len, filt('highpass', 6000, 0, env(dest, t, 0.002, vol, len)));
  noise(t, len * 0.5, filt('bandpass', 9000, 2, env(dest, t, 0.001, vol * 0.6, len * 0.5)));
}

// --- band instruments ---
function tuba(t, m, dur, dest, vol = 0.7) {        // oom: saw + triangle, a lip "blat" and a closing filter
  const f = mtof(m), g = G.c.createGain(), p = g.gain;
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(vol, t + 0.025);
  p.setTargetAtTime(vol * 0.55, t + 0.025, 0.08); p.setTargetAtTime(0, t + dur, 0.035);
  g.connect(dest);
  const lp = filt('lowpass', f * 2, 2, g);
  glide(lp.frequency, t, f * 2, [0.03, f * 7], [dur, f * 3]);
  glide(osc('sawtooth', f * 0.96, t, dur + 0.2, lp).frequency, t, f * 0.96, [0.03, f]);
  osc('triangle', f, t, dur + 0.2, g);
}
function strum(t, ch, vol, dest, up = false) {      // pah: banjo strings, staggered like a pick stroke
  const notes = up ? [...ch.voicing].reverse() : ch.voicing;
  notes.forEach((m, i) => {
    const k = pluck(m), s = G.c.createBufferSource();
    s.buffer = k.b; s.playbackRate.value = k.rate;
    s.connect(gn(vol * (i ? 0.8 : 1), dest)); s.start(t + i * 0.013);
  });
}
function clarinet(t, m, dur, dest) {
  const f = mtof(m), g = G.c.createGain(), p = g.gain;
  dur = Math.max(0.1, dur);
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(0.5, t + 0.03);
  p.setTargetAtTime(0.38, t + 0.03, 0.08); p.setTargetAtTime(0, t + dur - 0.04, 0.025);
  g.connect(dest);
  const o = osc(G.wave.clar, f, t, dur + 0.15, g);
  if (dur > 0.3) lfo(o.frequency, t + 0.15, dur - 0.1, 5.2, f * 0.001, f * 0.007);   // vibrato blooms on long notes
}
function brass(t, notes, dur, vol, dest, bright = 1) {   // section stab: detuned saws, filter "bwap"
  const g = G.c.createGain(), p = g.gain, lv = vol / Math.sqrt(notes.length * 2);
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(lv, t + 0.018);
  p.setTargetAtTime(lv * 0.65, t + 0.018, 0.07); p.setTargetAtTime(0, t + dur, 0.04);
  g.connect(dest);
  const lp = filt('lowpass', 500, 3, g);
  glide(lp.frequency, t, 500, [0.035, 3200 * bright], [dur, 1500 * bright]);
  for (const m of notes) for (const d of [0.997, 1.003]) osc('sawtooth', mtof(m) * d, t, dur + 0.25, lp);
}
function bone(t, m, dur, vol, dest) {               // soft trombone for the counter line
  const f = mtof(m), g = shape(dest, t, [0.07, vol], [dur - 0.08, vol * 0.8], [dur, 0]);
  osc('sawtooth', f, t, dur, filt('lowpass', f * 3, 0, g));
}
function wah(t, m, dur, vol, wobble) {              // plunger-muted trombone "wah"
  const f = mtof(m), g = shape(G.sfx, t, [0.04, vol], [dur - 0.06, vol * 0.85], [dur, 0]);
  const lp = filt('lowpass', 350, 6, g);
  glide(lp.frequency, t, 350, [dur * 0.35, 1500], [dur, 420]);
  const o = osc('sawtooth', f * 1.015, t, dur, lp);
  glide(o.frequency, t, f * 1.015, [dur, f * 0.985]);
  if (wobble) lfo(o.frequency, t + 0.15, dur - 0.15, 6, f * 0.02, f * 0.035);
}
function harp(t, m, dur, vol, bend) {               // harmonica: reedy wave, tremolo, a little breath
  const f = mtof(m), g = shape(G.sfx, t, [0.07, vol], [dur - 0.12, vol * 0.8], [dur, 0]);
  const trem = gn(0.8, g); lfo(trem.gain, t, dur, 5, 0.2);
  const o = osc(G.wave.reed, f, t, dur, filt('bandpass', 1100, 0.7, trem));
  if (bend) glide(o.frequency, t, f * 0.94, [0.18, f]);
  noise(t, dur, filt('bandpass', 1600, 1, gn(0.05, g)));
}
const hat = (t, vol, dest, len = 0.04) => noise(t, len, filt('highpass', 7000, 0, env(dest, t, 0.001, vol, len)));
const brush = (t, vol, dest, len = 0.16) => noise(t, len, filt('bandpass', 3000, 0.6, env(dest, t, 0.012, vol, len)));
const kick = (t, vol, dest) => glide(osc('sine', 120, t, 0.22, env(dest, t, 0.003, vol, 0.22)).frequency, t, 120, [0.09, 48]);
function snare(t, vol, dest) {
  noise(t, 0.12, filt('bandpass', 2200, 0.8, env(dest, t, 0.001, vol, 0.12)));
  osc('triangle', 190, t, 0.06, env(dest, t, 0.001, vol * 0.5, 0.06));
}
const backfire = t => noise(t, 0.06, filt('lowpass', 500, 0, env(G.engine, t, 0.001, 0.25, 0.06)));

// ---------- one-shot sounds ----------
// Each takes (t = start time, o = opts). Peaks are kept around 0.5 before the compressor.
const SFX = {
  tap(t) {                                         // UI click: a little woodblock
    const f = rnd(780, 880);
    glide(osc('triangle', f * 1.3, t, 0.07, env(G.sfx, t, 0.002, 0.3, 0.07)).frequency, t, f * 1.3, [0.018, f]);
    noise(t, 0.02, filt('bandpass', 2600, 1.2, env(G.sfx, t, 0.001, 0.1, 0.02)));
  },
  buy(t) {                                         // cash register: lever clunk, bell, coin jingle
    noise(t, 0.05, filt('bandpass', 1300, 1.5, env(G.sfx, t, 0.001, 0.3, 0.05)));
    glide(osc('sine', 240, t, 0.08, env(G.sfx, t, 0.002, 0.25, 0.08)).frequency, t, 240, [0.06, 110]);
    bell(t + 0.07, 2093, 0.2, 0.8);
    for (let i = 0; i < 3; i++) ping(t + 0.1 + i * 0.045 + rnd(0, 0.02), rnd(3000, 4200), 0.05, 0.12);
  },
  sell(t) {                                        // two falling coins, a drawer slides shut
    ping(t, 1568, 0.16, 0.3); ping(t + 0.09, 1175, 0.14, 0.35);
    const f = filt('bandpass', 1800, 2, shape(G.sfx, t, [0.04, 0.1], [0.28, 0]));
    glide(f.frequency, t, 1800, [0.28, 600]);
    noise(t, 0.3, f);
  },
  coin(t, o) {                                     // "b-ding" a fourth up; opts.pitch multiplies
    const f = 1046.5 * clamp(num(o.pitch, 1), 0.25, 4);
    osc('triangle', f, t, 0.06, env(G.sfx, t, 0.002, 0.2, 0.06));
    osc('triangle', f * 4 / 3, t + 0.055, 0.25, env(G.sfx, t + 0.055, 0.002, 0.2, 0.25));
    osc('sine', f * 8 / 3, t + 0.055, 0.15, env(G.sfx, t + 0.055, 0.002, 0.04, 0.15));
  },
  reroll(t) {                                      // shuffle rattle, then a clack
    for (let i = 0; i < 9; i++) {
      const ti = t + i * 0.032 + rnd(0, 0.015);
      noise(ti, 0.03, filt('bandpass', rnd(1500, 4200), 2, env(G.sfx, ti, 0.001, rnd(0.1, 0.2), 0.03)));
    }
    knock(t + 0.33, 700, 0.22);
  },
  crateShake(t) {                                  // irregular wooden knocks, loose junk inside
    for (let i = 0; i < 6; i++) knock(t + i * 0.07 + rnd(-0.015, 0.015), rnd(150, 230), rnd(0.18, 0.3));
    for (let i = 0; i < 5; i++) {
      const ti = t + rnd(0, 0.42);
      noise(ti, 0.02, filt('bandpass', rnd(2500, 4500), 3, env(G.sfx, ti, 0.001, 0.08, 0.02)));
    }
  },
  crateOpen(t) {                                   // nails creak under the crowbar, the lid pops, clatters
    stickSlip(t, 0.45, 18, 45, 620, 1500, 0.35);
    const p = t + 0.48;
    noise(p, 0.05, filt('bandpass', 1200, 1, env(G.sfx, p, 0.001, 0.4, 0.05)));
    glide(osc('sine', 160, p, 0.15, env(G.sfx, p, 0.002, 0.35, 0.15)).frequency, p, 160, [0.12, 60]);
    ping(p + 0.01, 2600, 0.08, 0.25);
    knock(p + 0.14, 210, 0.2); knock(p + 0.23, 260, 0.12);
  },
  reveal(t) {                                      // sparkly rising chime over an airy swell
    [72, 76, 79, 84, 88, 91].forEach((m, i) => {
      const ti = t + i * 0.055, f = mtof(m + 12);
      osc('sine', f, ti, 0.6, env(G.sfx, ti, 0.003, 0.09, 0.6));
      osc('sine', f * 2.76, ti, 0.25, env(G.sfx, ti, 0.002, 0.03, 0.25));
    });
    const h = filt('highpass', 2500, 0, shape(G.sfx, t, [0.3, 0.05], [0.6, 0]));
    glide(h.frequency, t, 2500, [0.5, 7000]);
    noise(t, 0.6, h);
  },
  creak(t, o) {                                    // rope/catapult tension; opts.amount 0..1 tightens it
    const a = clamp(num(o.amount, 0.5), 0, 1);
    stickSlip(t, 0.22 + 0.3 * a, 14 + 20 * a, 22 + 40 * a, 420, 1050, 0.15 + 0.2 * a);
  },
  launch(t) {                                      // the arm slams its stop, then the rush of air
    glide(osc('sine', 150, t, 0.2, env(G.sfx, t, 0.002, 0.45, 0.2)).frequency, t, 150, [0.15, 48]);
    knock(t, 190, 0.3);
    const f = filt('bandpass', 400, 1.1, shape(G.sfx, t, [0.16, 0.3], [0.75, 0]));
    glide(f.frequency, t, 400, [0.2, 2200], [0.75, 700]);
    noise(t, 0.75, f);
  },
  touchdown(t, o) {                                // wheel thump and a short skid; opts.intensity 0..1
    const v = 0.4 + 0.6 * clamp(num(o.intensity, 0.6), 0, 1);
    glide(osc('triangle', 150, t, 0.15, env(G.sfx, t, 0.003, 0.32 * v, 0.15)).frequency, t, 150, [0.12, 65]);
    noise(t, 0.1, filt('lowpass', 600, 0, env(G.sfx, t, 0.002, 0.25 * v, 0.1)));
    noise(t + 0.02, 0.4, filt('bandpass', 1100, 1.6, shape(G.sfx, t + 0.02, [0.03, 0.12 * v], [0.4, 0])));
  },
  bounce(t) {                                      // rubbery boing
    const o = osc('triangle', 140, t, 0.5, env(G.sfx, t, 0.004, 0.32, 0.5));
    glide(o.frequency, t, 140, [0.05, 400], [0.5, 250]);
    lfo(o.frequency, t, 0.5, 15, 70, 3);
  },
  crash(t) {                                       // crunch, a tin can bouncing away, then the sad trombone
    glide(osc('sine', 95, t, 0.35, env(G.sfx, t, 0.002, 0.45, 0.35)).frequency, t, 95, [0.3, 38]);
    for (let i = 0; i < 10; i++) {
      const ti = t + i * 0.028 + rnd(0, 0.02);
      noise(ti, 0.05, filt('bandpass', rnd(400, 1600), 1.2, env(G.sfx, ti, 0.001, 0.32 * (1 - i / 12), 0.05)));
    }
    [[0.12, 900, 0.22], [0.3, 1250, 0.16], [0.45, 760, 0.13], [0.6, 1500, 0.09], [0.72, 1100, 0.06]]
      .forEach(([dt, f, v]) => tin(t + dt, f * rnd(0.9, 1.1), v));
    [62, 61, 60, 59].forEach((m, i) => wah(t + 0.95 + i * 0.3, m, i < 3 ? 0.26 : 0.85, 0.22, i === 3));
  },
  ooh(t) {                                         // crowd "oooh": detuned voices through "oh" formants
    const dur = 1.15, g = shape(G.sfx, t, [0.25, 0.3], [0.7, 0.24], [dur, 0]);
    const f1 = filt('bandpass', 420, 2.5, g), f2 = filt('bandpass', 850, 4, gn(0.5, g));
    for (const base of [140, 175, 205, 250, 295]) {
      const b = base * rnd(0.97, 1.03), o = osc('sawtooth', b * 0.86, t, dur, f1);
      o.connect(f2);
      glide(o.frequency, t, b * 0.86, [0.4, b * 1.1], [dur, b * 0.93]);
    }
    noise(t, dur, gn(0.3, f1));
  },
  cheer(t, o) {                                    // applause + crowd roar + whistles; opts.intensity 0..1
    const k = clamp(num(o.intensity, 0.6), 0, 1), dur = 1.4 + 1.4 * k, v = 0.55 + 0.45 * k;
    noise(t, dur, filt('bandpass', 2200, 0.6, shape(G.sfx, t, [0.12, 0.55 * v], [dur * 0.55, 0.45 * v], [dur, 0])), BUF.applause, rnd(0.95, 1.05));
    const y = shape(G.sfx, t, [0.18, 0.3 * v], [dur * 0.4, 0.22 * v], [dur * 0.85, 0]);
    noise(t, dur, filt('bandpass', 750, 3, y)).connect(filt('bandpass', 1250, 4, gn(0.6, y)));
    for (let i = 0; i < 1 + Math.round(2 * k); i++) whistle(t + rnd(0.1, dur * 0.5), rnd(0.9, 1.15), 0.07 * v);
  },
  loop(t) {                                        // whoosh + a brass stab (F major, the flight key)
    const f = filt('bandpass', 600, 1.2, shape(G.sfx, t, [0.18, 0.25], [0.5, 0]));
    glide(f.frequency, t, 600, [0.2, 2400], [0.5, 800]);
    noise(t, 0.5, f);
    brass(t + 0.2, [72, 77, 81], 0.22, 0.28, G.sfx, 1.1);
  },
  pass(t) {                                        // low swoosh, a wolf whistle from the crowd
    const f = filt('lowpass', 300, 2, shape(G.sfx, t, [0.25, 0.3], [0.7, 0]));
    glide(f.frequency, t, 300, [0.25, 1000], [0.7, 280]);
    noise(t, 0.7, f);
    wolf(t + 0.25, 0.08);
  },
  thermal(t) {                                     // airy rising swell with a soft rising fifth
    const f = filt('bandpass', 500, 2.5, shape(G.sfx, t, [0.55, 0.3], [1.25, 0]));
    glide(f.frequency, t, 500, [1.1, 2600]);
    noise(t, 1.25, f);
    for (const [m, v] of [[77, 0.05], [84, 0.035]]) {
      const o = osc('sine', mtof(m) * 0.94, t, 1.25, shape(G.sfx, t, [0.6, v], [1.25, 0]));
      glide(o.frequency, t, mtof(m) * 0.94, [1.0, mtof(m)]);
    }
  },
  multStep(t, o) {                                 // tally tick; opts.step raises it a semitone per step
    const f = 523.25 * Math.pow(2, clamp(Math.round(num(o.step, 0)), 0, 30) / 12);
    glide(osc('triangle', f * 1.5, t, 0.14, env(G.sfx, t, 0.002, 0.24, 0.14)).frequency, t, f * 1.5, [0.015, f]);
    osc('sine', f * 3, t, 0.05, env(G.sfx, t, 0.001, 0.05, 0.05));
  },
  slam(t) {                                        // the multiply moment: big drum, snare, crash
    glide(osc('sine', 165, t, 0.4, env(G.sfx, t, 0.002, 0.45, 0.4)).frequency, t, 165, [0.25, 50]);
    glide(osc('triangle', 240, t, 0.2, env(G.sfx, t, 0.002, 0.2, 0.2)).frequency, t, 240, [0.15, 110]);
    noise(t, 0.2, filt('bandpass', 1800, 0.9, env(G.sfx, t, 0.001, 0.32, 0.2)));
    cymbal(t, 0.22, G.sfx, 1.4);
  },
  stamp(t) {                                       // rubber stamp: thud and a paper slap
    glide(osc('triangle', 190, t, 0.14, env(G.sfx, t, 0.002, 0.4, 0.14)).frequency, t, 190, [0.1, 75]);
    noise(t, 0.07, filt('lowpass', 900, 0, env(G.sfx, t, 0.001, 0.35, 0.07)));
    noise(t, 0.025, filt('bandpass', 2600, 1, env(G.sfx, t, 0.001, 0.12, 0.025)));
  },
  fireworks(t) {                                   // four pops spread left and right, each with crackle
    for (let i = 0; i < 4; i++) {
      const ti = t + i * 0.26 + rnd(0, 0.1), out = pan(G.sfx, rnd(-0.7, 0.7)), v = rnd(0.7, 1);
      noise(ti, 0.25, filt('lowpass', 1500, 0, env(out, ti, 0.001, 0.4 * v, 0.25)));
      glide(osc('sine', 110, ti, 0.22, env(out, ti, 0.002, 0.3 * v, 0.22)).frequency, ti, 110, [0.18, 42]);
      noise(ti + 0.05, 0.5, filt('highpass', 2000, 0, shape(out, ti + 0.05, [0.04, 0.5 * v], [0.5, 0])), BUF.crackle);
    }
  },
  fanfare(t) {                                     // the signature: "ta-da-DAAH", landing on a C major chord
    const [a, b, c] = MOTIF;
    brass(t, [a], 0.12, 0.26, G.sfx, 1.2);
    brass(t + 0.13, [b], 0.12, 0.26, G.sfx, 1.2);
    brass(t + 0.26, [c, b, a], 0.65, 0.25, G.sfx, 1.25);
    tuba(t + 0.26, 48, 0.6, G.sfx, 0.4);
    cymbal(t + 0.26, 0.07, G.sfx, 0.9);
  },
  sad(t) {                                         // a lone harmonica: G E D(bent) C, then a soft double stop
    [[67, 0.34], [64, 0.34], [62, 0.5, 1], [60, 1.4]].reduce((ti, [m, d, bend]) => { harp(ti, m, d, 0.22, bend); return ti + d; }, t);
    harp(t + 1.18, 64, 1.4, 0.1);
  },
  pop(t) {                                         // balloon burst and flapping rubber
    noise(t, 0.07, filt('highpass', 700, 0, env(G.sfx, t, 0.0005, 0.32, 0.07)));
    glide(osc('sine', 230, t, 0.06, env(G.sfx, t, 0.001, 0.3, 0.06)).frequency, t, 230, [0.05, 80]);
    for (let i = 0; i < 3; i++) {
      const ti = t + 0.05 + i * 0.03 + rnd(0, 0.01);
      noise(ti, 0.02, filt('bandpass', 900, 2, env(G.sfx, ti, 0.001, 0.07, 0.02)));
    }
  },
  stall(t) {                                       // slide whistle falling
    const g = shape(G.sfx, t, [0.04, 0.18], [0.75, 0.15], [0.9, 0]);
    const o = osc('sine', 1700, t, 0.9, g);
    glide(o.frequency, t, 1700, [0.08, 1800], [0.85, 420]);
    lfo(o.frequency, t, 0.9, 7, 15);
    noise(t, 0.9, filt('bandpass', 2400, 1, gn(0.15, g)));
  },
  redline(t) {                                     // sonic-boom-ish double thump
    noise(t, 0.03, filt('highpass', 1800, 0, env(G.sfx, t, 0.001, 0.25, 0.03)));
    for (const [dt, v] of [[0, 1], [0.13, 0.8]]) {
      const ti = t + dt;
      glide(osc('sine', 75, ti, 0.4, env(G.sfx, ti, 0.002, 0.5 * v, 0.4)).frequency, ti, 75, [0.35, 32]);
      noise(ti, 0.35, filt('lowpass', 380, 0, env(G.sfx, ti, 0.001, 0.4 * v, 0.35)));
      noise(ti, 0.2, filt('bandpass', 700, 1, env(G.sfx, ti, 0.001, 0.25 * v, 0.2)));
    }
  },
  gift(t) {                                        // paper crinkles, then a tear
    for (let i = 0; i < 14; i++) {
      const ti = t + rnd(0, 0.45), d = rnd(0.015, 0.04);
      noise(ti, d, filt('bandpass', rnd(2000, 6000), 1.5, env(G.sfx, ti, 0.001, rnd(0.12, 0.3), d)));
    }
    const tr = t + 0.45, f = filt('bandpass', 1200, 1.2, shape(G.sfx, tr, [0.03, 0.35], [0.22, 0]));
    glide(f.frequency, tr, 1200, [0.22, 3800]);
    noise(tr, 0.22, f); noise(tr, 0.22, f, BUF.crackle);
  },
  error(t) {                                       // soft dull bonk
    const lp = filt('lowpass', 700, 0, env(G.sfx, t, 0.003, 0.2, 0.2));
    glide(osc('triangle', 196, t, 0.2, lp).frequency, t, 196, [0.15, 150]);
    osc('sine', 98, t, 0.2, lp);
  },
};
// Minimum seconds between two plays of the same sound (stops per-frame callers from stacking).
const GAP = { creak: 0.25, coin: 0.025 };

// ---------- engine (prop drone, rocket roar, wind) ----------
function makeEngine() {
  const c = G.c, srcs = [], e = { srcs, coughEnd: 0, last: -1 };
  const src = n => { srcs.push(n); return n; };
  const loop = (buf, rate = 1) => { const s = src(c.createBufferSource()); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; return s; };
  const oscN = (type, f) => { const o = src(c.createOscillator()); o.type = type; o.frequency.value = f; return o; };
  // propeller: saw + sub-octave square (uneven firing), amplitude fluttered by noise and the blades
  e.prop = gn(0, G.engine);          // throttle level
  e.sput = gn(1, e.prop);            // fuel-starved coughs
  e.am = gn(0.6, e.sput);            // roughness, modulated below
  e.lp = filt('lowpass', 500, 2, e.am);
  e.o1 = oscN('sawtooth', 40); e.o1.connect(e.lp);
  e.o2 = oscN('square', 20); e.o2.connect(gn(0.3, e.lp));
  loop(BUF.wobble, 1.7).connect(gn(0.22, e.am.gain));
  e.blade = oscN('sine', 10); e.blade.connect(gn(0.15, e.am.gain));
  // rocket: brown-noise roar, hiss, crackle
  e.rock = gn(0, G.engine);
  e.rlp = filt('lowpass', 700, 0, e.rock);
  loop(BUF.brown).connect(e.rlp);
  loop(BUF.white).connect(filt('bandpass', 2600, 0.8, gn(0.18, e.rock)));
  loop(BUF.crackle).connect(filt('highpass', 1500, 0, gn(0.5, e.rock)));
  // wind: band-passed noise that gusts slowly
  const gust = gn(0.8, G.engine);
  loop(BUF.wobble, 0.35).connect(gn(0.2, gust.gain));
  e.wind = gn(0, gust);
  e.wbp = filt('bandpass', 400, 0.8, e.wind);
  loop(BUF.white).connect(e.wbp);
  const t = c.currentTime;
  for (const s of srcs) s.start(t, s.buffer ? Math.random() * s.buffer.duration * 0.9 : 0);
  return e;
}
const P = (p, v, t, tc) => p.setTargetAtTime(v, t, tc);
function engineSet(e, s, t, dt) {
  const prop = clamp(num(s.prop, 0), 0, 1), rocket = clamp(num(s.rocket, 0), 0, 1);
  const v = clamp(Math.abs(num(s.speed, 0)), 0, 400), fuel = clamp(num(s.fuel, 1), 0, 1), alt = Math.max(0, num(s.alt, 0));
  // below 15% fuel the prop coughs: random dropouts, more often as the tank empties, a pop as it catches
  if (prop > 0 && fuel < 0.15 && t > e.coughEnd && Math.random() < dt * (1 + 6 * (1 - fuel / 0.15))) {
    const d = rnd(0.06, 0.22);
    e.sput.gain.setTargetAtTime(0.05, t, 0.01); e.sput.gain.setTargetAtTime(1, t + d, 0.03);
    backfire(t + d);
    e.coughEnd = t + d + rnd(0.08, 0.3);
  }
  if (t - e.last < 0.05) return;     // params at ~20 Hz; setTargetAtTime smooths between updates
  e.last = t;
  const f = 26 + 50 * prop + 0.25 * Math.min(v, 120), air = Math.exp(-alt / 8500), w = Math.min(1, v / 90);
  P(e.prop.gain, prop > 0.001 ? 0.06 + 0.1 * prop : 0, t, 0.15);
  P(e.o1.frequency, f, t, 0.12); P(e.o2.frequency, f / 2, t, 0.12); P(e.blade.frequency, f / 4, t, 0.12);
  P(e.lp.frequency, 300 + 1500 * prop + 4 * Math.min(v, 150), t, 0.12);
  P(e.rock.gain, rocket > 0.001 ? 0.1 + 0.18 * rocket : 0, t, 0.1);
  P(e.rlp.frequency, 400 + 1800 * rocket, t, 0.12);
  P(e.wind.gain, 0.2 * w * Math.sqrt(w) * (0.25 + 0.75 * air), t, 0.2);   // thin air, thin wind
  P(e.wbp.frequency, Math.min(3500, 250 + 16 * v), t, 0.2);
}
function fadeEngine(e, t) {
  for (const g of [e.prop, e.rock, e.wind]) g.gain.setTargetAtTime(0, t, 0.08);
  for (const s of e.srcs) s.stop(t + 0.6);
}

// ---------- music ----------
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const noteNum = s => { const m = /^([A-G])([#b]?)(\d)$/.exec(s); return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
const CHORD = { '': [0, 4, 7], 6: [0, 4, 7, 9], 7: [0, 4, 7, 10], m: [0, 3, 7], m7: [0, 3, 7, 10] };
function parseChord(name) {
  const [, r, q] = /^([A-G][#b]?)(.*)$/.exec(name), pc = noteNum(r + '4') % 12, iv = CHORD[q];
  const root = 40 + ((pc - 4 + 12) % 12);                                  // tuba: E2..D#3
  const voicing = iv.map(i => 55 + ((pc + i - 7 + 24) % 12)).sort((a, b) => a - b);  // banjo: G3..F#4
  return { pc, iv, root, fifth: root + 7 > 52 ? root - 5 : root + 7, voicing };
}
// A song: 8 bars of chords (a space splits a bar into two halves) and two passes of melody.
// Melody bars are "note:eighths" tokens (r = rest) that fill 8 eighths each.
function compile(def) {
  const bars = def.chords.map(s => { const c = s.split(' ').map(parseChord); return [c[0], c[1] || c[0]]; });
  const mel = def.mel.map(pass => pass.map((bar, i) => {
    const steps = new Array(8).fill(null); let k = 0;
    for (const tok of bar.split(' ')) { const [n, l] = tok.split(':'); if (n !== 'r') steps[k] = { m: noteNum(n), len: +l }; k += +l; }
    if (k !== 8) warn(`melody bar ${i + 1} has ${k} eighths`);
    return steps;
  }));
  // counter line: guide tones (3rd or 7th/6th/5th) voice-led in trombone range
  let prev = 58;
  const guide = bars.map(halves => halves.map(c => {
    const cand = [];
    for (const i of [c.iv[1], c.iv[c.iv.length - 1]]) for (let m = 50; m <= 65; m++) if (m % 12 === (c.pc + i) % 12) cand.push(m);
    return (prev = cand.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0]);
  }));
  return { ...def, bars, mel, guide, plucks: [...new Set(bars.flat().flatMap(c => c.voicing))] };
}
const SONGS = {
  // "Parade" (title, hangar): C major, a Charleston-style circle of dominants
  parade: compile({ bpm: 108, swing: 0.64,
    chords: ['C6', 'E7', 'A7', 'A7', 'D7', 'G7', 'C6 G7', 'C6'],
    mel: [
      ['E5:1 G5:1 A5:2 G5:1 E5:1 C5:2', 'B4:1 D5:1 E5:2 G#5:3 r:1', 'A5:2 G5:1 E5:1 C#5:2 E5:2', 'G5:2 E5:2 r:1 C#5:1 D5:1 E5:1',
       'F#5:2 A5:2 F#5:1 D5:1 C5:2', 'B4:1 D5:1 F5:2 E5:1 D5:1 B4:2', 'C5:2 E5:2 D5:2 B4:2', 'C5:3 r:1 G4:1 A4:1 C5:1 D5:1'],
      ['G5:1 A5:1 G5:1 E5:1 C6:2 A5:2', 'G#5:1 B5:1 G#5:1 E5:1 D5:2 B4:2', 'C#5:1 E5:1 A5:2 G5:1 E5:1 C#5:2', 'E5:3 r:1 A4:1 C#5:1 E5:1 G5:1',
       'F#5:1 A5:1 C6:2 A5:1 F#5:1 D5:2', 'G5:1 F5:1 D5:1 B4:1 G5:2 F5:2', 'E5:1 G5:1 C6:2 B5:1 G5:1 F5:2', 'E5:2 C5:3 r:1 D5:1 D#5:1'],
    ] }),
  // "Barnstorm" (flight): F major, brighter and faster, with the minor iv
  barnstorm: compile({ bpm: 124, swing: 0.6,
    chords: ['F6', 'F7', 'Bb6', 'Bbm', 'F6', 'D7', 'G7 C7', 'F6 C7'],
    mel: [
      ['C5:1 D5:1 F5:1 A5:2 F5:1 D5:1 C5:1', 'Eb5:2 C5:1 A4:1 C5:2 Eb5:2', 'D5:2 F5:1 G5:1 Bb5:3 r:1', 'Db5:2 F5:1 Db5:1 Bb4:3 r:1',
       'C5:1 F5:1 A5:1 C6:2 A5:1 F5:2', 'F#5:2 A5:1 F#5:1 D5:2 C5:2', 'B4:1 D5:1 G5:2 Bb5:1 G5:1 E5:2', 'F5:2 A4:2 G4:1 A4:1 Bb4:1 B4:1'],
      ['A5:1 G5:1 F5:1 D5:1 C5:2 F5:2', 'Eb5:1 F5:1 Eb5:1 C5:1 A4:2 C5:2', 'D5:1 F5:1 Bb5:2 A5:1 G5:1 F5:2', 'Db5:1 F5:1 Ab5:2 F5:1 Db5:1 Bb4:2',
       'C6:2 A5:1 F5:1 C5:2 F5:2', 'A5:1 F#5:1 D5:1 F#5:1 A5:2 C6:2', 'B5:1 G5:1 D5:1 B4:1 C5:1 E5:1 G5:1 Bb5:1', 'A5:3 r:1 G4:1 A4:1 Bb4:1 B4:1'],
    ] }),
};
const MODES = { title: { song: 'parade', hype: 0.9 }, hangar: { song: 'parade', hype: 0.68 }, flight: { song: 'barnstorm' } };
const BASE = { bass: 0.4, chord: 0.45, lead: 0.45, counter: 0.35, drum: 1, full: 0.6 };   // layer mix
const band = (h, thr) => clamp((h - thr) / 0.2 + 0.5, 0, 1);       // fades a layer in across thr +-0.1
function levels(h) { const full = band(h, 0.9); return { bass: 1, drum: 1, chord: band(h, 0.4), lead: band(h, 0.7), counter: full, full }; }
const stepDur = (S, s) => (s & 1 ? 1 - S.swing : S.swing) * 60 / S.bpm;  // swung eighths

// One swung eighth of the band. lv = layer levels, aud = which optional layers are worth scheduling.
function playStep(S, s, t, lv, aud) {
  const L = G.band.L, k = s & 7, bar = (s >> 3) & 7, pass = (s >> 6) & 1, beat = 60 / S.bpm;
  const halves = S.bars[bar], ch = halves[k >> 2], next = S.bars[(bar + 1) & 7][0];
  // oom: tuba on 1 and 3 (root, fifth), walking quarters when the band is at full tilt
  if (!(k & 1)) {
    const b = k >> 1;
    if (lv.full > 0.5) {
      const m = [ch.root, ch.root + ch.iv[1], halves[0] !== halves[1] ? ch.root : ch.fifth, next.root + (next.root > ch.root ? -1 : 1)][b];
      tuba(t, m, beat * 0.8, L.bass, 0.6);
    } else if (b === 0) tuba(t, ch.root, beat * 0.9, L.bass);
    else if (b === 2) tuba(t, halves[0] !== halves[1] ? ch.root : ch.fifth, beat * 0.9, L.bass);
  }
  // pah: banjo strums on 2 and 4, a light upstroke on the "and" of 4
  if (aud.chord) {
    if (k === 2 || k === 6) strum(t, ch, 0.55, L.chord);
    else if (k === 7) strum(t, ch, 0.3, L.chord, true);
  }
  // light kit: ride "spang-a-lang" and brushes on 2 and 4
  if (!(k & 1)) hat(t, 0.22, L.drum, 0.07); else if (k === 3 || k === 7) hat(t, 0.12, L.drum, 0.05);
  if (k === 2 || k === 6) brush(t, 0.3, L.drum);
  // clarinet melody (two passes alternate)
  if (aud.lead) { const n = S.mel[pass][bar][k]; if (n) clarinet(t, n.m, n.len * beat / 2 * 0.95, L.lead); }
  // full band: trombone counter line, brass stabs, kick, snare and a fill into the top
  if (aud.full) {
    if (k === 0 || k === 4) { bone(t, S.guide[bar][k >> 2], beat * 1.9, 0.5, L.counter); kick(t, 0.5, L.full); }
    if ((bar & 1) && (k === 3 || k === 7)) brass(t, ch.voicing.slice(-3).map(m => m + 12), beat * 0.35, 0.5, L.counter);
    if (k === 2 || k === 6) snare(t, 0.25, L.full);
    if (bar === 7 && k >= 5) snare(t, 0.12 + 0.06 * (k - 5), L.full);
    if (bar === 0 && k === 0 && s > 0) cymbal(t, 0.12, L.full);
  }
}

const M = { want: 'off', mode: 'off', song: null, step: 0, next: 0, hype: 0, applied: -1,
  lv: levels(0), fade: { chord: 0, lead: 0, full: 0 } };

// Move the band layers toward hype h (0.4 s glide), or jump there when a song starts.
function setLevels(h, jump = false) {
  const lv = levels(h);
  M.applied = h;
  if (G) {
    const t = G.c.currentTime;
    for (const k in lv) {
      if (k in M.fade && M.lv[k] > 0.01 && lv[k] <= 0.01) M.fade[k] = t + 1.5;   // keep playing while it fades
      const p = G.band.L[k].gain;
      if (jump) p.setValueAtTime(BASE[k] * lv[k], t); else p.setTargetAtTime(BASE[k] * lv[k], t, 0.4);
    }
  }
  M.lv = lv;
}
function applyMode() {
  const cfg = MODES[M.want], t = G.c.currentTime, old = G.band;
  if (!cfg) { if (M.song) old.mix.gain.setTargetAtTime(0, t, 0.15); M.song = null; M.mode = 'off'; return; }
  const S = SONGS[cfg.song];
  M.mode = M.want;
  if (M.song === S) { setLevels(cfg.hype ?? M.hype); return; }   // same tune (title <-> hangar): just re-voice
  // new tune: retire the old band (its queued notes fade with it), start a fresh one
  old.mix.gain.setTargetAtTime(0, t, 0.03);
  setTimeout(() => { try { old.mix.disconnect(); } catch { /* already gone */ } }, 1000);
  G.band = makeBand(G.c, G.music);
  G.band.mix.gain.setTargetAtTime(1, t, 0.03);
  M.song = S; M.step = 0; M.next = t + 0.06;
  M.fade = { chord: 0, lead: 0, full: 0 };
  for (const m of S.plucks) pluck(m);                // build the banjo strings now, not mid-groove
  setLevels(cfg.hype ?? M.hype, true);
}
// Lookahead scheduler, run every 25 ms: queue every eighth that starts within the next 0.12 s.
function tick() {
  if (!G) return;
  try {
    if (E && performance.now() - engineSeen > 700) audio.stopEngine();   // flight ended without stopEngine()
    if (!M.song || !live()) return;
    const c = G.c, end = c.currentTime + LOOKAHEAD, now = c.currentTime;
    if (M.next < now) M.next = now + 0.02;           // the timer was starved: skip ahead, never burst
    const aud = {}; for (const k in M.fade) aud[k] = M.lv[k] > 0.01 || now < M.fade[k];
    while (M.next < end) { playStep(M.song, M.step, M.next, M.lv, aud); M.next += stepDur(M.song, M.step); M.step++; }
  } catch (e) { warn('scheduler', e); }
}

// ---------- context lifecycle ----------
const live = () => !!G && !prefs.muted && !hidden && (G.c.state === 'running' || resuming);
// Run the context only while it can be heard: unlocked, not muted, page visible.
function sync() {
  if (!G) return;
  const c = G.c, on = !prefs.muted && !hidden;
  clearTimeout(suspendTimer);
  G.master.gain.setTargetAtTime(on ? 1 : 0, c.currentTime, on ? 0.03 : 0.015);
  if (on && c.state !== 'running') {
    resuming = true;
    const done = () => { resuming = false; };
    c.resume().then(done, done);
  } else if (!on && c.state === 'running') {
    suspendTimer = setTimeout(() => { if (G && (prefs.muted || hidden)) c.suspend().catch(() => {}); }, 150);
  }
}
function unlock() {
  if (!AC) return;
  try {
    if (!G) {
      let c;
      try { c = new AC({ latencyHint: 'interactive' }); } catch { c = new AC(); }
      G = makeGraph(c); buffers(c);
      setInterval(tick, TICK_MS);
      if (M.want !== 'off') applyMode();
    }
    if (G.c.state !== 'running' && !prefs.muted && !hidden) {
      // iOS: starting a silent one-sample buffer inside the gesture opens the output
      const s = G.c.createBufferSource(); s.buffer = G.c.createBuffer(1, 1, 22050); s.connect(G.c.destination); s.start(0);
    }
    sync();
  } catch (e) { warn('unlock failed', e); }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; sync(); });
  // After the first unlock, any later gesture re-resumes a context the OS suspended (iOS calls, app switches).
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) {
    W.addEventListener(ev, () => { if (G && G.c.state !== 'running' && !prefs.muted && !hidden) unlock(); }, { capture: true, passive: true });
  }
}

// ---------- dev: offline render + level stats (used by client/dev/audio.html) ----------
function stats(buf, at = 0) {
  let peak = 0, sum = 0, last = 0, nan = false;
  const n = buf.length, i0 = Math.floor(at * buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = i0; i < n; i++) {
      const x = d[i];
      if (x !== x) { nan = true; continue; }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a > 0.001) last = Math.max(last, i);
      sum += x * x;
    }
  }
  const end = Math.max(...Array.from({ length: buf.numberOfChannels }, (_, ch) => Math.abs(buf.getChannelData(ch)[n - 1])));
  const r = v => Math.round(v * 1000) / 1000;
  return { peak: r(peak), rms: r(Math.sqrt(sum / Math.max(1, (last + 1 - i0) * buf.numberOfChannels))), dur: r((last - i0) / buf.sampleRate), end: r(end), nan };
}
// kind 'sfx' (arg = name, opts.o = sfx opts), 'music' (arg = {mode, hype}) or 'engine' (arg = engine state).
// opts.raw skips the compressor/limiter. Volumes are rendered at 1 (the loudest a player can set).
async function render(kind, arg, opts = {}) {
  const OAC = W && (W.OfflineAudioContext || W.webkitOfflineAudioContext);
  if (!OAC) return null;
  const AT = kind === 'sfx' ? 0.6 : 0;   // sfx start late: Chrome's compressor needs a moment to settle from its initial state
  const sec = (opts.seconds || 3) + AT, sr = 44100, c = new OAC(2, Math.ceil(sec * sr), sr);
  const keep = G;
  try {
    G = makeGraph(c, { raw: !!opts.raw, vol: { music: 1, sfx: 1 } }); buffers(c);
    G.master.gain.value = 1; G.band.mix.gain.value = 1;
    if (kind === 'sfx') SFX[arg](AT, opts.o || {});
    if (kind === 'music') {
      const cfg = MODES[arg.mode] || MODES.flight, S = SONGS[cfg.song], lv = levels(cfg.hype ?? num(arg.hype, 0));
      for (const k in lv) G.band.L[k].gain.value = arg.solo && arg.solo !== k ? 0 : BASE[k] * lv[k];
      const aud = { chord: lv.chord > 0.01, lead: lv.lead > 0.01, full: lv.full > 0.01 };
      for (let s = 0, t = 0.05; t < sec - 0.6; t += stepDur(S, s), s++) playStep(S, s, t, lv, aud);
    }
    if (kind === 'engine') {
      const e = makeEngine();
      for (let t = 0.02; t < sec - 0.5; t += 1 / 30) engineSet(e, arg, t, 1 / 30);
      fadeEngine(e, sec - 0.5);
    }
  } finally { G = keep; }
  return stats(await c.startRendering(), AT);
}

// ---------- public API ----------
export const audio = {
  /** Create/resume the AudioContext. Call inside a user gesture; safe to call on every gesture. */
  unlock,
  get muted() { return prefs.muted; },
  setMuted(on) { prefs.muted = !!on; save(); sync(); },
  get volumes() { return { music: prefs.music, sfx: prefs.sfx }; },
  /** {music, sfx} in 0..1, either may be omitted. Persisted. */
  setVolumes(v = {}) {
    if (v.music != null) prefs.music = clamp(num(v.music, prefs.music), 0, 1);
    if (v.sfx != null) prefs.sfx = clamp(num(v.sfx, prefs.sfx), 0, 1);
    save();
    if (G) {
      const t = G.c.currentTime;
      G.music.gain.setTargetAtTime(prefs.music * MUSIC_LEVEL, t, 0.05);
      G.sfx.gain.setTargetAtTime(prefs.sfx * SFX_LEVEL, t, 0.05);
    }
  },
  /** 'locked' before unlock, otherwise the AudioContext state. */
  get state() { return G ? G.c.state : AC ? 'locked' : 'unsupported'; },
  get sfxNames() { return Object.keys(SFX); },
  /** One-shot sound. See SFX above for names and opts (pitch, amount, intensity, step). */
  sfx(name, opts = {}) {
    if (!live()) return;
    const fn = SFX[name];
    if (!fn) { warn('unknown sfx', name); return; }
    try {
      const t = G.c.currentTime + 0.01;
      if (t - (lastSfx[name] ?? -1) < (GAP[name] ?? 0.03)) return;
      lastSfx[name] = t;
      fn(t, opts || {});
    } catch (e) { warn('sfx', name, e); }
  },
  /** Every flight frame: {prop 0..1, rocket 0..1, speed m/s, fuel 0..1, alt m}. */
  engine(state) {
    if (!live() || !state) return;
    try {
      const now = performance.now();
      if (!E) { E = makeEngine(); engineSeen = now; }
      const dt = Math.min(0.1, (now - engineSeen) / 1000);
      engineSeen = now;
      engineSet(E, state, G.c.currentTime, dt);
    } catch (e) { warn('engine', e); }
  },
  /** Fade all engine and wind layers out over ~0.3 s. */
  stopEngine() {
    if (!G || !E) return;
    try { fadeEngine(E, G.c.currentTime); } catch (e) { warn('stopEngine', e); }
    E = null;
  },
  /** 'title' | 'hangar' | 'flight' | 'off'. Remembered before unlock. Entering 'flight' resets hype to 0. */
  music(mode) {
    if (!MODES[mode] && mode !== 'off') { warn('unknown music mode', mode); mode = 'off'; }
    if (mode === M.want && (mode === M.mode || !G)) return;
    if (mode === 'flight' && M.want !== 'flight') M.hype = 0;
    M.want = mode;
    if (G) { try { applyMode(); } catch (e) { warn('music', e); } }
  },
  /** Flight intensity 0..1: 0 bass + light kit, 0.4 + banjo, 0.7 + clarinet, 1 + brass, counter line, full kit. */
  hype(x) {
    M.hype = clamp(num(x, 0), 0, 1);
    if (G && M.mode === 'flight' && Math.abs(M.hype - M.applied) > 0.01) setLevels(M.hype);
  },
  /** Dev only: render through an OfflineAudioContext and return {peak, rms, dur, end, nan}. */
  _render: render,
};
export default audio;
