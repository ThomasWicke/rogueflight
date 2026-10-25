# Wingnut Circus

Roguelite flying-machine builder for phones, live at https://wingnut-circus.com. Build a craft on a 7×5 grid (Bad
Piggies style), launch it, fly it with simple but honest physics, and hit rising score targets across 8 contracts per
run (Slay the Spire / CloverPit structure). Plain JavaScript + Vite, no framework, no TypeScript. Installed and played as
a PWA on phones; hosted on Cloudflare Pages (deploys automatically when `main` is pushed).

Visual identity: **The Flying Circus**, a broke barnstorming troupe touring eight towns in a junk plane flown by a goat.
Read `docs/circus-style.md` before drawing or styling anything.

The owner is Thomas. He plays the game himself, gives feedback with screenshots, and decides on design questions.

## Where to read more

- `docs/recipes.md`: step-by-step checklists (add or tune a mod, change targets or the economy, storms, parts,
  layout, sheets, art). **Use the matching recipe for any such change.**
- `docs/design-notes.md`: how every system works in detail, the numbers, and why (what was tried and dropped). Read the
  section you are changing first, and add a sentence there when you change a rule or a number.
- `docs/circus-style.md`: palette, outlines, type, materials, motion, sound.
- `docs/security.md`: accounts, cloud saves, what is protected and how.

## Commands

```bash
npm install
npm run dev              # Vite dev server on http://localhost:5173 (host:true, so a phone on the same Wi-Fi can open it)
npm test                 # node:test checks of the simulation (tests/sim.test.js), about 2 s
npm run smoke            # browser smoke test: clicks through the game in headless Chrome on 3 screen sizes (~40 s)
npm run build            # -> dist/
npm run smoke -- --dist  # the same smoke test against the production build in dist/
npm run balance          # balance check: the bot on the last commit vs your working copy, same seeds (~3 min)
npm run bot -- 60 climb --seed=1   # the balance bot itself: 60 scripted runs; prints contracts reached and wins
```

Other commands (itch build, game server deploy) are in `docs/design-notes.md` under Commands and hosting.

## Rules that must never break

1. **`client/src/sim.js` has no DOM code.** Tests and the bot import it in node. All game rules, numbers and scoring
   live there; the UI only displays and calls it.
2. **No perpetual motion or endless farming.** Any new force, fuel source, refill or time bonus must stay bounded:
   by the flight clock (`FLIGHT_TIME` + at most 3 Flight permits), by the fuel proration in `step()` (`fk`), or by a
   per-flight cap. Ask "can I farm this forever?" and test it.
3. **Plain game words in the UI**: Run, Contract, Flight, Score, Target, Coins, Shop, Packs, Mods, Tuning, Storm reward,
   Difficulty, Endless. The circus fiction stays in pictures, town names and headlines.
4. **Minimal text.** Thomas asked to trim explainers. Prefer icons, markers, chips; one line per mod.
5. **Fair randomness.** Random bad luck is fine only when the player could see it coming (storms are shown at run
   start). Never add hidden random penalties.
6. **Phone first.** Portrait, one hand. Every UI change must also work sideways (844×390) and on desktop (1280×800).
   Use `var(--app-h,100dvh)` for screen height, never `100vh`/`100dvh` alone.
7. **Saves must survive.** localStorage keys stay `rogueflight-1`, `rogueflight-client`, `rogueflight-audio`,
   `rogueflight-auth` (the old name, on purpose). New fields on `save` or `run` must default sensibly when missing,
   because old saves don't have them. Removed mods go into `REMOVED_MODS` (refunded).
8. **Behaviour-preserving refactors only when asked**, and then verified with `npm test`, `npm run smoke` and the bot.

## Release checklist (every change that goes live)

1. `npm test` (all pass) and `npm run build` (no errors), then `npm run smoke` for any UI change.
   **If you changed numbers or rules in sim.js** (mods, targets, prices, coins, Difficulty, physics), run
   `npm run balance` and put its table in your reply to Thomas and in `docs/design-notes.md`. The bot buys mods of every
   kind, coin mods included; if a change is one it can't measure, say so and still post the table.
