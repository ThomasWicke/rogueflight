// Talking to the game server (server/worker.js): the daily puzzle leaderboard and live rooms over a WebSocket.
const SERVER = (import.meta.env.VITE_SERVER || 'https://rogueflight-server.thomaswi1998.workers.dev').replace(/\/$/, '');

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

export { SERVER, getDaily, postDaily, newRoomCode, connectRoom };
