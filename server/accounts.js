// Accounts and cloud saves.
// Every player is a guest account (Better Auth's anonymous plugin): no email, no password, no personal data. The game
// signs in once and keeps the session token (bearer plugin: Authorization: Bearer <token>, no cookies, so it works
// across the game's and the server's domains). The save lives here under that account, so it survives updates,
// address changes and new devices. A second device joins with a short link code. Later, Sign in with Apple can attach
// to the same account.
//   /api/auth/*          Better Auth (POST /api/auth/sign-in/anonymous starts a guest account; the token comes back
//                        in the set-auth-token header)
//   GET  /save           this account's save: {save, rev, t} (save null if none yet)
//   PUT  /save {save, rev, t}   store it if rev matches the stored one (else 409 with the stored copy); returns {rev}
//   POST /link           a link code for this account, 10 minutes valid: {code, expires}
//   POST /link/claim {code}     sign this device into the account behind the code: {token}
// Safety: Better Auth is pinned (package.json) and only the anonymous and bearer plugins are used; its telemetry is
// off; sessions last a year and renew while the game is played; every save request checks the session and touches
// only that account's row; link codes are 8 characters from a 31-letter alphabet, single use and short-lived.
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins/anonymous';
import { bearer } from 'better-auth/plugins/bearer';

const ORIGINS = ['https://wingnut-circus.pages.dev', 'https://*.wingnut-circus.pages.dev', 'https://wingnut-circus.com', 'https://www.wingnut-circus.com',
  'http://localhost:5173', 'https://*.itch.zone', 'https://*.hwcdn.net'];
const YEAR = 365 * 24 * 3600;
const LINK_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', LINK_MS = 10 * 60 * 1000, SAVE_MAX = 300000;

// link-code attempts per client address and minute, counted in the database (codes are 32^8 and expire anyway)
async function tooMany(env, ip) {
  const minute = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare('INSERT INTO link_tries (ip, minute, n) VALUES (?, ?, 1) ON CONFLICT(ip, minute) DO UPDATE SET n = n + 1 RETURNING n').bind(ip, minute).first();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM link_tries WHERE minute < ?').bind(minute - 5).run();
  return row.n > 10;
}

// a fresh instance per request: sharing one across requests let a request that ended mid-query keep the database
// layer's connection lock, and every later request on that Worker instance hung (seen in testing)
function auth(env, url) {
  return betterAuth({
    database: env.DB, secret: env.BETTER_AUTH_SECRET, baseURL: url.origin, basePath: '/api/auth',
    trustedOrigins: ORIGINS, telemetry: { enabled: false },
    session: { expiresIn: YEAR, updateAge: 24 * 3600 },
    // Better Auth only rate-limits when it detects production, which it does not on Workers: switch it on, keyed by
    // Cloudflare's client address. Guest sign-ins are capped harder (anyone can make one; this stops floods).
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60, customRules: { '/sign-in/anonymous': { window: 60, max: 30 } } },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    plugins: [anonymous({ generateName: () => 'Pilot' }), bearer()],
  });
}
const userOf = async (env, url, req) => { const s = await auth(env, url).api.getSession({ headers: req.headers }); return s && s.user ? s.user : null; };

// returns a Response for account routes, or null if the path is not one of them
export async function accounts(req, env, url, json) {
  const p = url.pathname;
  if (p.startsWith('/api/auth/')) return auth(env, url).handler(req);
  if (p === '/save') {
    const user = await userOf(env, url, req); if (!user) return json({ error: 'not signed in' }, 401);
    const row = await env.DB.prepare('SELECT data, rev, t FROM saves WHERE user_id = ?').bind(user.id).first();
    if (req.method === 'GET') return json(row ? { save: JSON.parse(row.data), rev: row.rev, t: row.t } : { save: null, rev: 0, t: 0 });
    if (req.method !== 'PUT') return json({ error: 'method' }, 405);
    const text = await req.text(); if (text.length > SAVE_MAX) return json({ error: 'save too large' }, 413);
    let b; try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    if (!b || typeof b.save !== 'object' || !b.save) return json({ error: 'no save' }, 400);
    const rev = row ? row.rev : 0;
    if ((b.rev | 0) !== rev) return json({ error: 'stale', save: row ? JSON.parse(row.data) : null, rev, t: row ? row.t : 0 }, 409);
    const t = Math.floor(+b.t) || Date.now();
    await env.DB.prepare('INSERT INTO saves (user_id, data, rev, t, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, rev = excluded.rev, t = excluded.t, updated_at = excluded.updated_at')
      .bind(user.id, JSON.stringify(b.save), rev + 1, t).run();
    return json({ rev: rev + 1 });
  }
  if (p === '/link' && req.method === 'POST') {
    const user = await userOf(env, url, req); if (!user) return json({ error: 'not signed in' }, 401);
    const bytes = crypto.getRandomValues(new Uint8Array(8)), code = Array.from(bytes, (x) => LINK_CHARS[x % LINK_CHARS.length]).join('');
    const expires = Date.now() + LINK_MS;
    await env.DB.batch([env.DB.prepare('DELETE FROM link_codes WHERE user_id = ? OR expires < ?').bind(user.id, Date.now()),
      env.DB.prepare('INSERT INTO link_codes (code, user_id, expires) VALUES (?, ?, ?)').bind(code, user.id, expires)]);
    return json({ code, expires });
  }
  if (p === '/link/claim' && req.method === 'POST') {
    if (await tooMany(env, req.headers.get('cf-connecting-ip') || '?')) return json({ error: 'Too many tries. Wait a minute and try again.' }, 429);
    let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (code.length !== 8) return json({ error: 'That code is not valid.' }, 400);
    const row = await env.DB.prepare('DELETE FROM link_codes WHERE code = ? RETURNING user_id, expires').bind(code).first();
    if (!row || row.expires < Date.now()) return json({ error: 'That code is not valid or has expired.' }, 400);
    const ctx = await auth(env, url).$context, session = await ctx.internalAdapter.createSession(row.user_id);
    return json({ token: session.token });
  }
  return null;
}
