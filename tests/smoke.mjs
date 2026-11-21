// Smoke test: serves nothing itself - run `npm run build && npm run preview` first (port 4173).
// Usage: node tests/smoke.mjs [url]   Optional env SHOTS=<dir> saves screenshots along the way.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const requireGlobal = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium } = requireGlobal('playwright');

const base = process.argv[2] || 'http://localhost:4173/Don-Game/';
const url = `${base}?autopilot=1&fast=4&seed=1&debug=1`;
const shots = process.env.SHOTS;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url);
await page.waitForFunction(() => window.__game, null, { timeout: 15000 });

if (shots) {
  for (const [name, s] of [['start', -6], ['curve', 330], ['cliff', 700], ['canyon', 1290], ['finish', 2860]]) {
    await page.evaluate((s) => { const c = __game.world.player; c.s = s; c.d = 0; c.speed = 32; c.lastCheckpointS = Math.max(0, Math.floor(s / 80) * 80); }, s);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${shots}/${name}.png` });
  }
  await page.evaluate(() => __game.newRace());
}

const t0 = Date.now();
await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 180000, polling: 500 });
const res = await page.evaluate(() => { const c = __game.world.player; return { time: c.finishTime, respawns: c.respawns, place: c.place }; });
if (shots) await page.screenshot({ path: `${shots}/result.png` });
await browser.close();

console.log(`race finished: ${res.time.toFixed(1)} s (sim), respawns ${res.respawns}, wall time ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const problems = [];
if (errors.length) problems.push('console errors: ' + JSON.stringify(errors));
if (res.time < 80 || res.time > 105) problems.push('finish time out of range 80-105');
if (res.respawns) problems.push('respawned during autopilot race');
if (problems.length) { console.error('SMOKE FAILED\n' + problems.join('\n')); process.exit(1); }
console.log('SMOKE OK');
