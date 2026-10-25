# Recipes

Checklists for the changes that come up again and again. Each one lists every place the change touches; missing one
is the most common way to break the game quietly. Finish every recipe with the release checklist in CLAUDE.md.

## Add a mod

1. `client/src/sim.js`, `MODS`: one entry, for example
   `groundeffect:{name:'Ground Effect',r:'U',tag:'Body',d:'Below 10 m: drag ×{v}.',v:[.75,.6,.5],how:'…'}`.
   - `r`: rarity `C`, `U` or `R` (sets weight and price in `RARITY`).
   - `tag`: one of the existing tags (Engine, Fuel, Body, Score, Coins, …), shown in the library filter.
   - `d`: one short line; `{v}` / `{w}` show this level's value, `{v%}` shows v×100 %.
   - `v` (and `w`): three values, for Lv 1 / 2 / 3. Lv 1 weaker than you would first pick, Lv 3 a bit stronger.
   - `how`: one plain sentence on how to trigger it (the mods library shows it).
   - optional: `lock:N` (unlocked after clearing contract N in one run, then add it to `UNLOCKS` text), `noDaily:true`
     (kept out of daily puzzles and rooms, for mods about storms or the run).
2. Make it do something, in exactly one of these places:
   - physics: `stats()` turns it into a stat (`lowDrag:has('groundeffect')?mv('groundeffect'):1`), `step()` uses the stat;
   - score: a line in `scoreFlight` (`addM(name, value)` for +mult, `addX(name, value)` for ×mult, flat points to base);
     anything it needs from the flight goes into `summaryOf`, anything from the run into `flightCtx`;
   - coins: `flightCoins` (after a flight, cap it per flight) or `clearContract`.
3. Ask "can I farm this forever?" (see Design rules in CLAUDE.md). Anything that adds force, fuel or time must stay
   bounded by the flight clock and the fuel proration in `step` (`fk`).
4. `client/src/decals.js`: a motif function with the same id (copy a neighbour; open `/dev/decals.html` on the dev
   server to see it). Without one the mod shows a plain letter.
5. If it fires during a flight: a toast in the event switch of `frame()` in `client/src/ui/flight.js` (only when owned).
6. `tools/bot.js`: add to `MOD_VALUE` (0–10, how much the scripted bot wants it) if the bot can use it; add to `FIXED`
   if its value can't be measured by test-flying (coins, run-long effects).
7. `tests/sim.test.js`: a test that the mod changes the score or the flight (see the 0.13 mod tests near the end).
8. Run `npm test`, then the bot on 3 seeds before and after (below). Note the numbers in `docs/design-notes.md`
   (Scoring section, one sentence: what it does, why, measured effect).

Removing a mod: delete it from `MODS` and add its id and rarity to `REMOVED_MODS`, so saved runs get a refund.

## Change a mod's numbers

`v`/`w` in `MODS`, and the `d` text if the wording changes. Update the matching test in `tests/sim.test.js`. Run the
bot before and after. Write the old and new values and the reason into `docs/design-notes.md`.

## Change score targets or the economy

- Targets: `QUOTA` in `sim.js` (8 contracts). Endless and Difficulty scale from it (`quotaFor`).
- Coins: `settleFlight` (per flight), `clearContract` (contract reward, unused flights), `flightCoins` (coin mods),
  shop prices in `PARTS`, `RARITY`, `tuneCost`, `rerollCost`.
- Always measure: `npm run bot -- 60 climb --seed=1`, then `--seed=2` and `--seed=3`, on the old code and on the new
  code (a copy made with `git stash` or `git worktree`). Compare the average contracts and wins. Runs are noisy
  (about ±0.3 contracts), so one seed proves nothing. Record both numbers in `docs/design-notes.md`.

## Add or change a storm

1. `sim.js`: `WEATHER` (name and the one-line description by severity) and `weatherFx` (what it changes:
   wind, ceiling, air density, gusts, cargo, fuel, launch, clock). `step()` reads those fields.
2. `client/src/ui/core.js`: a pictogram in `WXI` (24×24 SVG path, stroke only).
3. `client/src/world.js`: its sky (search for `wx==='headwind'` for examples).
4. Test it: `npm run bot -- 100 climb --storm=<id> --seed=1` and compare with `--storm=none` (see Balance notes).
5. Storms are revealed at run start on purpose (fair randomness): never add a hidden one.

## Add a part type or a rare part

Parts touch a lot: `PARTS`, `PALETTE`, `SOCK` (which edges connect), `STRUCT` (passes connections on), `makeCraft`
(mass, lift, thrust, fuel), `PART_W` (pack weights), `RARE` for rare variants, `drawPart` in `art.js`, the cell code
letter (`cellCodeOf` in `ui/core.js`, `cellsOf` in `bots.js`), and the bot. Ask before starting; it is a big change.

## Change the layout or styles

- All styles are in `client/src/style.css`; colours and sizes are tokens on `:root`. Follow `docs/circus-style.md`.
- Check three sizes: phone portrait (390×844), sideways phone (844×390) and desktop (1280×800). `npm run smoke` runs
  all three and fails if the tour sheet runs off a sideways phone; for anything visual, also look at it with the dev
  server and a phone-sized window.
- Screen height: use `var(--app-h,100dvh)`, never plain `100dvh` or `100vh` (iOS keeps the portrait height after
  turning the phone). Respect the safe area (`--reserve`).
- Landscape at least 640 wide is the docked layout (`WIDE` in `ui/hangar.js` and the media queries at the end of
  style.css).

## Add a screen or sheet

Sheets (pop-ups) all use the one `#veil` / `#sheet` modal: set `sheet.className`, fill `sheet.innerHTML`, set
`veil.hidden=false`, bind the buttons by id, and hide the veil when done (copy `notice()` in `ui/core.js`). Put the
function in the ui module of the screen it belongs to. Keep text short: plain game words, one line where possible.

## Make art

Always make two versions and let Thomas pick. Code-drawn art (parts, goat, decals, world) follows
`docs/circus-style.md`.

Painted art (backdrops, the tour map, icons) is generated with the Codex CLI on Thomas's ChatGPT plan. He is logged in
already: never set `OPENAI_API_KEY` and never handle the login. One image per run, from an empty scratch folder:

```bash
codex exec -i <reference.png> --ignore-user-config --ephemeral --skip-git-repo-check --sandbox read-only -C <empty-dir> -o <last.txt> "Use your built-in image generation tool to create exactly one image ... reply with only the file path. Image prompt: ..."
```

Images land in `~/.codex/generated_images/<session-id>/*.png`, about 80 s each. Start every prompt with the same style
block (medium, outline colour, palette hex codes, "no text") and pass 1–3 existing images with `-i` so it matches.
Sprites go on flat #FF00FF and are keyed out afterwards (`tools/art/`). Prompts and examples: `docs/concept/` (the
prompt text sits next to each image) and `docs/concept/README.md`. Parallax layers: see "Art" in
`docs/design-notes.md`.