2. Bump `"version"` in `package.json`: patch (0.13.3 → 0.13.4) for fixes, minor (0.13 → 0.14.0) for new features. The
   title screen shows it.
3. If you changed how something works, update `docs/design-notes.md` (and this file if a rule or command changed).
4. Commit on `main` with a message like `0.13.4: what changed, in plain words`, ending with the co-author line your
   tool asks for (for Claude: `Co-Authored-By: Claude … <noreply@anthropic.com>`).
5. `git push` to `origin main` over SSH. If it fails with a publickey error, ask Thomas to run `ssh-add`; don't
   switch to HTTPS or the `gh` token (it has no write access).
6. Cloudflare Pages builds in about a minute. Check it is live:
   `curl -s https://wingnut-circus.com | grep -o '/assets/index-[^"]*\.js'`, then
   `curl -s https://wingnut-circus.com/assets/index-XXXX.js | grep -c '0.13.4'` (with the file name and new version).
7. Tell Thomas what changed and what is live. Say plainly what you could not test (for example on a real iPhone).
   If you skipped a step of this checklist or of a recipe, write "skipped" and why. Never give a reason about the code
   ("the bot can't measure this", "this can't overflow") that you haven't checked.

Never suggest itch.io uploads; Thomas does those himself when he wants. The website is the channel.

## File map

```
client/index.html        markup for all screens (title, hangar, flight, packs, guide, library, veil/sheet modal)
client/src/main.js       entry: fonts, style.css, ui.js, service worker registration
client/src/sim.js        PURE game logic: data tables (PARTS, MODS, TUNES, WEATHER, QUOTA…), physics step, craft
                         assembly, scoring, shop and economy, run state. No DOM.
client/src/ui.js         UI entry: imports the ui/ modules, wires hooks and sound, boots the title
client/src/ui/core.js    shared by all screens: the save + cloud sync, `ui` screen state, formatting, part icons,
                         $/veil/sheet, telemetry, sfx/buzz, confetti, notice. Imports no other ui module.
client/src/ui/title.js   title screen (run card, profile, stats, unlocks), ending a run
client/src/ui/hangar.js  hangar: drawer docking and tabs, poster, route, tour map, build grid, drag, launch button
client/src/ui/shop.js    the drawer's contents: shop (buy, reroll) and your mods (sell, log)
client/src/ui/rewards.js storm reward picker and the parts packs animation
client/src/ui/library.js mods library drawer
client/src/ui/flight.js  flight screen: input, frame loop (steps the sim), drawing, HUD, end of flight
client/src/ui/results.js score tally after a flight, run won / run over sheets
client/src/ui/daily.js   daily and random puzzles, leaderboard
client/src/ui/rooms.js   live rooms (Team, Elimination): lobby, server state, ghosts, bots, spectating
client/src/ui/profile.js history, name, cloud save settings and link codes
client/src/art.js        code-drawn parts and the goat pilot (drawPart, drawPilot, drawParachute)
client/src/world.js      flight backdrop: biomes, painted parallax layers, props, crowd, thermals, storm skies
client/src/decals.js     sponsor decal icon for every mod (drawDecal, decalURL)
client/src/audio.js      procedural Web Audio: sound effects, engine, wind, ragtime band
client/src/fiction.js    town names and newspaper headlines (pure)
client/src/troupe.js     painted pictures: home cards, tour map and its town spots
client/src/guide.js      "How to play" slides
client/src/net.js        client side of the game server (leaderboard, rooms, cloud save)
client/src/bots.js       Elimination bots (pure); client/src/pilot.js bot pilot settings (pure)
client/src/style.css     all styles; tokens on :root; landscape layouts at the end
client/dev/*.html        dev-only preview pages (art, decals, audio, cover, promo) at /dev/… on the dev server
client/public/           manifest, service worker (sw.js), _headers, icons, imprint and privacy page
tests/sim.test.js        simulation tests (node:test)
tests/smoke.mjs          browser smoke test (playwright-core with the installed Chrome)
tools/bot.js             balance harness; tools/art/ scripts for painted layers and sprites
functions/api/run.js     Pages Function storing run telemetry in D1 (schema.sql)
server/                  game server Worker: daily leaderboard, live rooms, accounts and cloud saves
docs/                    design notes, recipes, style guide, security, concept art
```

