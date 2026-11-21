# Don Game – instructions for the building agent

Mobile-browser 3D racing game prototype (Three.js + Vite). Tilt-to-steer, auto-forward, 2 turbos, item boxes, 3 bots, one desert point-to-point track.

## Source of truth
- `docs/SPEC.md` – approved product spec (Hebrew). Defines WHAT the game does. Do not change behaviour without asking the user.
- `docs/TECH_SPEC.md` – technical spec (Hebrew, code in English). Defines HOW. Follow its architecture, file layout and milestones (section 17). Numbers in `config.js` are tuning values and may be adjusted.

## Working rules
- Build milestone by milestone (M0 → M7). After each milestone: `npm test` green, `npm run build` green, commit, push to `main`, then tell the user in Hebrew what they can try at https://galnigal-code.github.io/Don-Game/ .
- `src/sim/` must stay pure: no `three`, no DOM. All game logic lives there and is unit-tested with Vitest.
- No external assets (models, textures, audio files). Build meshes from Three.js geometries and synthesize sound with Web Audio.
- Pin exact dependency versions (`three@0.186.1`).
- UI text is Hebrew, `dir="rtl"`, but turbo button is physically LEFT and item button physically RIGHT.
- No real car brands or logos.
- M2 requires the user to test tilt on a real Android phone. Stop and ask them before moving past M2.
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
3. Direction is measured on the device on every calibration (never restored from storage). `Start` stays disabled until the protocol finished.
4. During a race a visible "↔" button flips the direction instantly.

Before saying anything about direction is "fixed" or pushing a change that touches `src/input`, `src/render`, `src/sim/Car.js`, `src/sim/TrackModel.js`
or `src/ui/screens.js`, run:  `npm run build && npm run preview &` then `npm run test:direction`
(unit contract tests + `tests/real-sensor.mjs`, which drives the real Chromium sensor pipeline with a physical phone model, in 6 scenarios).
Never write test expectations by copying the game's own formulas: use `tests/helpers/phone.js` (independent physical model).

## VERSION VISIBILITY
Every build shows its id at the bottom-right of the screen ("גרסה <sha> · <date> UTC") and writes `version.json`; the running game polls it
and refreshes itself on the menu (or shows an update button elsewhere). When the user says something is "still broken", first check that
their screen shows the build you just pushed (GitHub Pages caches the page for ~10 minutes). Tell them the expected sha after every push.
