// Smoke test: serves nothing itself - run `npm run build && npm run preview` first (port 4173).
// Usage: node tests/smoke.mjs [url]   Optional env SHOTS=<dir> saves screenshots along the way.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const requireGlobal = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium } = requireGlobal('playwright');

const base = process.argv[2] || 'http://localhost:4173/Don-Game/';
const url = `${base}?autopilot=1&fast=4&seed=1&debug=1&roller=0`;     // the roller has its own scenarios below and in smoke-tilt
const shots = process.env.SHOTS;
const problems = [];

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

// ---- a full autopilot race WITH the roller: it must always end, with every car either finished or flattened ----
{
  const errs2 = [];
  const p2 = await browser.newPage({ viewport: { width: 844, height: 390 } });
  p2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });
  p2.on('pageerror', (e) => errs2.push(String(e)));
  for (const seed of [3, 7]) {
    await p2.goto(`${base}?autopilot=1&fast=4&seed=${seed}&quality=1`);
    await p2.waitForFunction(() => window.__game, null, { timeout: 15000 });
    await p2.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 180000, polling: 500 });
    const r = await p2.evaluate(() => { const w = __game.world; return { finished: w.finishOrder.length, flat: w.eliminated.length, rows: document.querySelectorAll('#result-table tr').length, rollerSeen: w.roller.startedAt !== null || w.roller.ended, title: document.getElementById('result-title').textContent }; });
    console.log(`roller race seed ${seed}: finished ${r.finished}, flattened ${r.flat}, rows ${r.rows}, roller ran ${r.rollerSeen}, title "${r.title}"`);
    if (r.finished + r.flat !== 4 || r.rows !== 4 || !r.rollerSeen) problems.push(`roller race seed ${seed} did not end properly: ` + JSON.stringify(r));
  }
  if (errs2.length) problems.push('console errors in the roller races: ' + JSON.stringify(errs2));
  await p2.close();
}
await browser.close();

console.log(`race finished: player place ${res.place} in ${res.time.toFixed(1)} s (sim), respawns ${res.respawns}/${res.botRespawns} (player/bots), results rows ${res.rows}, items ${JSON.stringify(res.stats)}, wall time ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (errors.length) problems.push('console errors: ' + JSON.stringify(errors));
if (res.time < 72 || res.time > 105) problems.push('finish time out of range 72-105');
if (res.respawns + res.botRespawns > 3) problems.push('too many respawns during the autopilot race: ' + (res.respawns + res.botRespawns));
if (res.stats.pickups < 5 || res.stats.uses < 3) problems.push('items were barely used: ' + JSON.stringify(res.stats));
if (res.cars !== 4 || res.finished !== 4 || res.rows !== 4) problems.push('expected 4 cars, all finished, 4 result rows');
if (problems.length) { console.error('SMOKE FAILED\n' + problems.join('\n')); process.exit(1); }
console.log('SMOKE OK');
