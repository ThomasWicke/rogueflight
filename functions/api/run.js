// POST /api/run: stores one finished run for balancing. Cloudflare Pages Function with a D1 binding named DB.
// Without the binding (not set up yet) it accepts and drops the run, so the game never notices.
export async function onRequestPost({ request, env }) {
  const text = await request.text();
  if (text.length > 20000) return new Response('too large', { status: 413 });
  let run;
  try { run = JSON.parse(text); } catch { return new Response('bad json', { status: 400 }); }
  if (!run || typeof run !== 'object' || !run.data) return new Response('bad run', { status: 400 });
  if (!env.DB) return new Response(null, { status: 204 });
  const int = (v) => (Number.isFinite(+v) ? Math.round(+v) : null);
  await env.DB.prepare('INSERT INTO runs (client, version, level, cleared, endless, won, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(String(run.client || '').slice(0, 40), String(run.version || '').slice(0, 40), int(run.level), int(run.cleared),
      run.endless ? 1 : 0, run.won ? 1 : 0, JSON.stringify(run.data))
    .run();
  return new Response(null, { status: 204 });
}
