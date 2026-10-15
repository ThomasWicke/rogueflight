// Talking to the game server (server/worker.js): the daily puzzle leaderboard and live rooms over a WebSocket.
const SERVER = (import.meta.env.VITE_SERVER || 'https://wingnutcircus-server.thomaswi1998.workers.dev').replace(/\/$/, '');

async function api(path, body) {
  const res = await fetch(SERVER + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'server error ' + res.status);
  return j;
}
const getDaily = (day, client) => api(`/daily?day=${day}&client=${encodeURIComponent(client)}`);
const postDaily = (b) => api('/daily', b);
const newRoomCode = () => api('/room/new').then((j) => j.code);

// one live room connection; reconnects on its own (phones drop sockets when they sleep or switch networks)
// h: {onState(room), onPos(msg), onDone(msg), onError(text), onStatus(connected)}
function connectRoom(code, id, name, h) {
  let ws = null, closed = false, tries = 0, timer = 0, ping = 0;
  const url = SERVER.replace(/^http/, 'ws') + '/room/' + code;
  const open = () => {
    clearTimeout(timer); if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => { tries = 0; ws.send(JSON.stringify({ t: 'hello', id, name: c.name })); h.onStatus && h.onStatus(true); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'state') { c.offset = m.room.now - Date.now(); c.room = m.room; h.onState && h.onState(m.room); }
      else if (m.t === 'pos') h.onPos && h.onPos(m);
      else if (m.t === 'done') h.onDone && h.onDone(m);
      else if (m.t === 'error') h.onError && h.onError(m.msg);
    };
    ws.onclose = (e) => {
      h.onStatus && h.onStatus(false);
      if (closed || e.code === 4000) return;
      timer = setTimeout(open, Math.min(8000, 500 * Math.pow(2, tries++)));
    };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  };
  const c = {
    code, name, room: null, offset: 0,
    send(m) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; },
    now() { return Date.now() + c.offset; },
    close() { closed = true; clearTimeout(timer); clearInterval(ping); document.removeEventListener('visibilitychange', wake); try { c.send({ t: 'leave' }); ws && ws.close(1000); } catch (_) {} },
  };
  // back from the background: reconnect at once instead of waiting out the backoff
  const wake = () => { if (document.visibilityState === 'visible' && !closed && (!ws || ws.readyState > 1)) { tries = 0; open(); } };
  document.addEventListener('visibilitychange', wake);
  ping = setInterval(() => c.send({ t: 'ping' }), 25000);
  open();
  return c;
}

/* ---------- accounts and cloud saves (server/accounts.js) ----------
   Every player is a guest account; the session token is kept on this device and sent as a bearer token. */
const TOKEN_KEY = 'rogueflight-auth';
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch (_) {}
const setToken = (t) => { token = t; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) {} };
async function ensureAccount() {
  if (!token) { try { token = localStorage.getItem(TOKEN_KEY); } catch (_) {} }   // a login handed over by a move (see MOVED in ui.js) arrives after this module loaded
  if (token) return token;
  const res = await fetch(SERVER + '/api/auth/sign-in/anonymous', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const t = res.ok && res.headers.get('set-auth-token');
  if (!t) throw new Error('could not start a guest account (' + res.status + ')');
  setToken(t); return t;
}
async function authed(path, opt = {}) {
  await ensureAccount();
  const go = () => fetch(SERVER + path, { ...opt, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token } });
  let res = await go();
  // a token the server no longer knows (never expected within a year): start a fresh guest account
  if (res.status === 401) { setToken(null); await ensureAccount(); res = await go(); }
  return res;
}
const cloudGet = async () => (await authed('/save')).json();
// rev must match the server's; a 409 answer carries the newer server copy
async function cloudPut(save, rev, t, keepalive) {
  const body = JSON.stringify({ save, rev, t });
  const res = await authed('/save', { method: 'PUT', body, keepalive: !!keepalive && body.length < 60000 });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
async function linkCode() { const res = await authed('/link', { method: 'POST' }); if (!res.ok) throw new Error('no code'); return res.json(); }
// sign this device into the account behind a link code
async function claimCode(code) {
  const res = await fetch(SERVER + '/link/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.token) throw new Error(j.error || 'That code did not work.');
  setToken(j.token); return true;
}

export { SERVER, getDaily, postDaily, newRoomCode, connectRoom, ensureAccount, cloudGet, cloudPut, linkCode, claimCode };
