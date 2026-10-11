# Wingnut Circus

A roguelite flying-machine builder for your phone (formerly RogueFlight). Buy parts, bolt them onto a grid, launch, and fly far enough to hit each contract's score quota. Eight contracts per run, three flights each.

## Develop

```bash
npm install
npm run dev     # open the printed Network URL on your phone (same Wi-Fi)
npm test
```

## Deploy (Cloudflare Pages)

Connect the GitHub repo in the Cloudflare dashboard (Workers & Pages → Create → Pages → Connect to Git):

- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION=22`

Or deploy from the command line:

```bash
npm run build
npx wrangler pages deploy dist --project-name rogueflight
```

### Run telemetry (optional)

Finished runs are posted to `/api/run` and stored in a D1 database for balancing. Until D1 is set up, the endpoint accepts and drops them.

1. Cloudflare dashboard → Storage & databases → D1 → Create database `rogueflight`.
2. Open its Console and run the contents of `schema.sql`.
3. Workers & Pages → rogueflight → Settings → Bindings → Add → D1 database: variable name `DB`, database `rogueflight`. Redeploy.

Query it from the D1 console, for example `SELECT level, cleared, won, data FROM runs ORDER BY id DESC LIMIT 20;`.

Then open the site on your phone and use **Share → Add to Home Screen** (iOS) or **Install app** (Android). The game works offline after the first load.

See `CLAUDE.md` for how the game works and how the code is organized.
