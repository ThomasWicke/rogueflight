// rogueflight game server (Cloudflare Worker).
//   GET  /health                      liveness, checks the Room Durable Object and D1
//   GET  /daily?day=N&client=ID       daily puzzle leaderboard: top 20, total entries, the caller's rank
//   POST /daily {day,client,name,score,data}   submit a daily score; only the first submission per client and day counts
//   GET  /room/new                    create a private room, returns {code}
//   GET  /room/CODE  (WebSocket)      join a room; the Room Durable Object runs the live session
// Friends-only beta: scores and flights are reported by the clients and trusted.
import { quotaFor, CONTRACTS, FLIGHTS, dailyNumber } from '../client/src/sim.js';
import { botName } from '../client/src/bots.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/health') {
      const r = await env.ROOMS.get(env.ROOMS.idFromName('health')).fetch('https://room/ping');
      const d = await env.DB.prepare('SELECT 1 AS ok').first();
      return json({ ok: true, room: await r.text(), db: d.ok, day: dailyNumber() });
    }
    if (url.pathname === '/daily') return daily(req, env, url);
    if (url.pathname === '/room/new') return json({ code: newCode() });
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected a websocket' }, 426);
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(new Request(`https://room/${m[1]}`, req));
    }
    return json({ name: 'rogueflight server' });
  },
};

async function daily(req, env, url) {
  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const day = Math.floor(+b.day), today = dailyNumber();
    if (!(day >= today - 1 && day <= today)) return json({ error: 'that puzzle is closed' }, 400);
    const client = clean(b.client, 40), name = clean(b.name, 16) || 'Pilot', score = Math.max(0, Math.floor(+b.score || 0));
    if (!client) return json({ error: 'missing client' }, 400);
    const data = JSON.stringify(b.data || {}).slice(0, 20000);
    await env.DB.prepare('INSERT OR IGNORE INTO daily_scores (day, client, name, score, data) VALUES (?, ?, ?, ?, ?)').bind(day, client, name, score, data).run();
    return board(env, day, client);
  }
  return board(env, Math.floor(+url.searchParams.get('day') || dailyNumber()), clean(url.searchParams.get('client'), 40));
}
async function board(env, day, client) {
  const top = (await env.DB.prepare('SELECT name, score FROM daily_scores WHERE day = ? ORDER BY score DESC, created_at ASC LIMIT 20').bind(day).all()).results;
  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM daily_scores WHERE day = ?').bind(day).first()).n;
  let me = null;
  if (client) {
    const row = await env.DB.prepare('SELECT name, score FROM daily_scores WHERE day = ? AND client = ?').bind(day, client).first();
    if (row) me = { ...row, rank: (await env.DB.prepare('SELECT COUNT(*) AS n FROM daily_scores WHERE day = ? AND score > ?').bind(day, row.score).first()).n + 1 };
  }
  return json({ day, top, total, me });
}

/* ---------- live rooms ----------
   One Durable Object per room code. Everyone in a room plays the same seeded run; each phone simulates its own flight and
   streams its position, the room relays positions and runs the shared clock:
     lobby -> build (everyone taps Ready) -> countdown -> flight (all launch together) -> round result -> build ...
   Team mode: the team's flight scores add up toward each contract's target (quota x players); 3 flights per contract.
   Elimination mode: one flight per round, the lowest scorers drop out each round until one pilot is left. */
// a flight is 2 min (+20 s per Flight permit, at most 3); the room waits a little longer before it calls time
const MAX_PLAYERS = 8, COUNTDOWN_MS = 3500, FLIGHT_LIMIT_MS = 200000;

