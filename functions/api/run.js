// POST /api/run: stores a run for balancing. Cloudflare Pages Function with a D1 binding named DB.
// Clients send the run after every flight and once more when it ends; rows are keyed by run_id and updated in place, so
// runs that are never finished are still recorded up to their last flight. (Old clients without run_id insert a row.)
// Without the binding (not set up yet) it accepts and drops the run, so the game never notices.
export async function onRequestPost({ request, env }) {
  const text = await request.text();
  if (text.length > 120000) return new Response('too large', { status: 413 });
  let run;
  try { run = JSON.parse(text); } catch { return new Response('bad json', { status: 400 }); }
  if (!run || typeof run !== 'object' || !run.data) return new Response('bad run', { status: 400 });
  if (!env.DB) return new Response(null, { status: 204 });
  const int = (v) => (Number.isFinite(+v) ? Math.round(+v) : null), str = (v, n) => String(v || '').slice(0, n);
  const vals = [str(run.client, 40), str(run.version, 40), int(run.level), int(run.cleared), run.endless ? 1 : 0, run.won ? 1 : 0, JSON.stringify(run.data),
    str(run.mode, 10) || 'run', int(run.flights), run.finished ? 1 : 0];
  if (run.run_id) {
    await env.DB.prepare(`INSERT INTO runs (client, version, level, cleared, endless, won, data, mode, flights, finished, run_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(run_id) DO UPDATE SET version = excluded.version, cleared = excluded.cleared, endless = excluded.endless, won = excluded.won,
        data = excluded.data, flights = excluded.flights, finished = MAX(runs.finished, excluded.finished), updated_at = excluded.updated_at`)
      .bind(...vals, str(run.run_id, 100)).run();
  } else {
    await env.DB.prepare('INSERT INTO runs (client, version, level, cleared, endless, won, data, mode, flights, finished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(...vals).run();
  }
  return new Response(null, { status: 204 });
}
