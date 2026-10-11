// rogueflight server (placeholder while the real one is built): health check and a Room Durable Object echo.
export class Room {
  constructor(state, env) { this.state = state; }
  async fetch(req) { return new Response('room ok'); }
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      const id = env.ROOMS.idFromName('health');
      const r = await env.ROOMS.get(id).fetch('https://room/');
      const d = await env.DB.prepare('SELECT 1 AS ok').first();
      return Response.json({ ok: true, room: await r.text(), db: d.ok });
    }
    return new Response('rogueflight server', { status: 200 });
  },
};