export class Room {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.socks = new Map(); // ws -> player id
    this.room = null;
  }
  init(code) {
    this.room = { code, phase: 'lobby', mode: 'team', seed: 0, host: null, players: {}, stage: 0, flight: 0, teamScore: 0, target: 0,
      round: 0, launchAt: 0, results: null, over: null, created: Date.now() };
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/ping') return new Response('room ok');
    if (!this.room) this.init(url.pathname.slice(1));
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    server.accept();
    server.addEventListener('message', (e) => { try { this.onMessage(server, JSON.parse(e.data)); } catch (err) { this.send(server, { t: 'error', msg: String(err.message || err) }); } });
    const bye = () => this.onClose(server);
    server.addEventListener('close', bye); server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (_) {} }
  broadcast(msg, except) { const s = JSON.stringify(msg); for (const ws of this.socks.keys()) if (ws !== except) { try { ws.send(s); } catch (_) {} } }
  connected() { return Object.values(this.room.players).filter((p) => p.connected); }
  active() { return this.connected().filter((p) => p.alive); }
  snapshot() {
    const r = this.room;
    return { t: 'state', room: { code: r.code, phase: r.phase, mode: r.mode, seed: r.seed, host: r.host, stage: r.stage, flight: r.flight, round: r.round,
      teamScore: r.teamScore, target: r.target, launchAt: r.launchAt, results: r.results, over: r.over, now: Date.now(),
      players: Object.values(r.players).map((p) => ({ id: p.id, name: p.name, ready: p.ready, connected: p.connected, alive: p.alive, bot: this.isBot(p) ? p.bot : -1,
        cells: p.cells, done: p.done, total: p.total, last: p.last })) } };
  }
  sync() { this.broadcast(this.snapshot()); }

  onMessage(ws, m) {
    const r = this.room;
    if (m.t === 'hello') {
      const id = clean(m.id, 40); if (!id) return;
      let p = r.players[id];
      if (!p) {
        if (Object.keys(r.players).length >= MAX_PLAYERS) return this.send(ws, { t: 'error', msg: 'This room is full.' });
        if (r.phase !== 'lobby') return this.send(ws, { t: 'error', msg: 'This room has already taken off.' });
        p = r.players[id] = { id, name: 'Pilot', ready: false, connected: true, alive: true, cells: null, done: false, total: 0, last: null };
      }
      p.name = clean(m.name, 16) || p.name; p.connected = true; clearTimeout(this.emptyTimer);
      for (const [w, pid] of this.socks) if (pid === id && w !== ws) { this.socks.delete(w); try { w.close(4000, 'replaced'); } catch (_) {} }
      this.socks.set(ws, id);
      if (!r.host || !r.players[r.host]?.connected) r.host = id;
      return this.sync();
    }
    const id = this.socks.get(ws), p = id && r.players[id]; if (!p) return;
    if (m.t === 'addbot' && id === r.host && r.phase === 'lobby' && Object.keys(r.players).length < MAX_PLAYERS) {
      let n = 0; while (r.players['bot' + n]) n++; const bid = 'bot' + n;
      r.players[bid] = { id: bid, bot: n, name: botName(n), ready: true, connected: true, alive: true, cells: null, done: false, total: 0, last: null };
      return this.sync();
    }
    if (m.t === 'kickbot' && id === r.host && r.phase === 'lobby') {
      const b = Object.values(r.players).filter((q) => this.isBot(q)).pop(); if (b) delete r.players[b.id];
      return this.sync();
    }
    if (m.t === 'mode' && id === r.host && r.phase === 'lobby') { r.mode = m.mode === 'elim' ? 'elim' : 'team'; return this.sync(); }
    if (m.t === 'again' && id === r.host && r.phase === 'over') {
      for (const [pid, q] of Object.entries(r.players)) if (!q.connected) delete r.players[pid];
      Object.assign(r, { phase: 'lobby', stage: 0, flight: 0, teamScore: 0, target: 0, round: 0, results: null, over: null });
      for (const q of Object.values(r.players)) Object.assign(q, { alive: true, total: 0, last: null, ready: !!q.bot, done: false });
      return this.sync();
    }
    // bots fly on every phone (deterministically); the first phone to finish a bot's flight reports its score
    if (m.t === 'bot' && r.phase === 'flight' && +m.round === r.round) {
      const b = r.players[m.id]; if (!b || !this.isBot(b) || b.done) return;
      b.done = true; b.last = { score: Math.max(0, Math.floor(+m.score || 0)), dist: Math.floor(+m.dist || 0), crashed: !!m.crashed, landed: !!m.landed };
      this.broadcast({ t: 'done', id: b.id, last: b.last }); this.sync();
      if (this.active().every((q) => q.done)) this.endRound();
      return;
    }
    if (m.t === 'start' && id === r.host && r.phase === 'lobby') {
      r.mode = m.mode === 'elim' ? 'elim' : r.mode;
      if (r.mode === 'team') for (const [pid, q] of Object.entries(r.players)) if (this.isBot(q)) delete r.players[pid];
      r.seed = Math.floor(Math.random() * 4294967296);
      for (const q of Object.values(r.players)) { q.alive = true; q.total = 0; q.last = null; }
      return this.toBuild();
    }
    if (m.t === 'ready' && r.phase === 'build' && p.alive) {
      p.ready = !!m.ready; if (Array.isArray(m.cells)) p.cells = m.cells.slice(0, 40);
      this.sync();
      if (this.active().length && this.active().every((q) => q.ready)) this.toCountdown();
      return;
    }
    if (m.t === 'pos' && r.phase === 'flight') {
      // relay to everyone else: position, velocity, live score, pilot mood, engine on, and now and then the craft
      return this.broadcast({ t: 'pos', id, x: +m.x, y: +m.y, th: +m.th, vx: +m.vx || 0, vy: +m.vy || 0, s: Math.floor(+m.s || 0), mood: m.mood, on: !!m.on, k: m.k }, ws);
    }
    if (m.t === 'done' && r.phase === 'flight' && !p.done) {
      p.done = true; p.last = { score: Math.max(0, Math.floor(+m.score || 0)), dist: Math.floor(+m.dist || 0), crashed: !!m.crashed, landed: !!m.landed };
      this.broadcast({ t: 'done', id, last: p.last });
      this.sync();
      if (this.active().every((q) => q.done)) this.endRound();
      return;
    }
    if (m.t === 'leave') { this.onClose(ws); try { ws.close(1000, 'bye'); } catch (_) {} }
  }
  onClose(ws) {
    const id = this.socks.get(ws); this.socks.delete(ws);
    const p = id && this.room.players[id]; if (!p) return;
    if ([...this.socks.values()].includes(id)) return; // still connected on another socket
    p.connected = false;
    if (this.room.phase === 'lobby') delete this.room.players[id];
    if (this.room.host === id) this.room.host = this.connected().find((q) => !this.isBot(q))?.id || null;
    this.sync();
    // whoever is left should not wait for a pilot who dropped out
    if (this.room.phase === 'build' && this.active().length && this.active().every((q) => q.ready)) this.toCountdown();
    if (this.room.phase === 'flight' && this.active().every((q) => q.done)) this.endRound();
    // nobody left: forget the room after a while (a phone that only blinked out reconnects long before)
    if (!Object.values(this.room.players).some((q) => q.connected && !this.isBot(q))) {
      clearTimeout(this.emptyTimer);
      this.emptyTimer = setTimeout(() => { if (!Object.values(this.room.players).some((q) => q.connected && !this.isBot(q))) this.init(this.room.code); }, 10 * 60000);
    }
  }
  isBot(q) { return q.bot !== undefined && q.bot !== false; }

  toBuild() {
    const r = this.room; r.phase = 'build'; r.launchAt = 0;
    for (const q of Object.values(r.players)) { q.ready = this.isBot(q); q.done = false; }
    if (r.mode === 'team') r.target = quotaFor(r.stage, 0) * Math.max(1, this.active().length);
    this.sync();
  }
  toCountdown() {
    const r = this.room; if (r.phase !== 'build') return;
    r.phase = 'flight'; r.round++; r.launchAt = Date.now() + COUNTDOWN_MS; r.results = null;
    for (const q of Object.values(r.players)) q.done = !q.alive || !q.connected;
    this.sync();
    const round = r.round;
    setTimeout(() => {
      if (this.room.phase !== 'flight' || this.room.round !== round) return;
      // time: a pilot who never reported scores nothing; an unreported bot gets a typical score for the round
      for (const q of this.active()) if (!q.done) { q.done = true; q.last = { score: this.isBot(q) ? Math.round(quotaFor(r.stage, 0) / 3 * (0.6 + Math.random() * 0.6)) : 0, dist: 0, timeout: true }; }
      this.endRound();
    }, COUNTDOWN_MS + FLIGHT_LIMIT_MS);
  }
  endRound() {
    const r = this.room; if (r.phase !== 'flight') return;
    const flyers = Object.values(r.players).filter((q) => q.alive);
    const scores = flyers.map((q) => ({ id: q.id, name: q.name, score: q.last ? q.last.score : 0 }));
    for (const q of flyers) q.total += q.last ? q.last.score : 0;
    let res = { round: r.round, scores };
    if (r.mode === 'team') {
      r.teamScore += scores.reduce((t, s) => t + s.score, 0); r.flight++;
      res = { ...res, stage: r.stage, flight: r.flight };
      if (r.teamScore >= r.target) {
        res = { ...res, cleared: true, stage: r.stage, teamScore: r.teamScore, target: r.target };
        r.stage++; r.flight = 0; r.teamScore = 0;
        if (r.stage >= CONTRACTS) { r.results = res; r.over = { won: true, stage: r.stage }; r.phase = 'over'; return this.sync(); }
      } else if (r.flight >= FLIGHTS) {
        res = { ...res, failed: true, stage: r.stage, teamScore: r.teamScore, target: r.target };
        r.results = res; r.over = { won: false, stage: r.stage }; r.phase = 'over'; return this.sync();
      } else res = { ...res, teamScore: r.teamScore, target: r.target, flight: r.flight };
    } else {
      // elimination: the bottom third (at least one) is out; ties at the cut all survive
      const alive = scores.slice().sort((a, b) => a.score - b.score);
      const cut = alive.length > 1 ? Math.max(1, Math.floor(alive.length / 3)) : 0;
      const line = cut ? alive[cut - 1].score : -1, nextUp = alive[cut] ? alive[cut].score : Infinity;
      const out = cut && line < nextUp ? alive.filter((s) => s.score <= line).map((s) => s.id) : [];
      for (const oid of out) r.players[oid].alive = false;
      res = { ...res, out };
      const left = Object.values(r.players).filter((q) => q.alive);
      // with every human out, the bots would only race each other: the best of them takes it
      if (left.length > 1 && !left.some((q) => !this.isBot(q))) { left.sort((x, y) => y.total - x.total); for (const q of left.slice(1)) q.alive = false; left.length = 1; }
      if (left.length <= 1) { r.results = res; r.over = { won: true, winner: left[0] ? left[0].id : null }; r.phase = 'over'; return this.sync(); }
      r.stage = Math.min(r.stage + 1, CONTRACTS - 1);
    }
    r.results = res;
    this.toBuild();
  }
}
