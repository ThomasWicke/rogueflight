# rogueflight

Roguelite flying-machine builder for phones. Build a craft on a 7×5 grid (Bad Piggies style), launch it, fly it with simple but honest physics, and hit escalating score quotas across 8 contracts per run (Slay the Spire / CloverPit structure). Plain JS + Vite, no framework. Installed and played as a PWA, deployed on Cloudflare Pages.

The game was prototyped as a single-file Claude artifact under the working title **Skyward** and ported here. Old run codes from the prototype start with `SKYWARD ` instead of `ROGUEFLIGHT `.

## Commands

```bash
npm install
npm run dev       # Vite dev server, host:true so a phone on the same Wi-Fi can open it
npm test          # node:test checks of the simulation core (tests/sim.test.js)
npm run bot -- 20 climb --seed=1   # balance harness: 20 scripted runs (policies: climb, hands; --verbose lists every flight)
npm run build     # -> dist/
npm run preview   # serve dist/ (service worker only registers in production builds)
```

## Layout

```
client/index.html        markup for all screens (title, hangar, flight, veil/sheet modal)
client/src/main.js       entry: self-hosted fonts (@fontsource), style.css, ui.js, service-worker registration
client/src/sim.js        PURE game logic, no DOM. Data tables, physics step, craft assembly, scoring, economy, run state
client/src/guide.js      "How to play" drawer: swipeable slides with small HTML/SVG illustrations (opened from the title and the ? chip in the hangar)
client/src/ui.js         everything DOM/canvas: part art, hangar (build/shop/mods), flight loop + HUD + input, result screens
client/src/style.css     all styles; dark blueprint theme, tokens on :root
client/public/           manifest.webmanifest, sw.js, _headers (Cloudflare), icons/
tests/sim.test.js        headless sim checks (no browser)
tools/bot.js             balance harness (scripted shopper, builder, pilot), prints contracts reached and per-contract score spread
```

`sim.js` must stay DOM-free: tests and the bot import it directly in node. `ui.js` imports every sim export by name.

Code style is dense (many one-line functions, short names: `S` flight state, `K` assembled craft, `st` derived stats, `r`/`run` run state, `F` current flight in the UI). It came from fast artifact iteration. Readability refactors are welcome but keep behavior identical and verify with `npm test`, the bot, and a manual play-through.

## How the game works

### Run structure
- `newRun(ceilingLevel, meta)`: every run starts the same (`START`): cockpit alone on the bench, empty inventory, 12 coins, shop open, and 4 parts packs.
- Parts packs (`grantPacks`, `openPack`): one random part each (`PART_W` weights), saved in `run.packs` until opened. Contract 1 gives 4 (always a tank, a wing, a propeller or rocket, plus one random, shuffled); every later contract gives 2 when it starts (on clearing the previous one, and when endless begins). The hangar opens the pack screen whenever packs are waiting: tap to shake and tear, the part bursts out (gold rays for engines) and flies to the tray; "Open all" skips.
- 8 contracts × 3 flights. A contract's score is the sum of its flights. `QUOTA=[500,1100,2000,4000,7500,16000,30000,54000]`, ×(1+0.25·ceiling). Endless mode after a win multiplies the quota by 2.5 per extra contract.
- Storm contracts are 3, 6 and 8 (`isStorm`). Their weather is rolled at run start (`weatherOf`) and shown from the start as forecast chips. Weathers: headwind, thunderheads (altitude ceiling with downdraft), thin air (density ×0.5), gusts, mail run (cargo mass), fuel rationing, short catapult.
- Shop: always open. 3 parts (wing 4, propeller 5, rocket 6, tank 4, balloon 4, frame 3 coins), 2 tunings and 3 mods. New stock only arrives after a contract is cleared (`phase:'shop'` = between contracts, which shows START CONTRACT). Reroll costs 2 + the number of rerolls. Up to 5 mods; selling refunds half.
- Economy: 3 coins per flight plus coins picked up in flight (Sponsor mod +3). Clearing a contract pays 6 + 2 per unused flight, +4 for a storm contract; Piggy Bank adds interest.
- Unlocks by contracts cleared in one run (`UNLOCKS`): contract 4 unlocks Afterburner and Ram Scoop, 6 unlocks Solar Wings and Antigravity Coil, 8 unlocks 4 rare score mods and Ceiling 1.

### Building (`makeCraft`, `linkage`)
- 7×5 grid, cockpit fixed at (2,2). Sockets per edge `[right(nose), top, left(tail), bottom]` in `SOCK`. Structural parts (`STRUCT`: cockpit, frame, tank) pass connections on; leaf parts must bolt to a structural part.
- Wings mount on their bottom or side edges, balloons on their bottom edge (the string), props on their back edge, rockets on their top, bottom or nose edge. Props are blocked (no thrust, red outline) if the cell in front is occupied, rockets if the cell behind is occupied.
- The bench overlay shows bolts and open sockets, the centre-of-mass marker, the centre-of-lift arrow, and dashed thrust lines (red when more than `GIMBAL`=0.4 m off the centre of mass).
- Editor input: tap places the selected part or removes the same part. Press and hold (280 ms) to pick a part up; drop it on an empty cell to move it or onto a part to swap.

