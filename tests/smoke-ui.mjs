// UI layout smoke (V4-C): the track map is on the right, half transparent, does not cover the controls, and the dot moves.
// Run `npm run build && npm run preview` first. Usage: node tests/smoke-ui.mjs [url]   SHOTS=<dir> saves screenshots.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const base = process.argv[2] || 'http://localhost:4173/Don-Game/';
const problems = [];
const ok = (c, t) => { console.log((c ? 'ok   ' : 'FAIL ') + t); if (!c) problems.push(t); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, vp] of [['phone landscape', { width: 844, height: 390 }], ['small landscape', { width: 667, height: 375 }], ['portrait', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp });
  await p.goto(`${base}?autopilot=1&skipCalib=1&seed=1&quality=0`);
  await p.waitForFunction(() => window.__game?.state === 'racing', null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  const box = (sel) => p.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width } : null; }, sel);
  const m = await box('#minimap'), item = await box('#btn-item'), speed = await box('#hud-speed'), turbo = await box('#btn-turbo');
  const overlap = (a, c) => a && c && a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
  ok(!!m, `${name}: the map is shown during the race`);
  ok(m && m.l > vp.width / 2, `${name}: the map is on the right half`);
  ok(!overlap(m, item) && !overlap(m, speed) && !overlap(m, turbo), `${name}: the map does not cover the item button, the speed or the turbo`);
  ok(await p.evaluate(() => { const e = document.getElementById('minimap'); const cs = getComputedStyle(e); return Number(cs.opacity) < 0.8 && cs.pointerEvents === 'none'; }), `${name}: half transparent and ignores touches`);
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('hud-progress')).display === 'none'), `${name}: the old progress bar is gone`);
  // the player's dot moves: compare two snapshots of the map
  const shot = () => p.evaluate(() => document.getElementById('minimap').toDataURL());
  const a = await shot(); await p.waitForTimeout(2000); const c = await shot();
  ok(a !== c, `${name}: the map updates while driving`);
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/ui-${name.replace(/ /g, '-')}.png` });
  await p.close();
}
await b.close();
if (problems.length) { console.log('\nUI SMOKE FAILED'); process.exit(1); }
console.log('\nUI SMOKE OK');
