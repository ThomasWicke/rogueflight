# rogueflight

A roguelite flying-machine builder for your phone. Buy parts, bolt them onto a grid, launch, and fly far enough to hit each contract's score quota. Eight contracts per run, three flights each.

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

Then open the site on your phone and use **Share → Add to Home Screen** (iOS) or **Install app** (Android). The game works offline after the first load.

See `CLAUDE.md` for how the game works and how the code is organized.