## UI modules: how they fit together

- `ui/core.js` loads first and imports no other ui module. When core needs a screen (redraw after a cloud save
  arrives), it calls `hooks.refresh()` / `hooks.flying()`, which `ui.js` fills in.
- The other modules import each other freely (circular imports are fine) **as long as their top-level code only
  declares things and binds their own buttons**. Never call another screen module's function at load time.
- Shared screen state lives in the `ui` object in core: `ui.slot` (which run is shown: `'run'`, `'daily'` or
  `'online'`), `ui.tab` (`'build'`, `'shop'`, `'mods'`), `ui.sel` (selected part), `ui.armAbandon`, `ui.armSell`.
  An imported `let` cannot be assigned from another module, so shared values that change go into `ui`; the current
  flight `F` is changed only inside flight.js (`dropFlight()` clears it), room state `ROOM`/`NET` only inside rooms.js.
- `R()` is the run being shown (`save[ui.slot]`). After changing it, call `persist()` (saves locally and to the cloud
  a few seconds later), then re-render (`renderHangar()`, `renderTitle()` …).
- Every UI module imports the sim names it uses from `../sim.js`. When you add an export to sim.js, import it by name
  where you use it.
- Pop-ups: one modal, `#veil` with `#sheet` inside (see `notice()` in core.js and "Add a screen or sheet" in recipes).
- In dev builds `window.__rf` exposes the flight for debugging (`__rf.F()`, `__rf.frame(t)`, `__rf.ctl`).

## Code style and short names

The code is dense on purpose (it grew from fast prototyping): many one-line functions, template-string HTML, short
names. Match the surrounding style; don't reformat files you aren't changing. Comments explain *why* in plain words.

| name | meaning |
| --- | --- |
| `S` | flight state from `newFlight` (position x/y, velocity vx/vy, angle th, fuel, t, events, done/landed/crashed) |
| `K` | assembled craft from `makeCraft` (parts, mass m, counts, fuelMax, centre of mass com) |
| `st` | derived stats for a flight from `flightStats(run)` / `stats()` (multipliers from mods, tunings, storm) |
| `r`, `run` | run state (`newRun`): coins, inv, cells, mods, modLv, tune, stage (contract index), flight, log, shop, phase |
| `F` | the current flight on screen (flight.js): `{st, K, S, ctx, cam, parts, toasts, …}` |
| `ctx` | the scoring context from `flightCtx(run)`, **except** in flight.js drawing code, where `ctx` is the canvas 2D context and the scoring context is `F.ctx` |
| `f`, `sum` | flight summary from `summaryOf(S, K)` (dist, maxY, maxV, landed, coins, loops …) |
| `sc` | score result from `scoreFlight(f, ctx)`: `{base, mult, xm, total, lines}` |
| `lv`, `mv`, `has` | mod levels `{id: level}`, mod value at its level, owned check |
| `M` | one mod's entry in `MODS` |
| `$` | `document.getElementById` |
| `wv` | the view handed to `drawWorld` |

Score formula: `score = (distance + flat points) × (1 + Σ additive mult) × Π ×mult`. Physics runs in fixed steps
(`SIM_DT`), so the same inputs give the same flight on every device.

## How to verify a change

- Rules, numbers, scoring, physics: `npm test`, plus a new or updated test in `tests/sim.test.js` (a cap test must use
  more than the cap, so it fails if the cap is wrong). Then `npm run balance`.
- UI: `npm run smoke`, then look at it: `npm run dev`, open http://localhost:5173 at phone size (390×844), sideways
  (844×390 **and** the small 667×375) and desktop. Check the browser console for errors.
- Test layouts with the **biggest realistic content**, not a light mock-up: a cleared contract with a dozen stunt chips
  and unlocks, a long history, long town names, three storms. In dev builds `window.__rf.results(out, S, f)` opens the
  score sheet with any made-up result. A sheet must fit or scroll; its main button must always be reachable.
- Never claim something works on a phone if you only saw it in a desktop browser; say what you checked.
