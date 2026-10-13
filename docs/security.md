# Security notes

What Wingnut Circus protects, how, and what to check. Keep this short and current.

## What is at stake
- Cloud saves (game progress), a nickname for the daily leaderboard, anonymous telemetry runs.
- No payments, no passwords, no email (yet). Accounts are guests: no personal data at all.
- Worst realistic cases: someone tampers with saves or the leaderboard; account spam fills the database.

## Accounts and cloud saves (server/accounts.js)
- Better Auth, **pinned exactly** in package.json (1.7.7 at introduction, which includes the critical OAuth fixes
  published 2026-09-30). Only the core plus the `anonymous` and `bearer` plugins; none of the plugins with the worst
  advisory history (SSO, SCIM, OAuth provider, Stripe). Its telemetry is switched off.
- Sessions are bearer tokens (no cookies), so CSRF does not apply; the token lives in the game's localStorage
  (`rogueflight-auth`). Sessions last a year and renew on use (a lost token means a lost guest account).
- The signing secret `BETTER_AUTH_SECRET` is a Cloudflare Worker secret (`wrangler secret put`), never in the repo.
- Every save request resolves the session server-side and reads or writes only that account's row. Saves are capped
  at 300 KB and use a revision number, so an older device cannot silently overwrite a newer save.
- Link codes (second device): 8 characters from 32 symbols, single use, 10 minutes, deleted when used.
- Rate limits, stored in D1 (in-memory counters do not work across Worker instances): Better Auth endpoints 60/min,
  guest sign-in 30/min, link-code attempts 10/min, all per client address (`cf-connecting-ip`).
- A Better Auth instance is created per request (sharing one across requests made later requests hang).

## Tested (2026-10-13, against the live server)
No token and fake tokens get 401; player B cannot read player A's save; stale revisions get 409; codes work once;
guessed codes fail; link without a session gets 401; oversized saves get 413; rate limits return 429.

## Known gaps
- Scores (daily leaderboard, rooms) are reported by the clients and trusted: fine for a friends beta, needs
  server-side checks before strangers play.
- Anyone can create guest accounts (rate-limited). Unused guest accounts are not cleaned up yet.

## Routine
- At the start of server work: `npm audit` and the Better Auth advisories
  (`gh api repos/better-auth/better-auth/security-advisories`); update the pin when a relevant fix lands.
- Turn on GitHub Dependabot alerts for the repo (needs the owner's account).
