# Don Game – instructions for the building agent

Mobile-browser 3D racing game prototype (Three.js + Vite). Tilt-to-steer, auto-forward, 2 turbos, item boxes, 3 bots, one desert point-to-point track.

## Source of truth
- `docs/SPEC.md` – approved product spec (Hebrew). Defines WHAT the game does. Do not change behaviour without asking the user.
- `docs/TECH_SPEC.md` – technical spec (Hebrew, code in English). Defines HOW. Follow its architecture, file layout and milestones (section 17). Numbers in `config.js` are tuning values and may be adjusted.
- **Version 2 (current work):** `docs/PLAN_V2.md` (approved plan + the user's decisions) and `docs/TECH_SPEC_V2.md` (how to build it). Build V2-A -> V2-B -> V2-C -> V2-D, one milestone at a time, with the per-milestone checklist in TECH_SPEC_V2 §1 and §6.

## Working rules
- Build milestone by milestone (M0 → M7). After each milestone: `npm test` green, `npm run build` green, commit, push to `main`, then tell the user in Hebrew what they can try at https://galnigal-code.github.io/Don-Game/ .
- `src/sim/` must stay pure: no `three`, no DOM. All game logic lives there and is unit-tested with Vitest.
- No external models or audio files: build meshes from Three.js geometries and synthesize sound with Web Audio.
- **Exception approved for V2-D:** CC0 textures from Poly Haven (asphalt, sand, rock; 1K) in `public/textures/`, fetched with `tools/fetch-textures.mjs`, each listed in `docs/CREDITS.md`. The game must still run without them (procedural fallback). The session network allows `dl.polyhaven.org` and `api.polyhaven.com`; if the download command needs permission, ask the user, never work around it.
- Pin exact dependency versions (`three@0.186.1`).
- UI text is Hebrew, `dir="rtl"`, but turbo button is physically LEFT and item button physically RIGHT.
- No real car brands or logos.
- M2 requires the user to test tilt on a real Android phone. Stop and ask them before moving past M2.
- **The giant roller (V2-C) was built and then CANCELLED by the user on 2026-11-26** (not visible with a chase camera). It is shelved: `CONFIG.roller.ENABLED = false`, code and tests kept, `?roller=1` brings it back for testing. Do NOT enable it by default. The rule is back to: no car can ever be eliminated.
- V2-D (realism) is built and deployed.
- **Version 4 (built): calibrate once, no slowdown on sand, no falling (cliff guard rails, trenches filled), no fixed obstacles, track map.** `docs/PLAN_V4.md`. `npm run smoke:ui` checks the map layout.
- **Version 3 (built V3-A..V3-D, awaiting the user's real-phone test): play with friends.** `docs/PLAN_V3.md` + `docs/TECH_SPEC_V3.md`. Cloudflare Workers + Durable Objects room server (`server/`), pure room logic in `src/net/room/`, each phone owns its car, host owns bots, server arbitrates boxes/finish/scores. Build V3-A -> V3-D. "Race vs computer" must stay unchanged.
- Communicate with the user in Hebrew.

## Commands
- `npm run dev` – local dev server (keyboard controls work; tilt needs HTTPS → test on GitHub Pages)
- `npm test` – Vitest unit tests
- `npm run build` / `npm run preview`
- Smoke test: Playwright against preview with `?autopilot=1&fast=1&skipCalib=1&seed=1` (see TECH_SPEC §15.3). Chromium is preinstalled; do not run `playwright install`.


## DIRECTION CONTRACT (non-negotiable; this has regressed before)
The user reported "left/right is reversed" repeatedly. Root cause found with a real-browser test: the direction used to be learned from
ANY early movement (picking the phone up, or the OS rotating the screen to landscape when Play is tapped), so it was set by accident.
It now comes from a guided calibration that only reacts to HELD poses, plus jump compensation when the screen rotates.

The rules, which every change must keep:
1. Phone turned CLOCKWISE (right edge down) => steer RIGHT; counter-clockwise => LEFT. +steer = +d = right side of the road = right half of the screen.
2. The nose of the car points forward (-z); the road bends right when curvature > 0; keyboard/touch right = +steer.
3. Direction is measured on the device by the guided protocol (`Start` stays disabled until it finished) and, since V4 (user decision 28.11.2026),
   REMEMBERED per screen side (`dongame.dir`). Only a completed guided protocol or the "↔" button writes it; fidgeting, picking the phone
   up or rotating the screen never does. With a remembered direction there is no calibration screen: the centre is taken from how the phone
   is held during the 3-2-1 (`beginAutoZero/sampleAutoZero/finishAutoZero`). "כייל מחדש" (menu / lobby / results) forgets it.
   A wrong "straight" may only BLOCK the protocol, never reverse the wheel (tests: tilt.test.js "protocol safety").
4. During a race a visible "↔" button flips the direction instantly.

Before saying anything about direction is "fixed" or pushing a change that touches `src/input`, `src/render`, `src/sim/Car.js`, `src/sim/TrackModel.js`
or `src/ui/screens.js`, run:  `npm run build && npm run preview &` then `npm run test:direction`
(unit contract tests + `tests/real-sensor.mjs`, which drives the real Chromium sensor pipeline with a physical phone model, in 6 scenarios).
Never write test expectations by copying the game's own formulas: use `tests/helpers/phone.js` (independent physical model).

## VERSION VISIBILITY
Every build shows its id at the bottom-right of the screen ("גרסה <sha> · <date> UTC") and writes `version.json`; the running game polls it
and refreshes itself on the menu (or shows an update button elsewhere). When the user says something is "still broken", first check that
their screen shows the build you just pushed (GitHub Pages caches the page for ~10 minutes). Tell them the expected sha after every push.
