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

const t0 = Date.now();
if (shots) {
  await page.waitForFunction(() => !document.getElementById('countdown').hidden, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/countdown.png` });
  await page.waitForFunction(() => __game.world.time > 14, null, { timeout: 60000, polling: 300 });
  await page.screenshot({ path: `${shots}/race4.png` });
  await page.waitForFunction(() => __game.state === 'spectate' || __game.state === 'results', null, { timeout: 120000, polling: 300 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/spectate.png` });
}

await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 180000, polling: 500 });
const res = await page.evaluate(() => {
  const w = __game.world, c = w.player;
  return { time: c.finishTime, respawns: c.respawns, place: c.place, cars: w.cars.length, finished: w.finishOrder.length,
    botRespawns: w.cars.filter((x) => !x.isPlayer).reduce((a, x) => a + x.respawns, 0),
    rows: document.querySelectorAll('#result-table tr').length, stats: w.stats };
});
if (shots) await page.screenshot({ path: `${shots}/result.png` });
await browser.close();

console.log(`race finished: player place ${res.place} in ${res.time.toFixed(1)} s (sim), respawns ${res.respawns}/${res.botRespawns} (player/bots), results rows ${res.rows}, items ${JSON.stringify(res.stats)}, wall time ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const problems = [];
if (errors.length) problems.push('console errors: ' + JSON.stringify(errors));
if (res.time < 80 || res.time > 105) problems.push('finish time out of range 80-105');
if (res.respawns || res.botRespawns) problems.push('someone respawned during the autopilot race');
if (res.stats.pickups < 5 || res.stats.uses < 3) problems.push('items were barely used: ' + JSON.stringify(res.stats));
if (res.cars !== 4 || res.finished !== 4 || res.rows !== 4) problems.push('expected 4 cars, all finished, 4 result rows');
if (problems.length) { console.error('SMOKE FAILED\n' + problems.join('\n')); process.exit(1); }
console.log('SMOKE OK');
