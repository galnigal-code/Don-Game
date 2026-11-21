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