### Flight physics (`step`, called in substeps of at most 12 ms and 0.6 m of travel; the tests use 1/240 s)
- Commanded-lift model: an autopilot asks the wings for lift (`Lcmd`), capped by wing area × air density × v² and by balance (`balanceOf`: centre of lift vs centre of mass). A trim assist with limited authority keeps the nose stable. The player's pitch input adds or removes commanded lift. Tumbling loses lift.
- Throttle 0–100% (one slider for props and rockets together) scales thrust and fuel burn. Engines idle with no fuel or at 0% throttle; a slow, idle craft that is not descending ends the flight ("becalmed").
- Quadratic drag. Air density is exp(−y/8500). Extra vacuum drag terms appear at altitude, and speed is capped at the speed of light.
- Balloons lift ∝ density and burst at 2 km (6 km with Weather Envelope) or when the POP button is pressed.
- Thermals are smooth columns (cos² profile). Gusts are time-varying vertical forces whose net energy gain per flight is capped (~60 m of height) so they cannot be pumped for infinite climb.
- A flight ends after `FLIGHT_TIME` (300 s of sim time, "Out of time"). The HUD shows the time left under the speed, amber from 60 s, red and pulsing from 20 s.
- Crash if a touchdown impact exceeds 15 m/s, or exceeds 5 m/s nose-down past 45°. Rubber Hull bounces instead.
- Far zoomed out, the craft keeps a minimum on-screen size (about 32 px across) with a soft halo, instead of shrinking to nothing.
- UI fast-forward: from 12 s into a flight, time speeds up to 4× but only while no pitch input has been given for a second. Any input snaps back to real time. A ▸▸ badge shows when it is active.

### Scoring (`scoreFlight`)
`score = (distance + flat) × (1 + Σ additive mult) × Π xmult`.
- Additive: clean touchdown +0.5, low pass +0.25, loop +0.5, thermal +0.1, coin +0.05 each, sound barrier +1, space +2.
- Mods modify these values. Xmult mods: Greaser, Opening Act, Third Time Lucky, Frugal, Minimalist, Logbook, Compound Interest, Sonic Boom, Escape Plan.

## Design principles (from the player's feedback)
- The player loves roguelites (Slay the Spire, CloverPit), physics games (Bad Piggies, Learn to Fly) and systems. An earlier idle-style version with infinite upgrades "went nuclear" (speed of light, trillions of coins) and was rebuilt as a roguelite: runs are scored and limited, and runaway "criticality" should be rare and spectacular, not the default.
- **No perpetual motion or infinite exploits.** Past fixes: Ram Scoop, Recycler and Solar were gated; the gust pumping exploit is capped by energy; holding nose-up forever no longer works; hovering on balloons ends the flight. Test any new force or mod against "can I farm this forever?".
- **UI should be intuitive with minimal text.** The player explicitly asked to trim explainers. Prefer visuals (sockets, markers, chips, icons) and one-line mod descriptions.
- **Fair randomness.** Bad luck is fine when it punishes a risk the player could see; it is unfair when hidden or unavoidable. Hence storms are revealed at run start. Ask "could the player have seen it and responded?" before adding random modifiers.
- Mobile portrait, played one-handed in short sessions. Respect safe areas (`--reserve` = `env(safe-area-inset-top)`).
- Balance feedback: the player pastes "Copy run" codes (Mods tab, end screens, logbook). The format is `ROGUEFLIGHT {json}` (prototype codes: `SKYWARD {json}`) with kit, mods, tune, inv, a compact cells string (`c22 p32 …` = type initial + column + row), and a log of `[contract, flight, score, distance, mult]`.

## Balance notes
- The bot starts from the universal start, opens its packs and shops before every flight, and picks its layout by test-flying variants of its inventory in the forecast weather. Pilots press buttons like a player (pitch −1/0/+1, re-decided every 0.2 s). `climb` waits for flying speed, climbs at about 35° under power, then glides hands-off, using full or 60% throttle (whichever tested better for the build). That is how a good human flies. `hands` is the old weak baseline. `--seed=N` makes runs repeatable, so compare balance changes with the same seed.
- Baseline with packs (30 runs, `--seed=7`, Ceiling 0): `climb` clears 5.8 contracts on average and wins 5 of 30; `hands` clears 5.2 and wins 1. Over 200 runs the pack economy came out even with the old one (5.68 vs 5.75 contracts for `climb`). Median flight scores fall behind the quota from contract 3 on, so runs are won by the occasional big flight (thermals, sound barrier, xmult mods).
- One human data point: the player won all 8 contracts on their first serious run with a light, strong-prop glider (before quotas 6–8 were raised by about 20%). A balloon-heavy build later died to thin air on contract 6; that loss motivated revealing storms early.
- Additive per-part mods (Wingman +0.3 per wing, Fuel Hauler +0.4 per tank) stack strongly with big builds.

## Open items / ideas
- Consider a browser smoke test (Playwright) for the main flow: start → buy → build → launch → results.
- Deploy: Cloudflare Pages, build `npm run build`, output `dist`. `_headers` keeps `sw.js` and HTML uncached. Bump `CACHE` in `client/public/sw.js` if cached files ever need a hard reset.
