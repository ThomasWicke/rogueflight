# The Flying Circus: style guide

Wingnut Circus's world: a broke barnstorming troupe tours eight towns per season in a junk plane flown by a goat.
Every flight is a show. This guide is the rule set every screen, part, icon and sound follows.
Design brief with the reasoning: https://claude.ai/artifact/Vcut2B3oqPzFQHH3y1YKEz

## Pillars (the tie-breakers)
1. **Built from junk, flown with heart.** Hand-made, scavenged, slightly wonky. Nothing sleek. Duct tape is a motif.
2. **Every flight is a show.** Tricks get applause, records get fireworks, the score tally is the encore.
3. **Honest air.** Physics stay readable. Whimsy never hides the mass marker, lift arrow, thrust lines or wind.
4. **A run is a journey.** Eight towns move through one day, dawn to night.

## Palette (canvas hex; CSS tokens in style.css use the same values)
| Token | Hex | Use |
|---|---|---|
| ink | `#22283a` | every outline, body text on paper |
| paper | `#f3e7ce` | poster paper, cards, sheets |
| paper2 | `#e6d4ae` | paper shade, pressed states |
| canvas | `#fbf5e8` | wing fabric, highlights |
| red | `#d2402f` | barn red, primary accent, buttons |
| red2 | `#a92f22` | red shade |
| brass | `#e9a93b` | brass, mustard, coins, gold |
| brass2 | `#b97d1c` | brass shade |
| teal | `#3b9aa6` | sky teal, secondary accent |
| teal2 | `#2a7580` | teal shade |
| wood | `#b7793f` | planks, frames |
| wood2 | `#8a5428` | wood shade, grain |
| wood3 | `#d9a066` | wood highlight |
| tin | `#b9c3c9` | tanks, rivets, metal |
| tin2 | `#7f8d96` | metal shade |
| grass | `#7faf55` | ground |
| grass2 | `#5e8f43` | ground shade |
| night | `#0c1a2c` | the finale night, dark UI |
| good | `#4fa35b` | success, "sold out" |
| rare | `#7a4fa0` | rare enamel |

Rare parts: purple enamel (`rare` #7a4fa0) replaces the red trim, the crate turns pale balsa, the tank copper, plus the brass sparkle.

Rarity is encoded by **material and shape**, never color alone: common = paper decal (torn-edge rectangle),
uncommon = tin plate (rounded rect with rivets), rare = enamel badge (shield/circle with brass rim).

## Drawing rules (canvas)
- **Outline:** ink, round joins and caps, one weight on screen: about 2.5 px at the size it is shown.
  Draw functions take a line width in their own units so callers can keep it constant at any zoom.
- **Shape:** chunky and slightly off-square. Avoid perfect symmetry: nudge a corner, tilt a stripe, vary a plank.
- **Light:** one warm key light from the upper left. Flat shade shapes (a darker band on the lower right),
  one small highlight (canvas or white at ~50%). No gradients on objects; gradients belong to the sky.
- **Material cues:** wood = planks with 1-2 grain lines and nail dots; canvas = stitched seam lines (short dashes);
  tin = rivets and a dent; brass = a bright highlight stroke; tape = a pale strip with ragged ends.
- **No text inside art** (icons, parts). Numbers and words live in the UI layer.
- **Readability:** silhouettes must read at 24 px. Test every icon at 24, 40 and 96 px.

## Type
- **Display:** Bowlby One. Town names, headlines, stamps, the logo, big buttons. Sparingly.
- **UI:** Nunito (400, 700, 800, 900). Everything players read in passing. Sentence case. Tabular numbers where digits line up.
- **Handwriting:** Caveat 600, only for price tags and the pilot's notes.

## UI materials
- **Poster card:** paper fill, 2.5 px ink outline, 4 px solid ink offset shadow (down-right), radius 6 px.
- **Big button:** red fill, paper text in Bowlby One, ink outline, ink drop shadow 0 4px; pressed moves down 3 px.
- **Wood:** plank backgrounds for the barn/workbench (horizontal planks, subtle grain).
- **Texture:** a faint halftone and paper grain over paper surfaces; never over the physics overlay.
- Uppercase tracked labels are rare (one per screen at most).

## Motion
- Things settle with a little overshoot (`cubic-bezier(.2,1.4,.4,1)`), nothing snaps.
- Idle life: the crowd sways, flags flap, the pilot blinks.
- Respect `prefers-reduced-motion`: keep state changes, drop the flourishes.

## Sound
- Swing and ragtime band feel; foley (wood, canvas, rope, tin, crowd). A procedural engine.
- A three-note brass motif is the signature (logo, contract cleared, win).

## Words: plain game terms
The circus lives in the art, the sound, town names and the Gazette headlines. Every label, button and rule uses plain game terms,
the same everywhere: **Run**, **Contract** (shown with its town's name), **Flight**, **Score**, **Target**, **Coins**, **Shop**,
**Packs**, **Mods** (the art draws them as decals), **Tuning**, **Storm**, **Storm reward**, **Difficulty**, **Endless**.
Avoid synonyms (tour, season, show, crowd, cash, dealer, crate, gift, encore).
