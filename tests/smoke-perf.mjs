// Performance budgets, measured in headless Chromium (software rendering, so FPS is NOT meaningful here; counts and CPU work are).
// Run `npm run build && npm run preview` first. Usage: node tests/smoke-perf.mjs [url]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const base = process.argv[2] || 'http://localhost:4173/Don-Game/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

async function open(query, { dsf = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + query.replace('?', '?track=' + (query.includes('track=') ? '' : 'desert&')));
  await page.waitForFunction(() => window.__game && __game.state === 'racing', null, { timeout: 60000 });
  return { ctx, page, errors };
}

// ---- 1. draw-call / triangle budget, in the busiest places (start grid with 4 cars, item boxes, a jump) ----
{
  const { ctx, page, errors } = await open('?quality=3&skipCalib=1&seed=3');
  await page.waitForTimeout(1500);
  const sample = async (label, setup) => {
    if (setup) await page.evaluate(setup);
    await page.waitForTimeout(900);
    const info = await page.evaluate(() => ({ calls: __game.renderer.info.render.calls, tris: __game.renderer.info.render.triangles }));
    check(info.calls <= 100, `${label}: ${info.calls} draw calls (budget 100)`);
    check(info.tris <= 140000, `${label}: ${info.tris} triangles (budget 140k)`);
  };
  await sample('start grid');
  await sample('item boxes + opponents', () => { const g = __game, c = g.world.player; g.paused = true; c.s = 285; c.d = 0; g.world.cars.forEach((o, i) => { if (!o.isPlayer) { o.s = 290 + i * 6; o.d = -4 + i * 3; } }); });
  await sample('at a ramp over the trench', () => { const c = __game.world.player; c.s = 975; c.d = 0; });
  await sample('inside the canyon', () => { const c = __game.world.player; c.s = 1290; c.d = 0; });
  check(errors.length === 0, 'no console errors' + (errors.length ? ' ' + JSON.stringify(errors) : ''));
  await ctx.close();
}

// ---- 2. CPU work per frame (JS only: simulation + preparing the frame), over a stretch of real racing ----
{
  const { ctx, page } = await open('?quality=3&skipCalib=1&autopilot=1&seed=3');
  await page.waitForTimeout(12000);
  const m = await page.evaluate(() => ({ sim: __game.simMs, js: __game.cpuMs, submit: __game.submitMs, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0 }));
  check(m.sim < 4, `simulation: ${m.sim.toFixed(2)} ms per frame (budget 4 ms; includes up to 5 sim steps)`);
  check(m.js < 6, `frame preparation (views, particles, HUD): ${m.js.toFixed(2)} ms (budget 6 ms)`);
  check(m.heap === 0 || m.heap < 160, `JS heap ${m.heap.toFixed(0)} MB (budget 160 MB)`);
  await ctx.close();
}

// ---- 3. quality levels really change the render resolution and the amount of decoration ----
{
  const sizes = {};
  for (const q of [3, 1, 0]) {
    const { ctx, page } = await open(`?quality=${q}&skipCalib=1&seed=3`, { dsf: 2 });
    await page.waitForTimeout(600);
    sizes[q] = await page.evaluate(() => ({ dpr: __game.renderer.getPixelRatio(), w: __game.renderer.domElement.width, cacti: __game.env.group.children.filter((c) => c.isInstancedMesh).map((c) => c.count) }));
    await ctx.close();
  }
  check(Math.abs(sizes[3].dpr - 1.5) < 0.01, `quality 3 renders at 1.5x on a 2x screen (got ${sizes[3].dpr})`);
  check(sizes[0].dpr < sizes[1].dpr && sizes[1].dpr < sizes[3].dpr, `lower quality = lower resolution (${sizes[3].dpr} > ${sizes[1].dpr} > ${sizes[0].dpr})`);
  check(sizes[0].w < sizes[3].w * 0.5, `quality 0 draws less than half the pixels (${sizes[0].w}px vs ${sizes[3].w}px wide)`);
  check(sizes[0].cacti.every((n) => n === 0) && sizes[3].cacti.every((n) => n > 50), 'quality 0 hides the cacti and rocks, quality 3 shows them');
}

// ---- 4. auto mode steps the quality down on a slow device (this headless browser is slow) ----
{
  const { ctx, page } = await open('?skipCalib=1&autopilot=1&seed=3', { dsf: 2 });
  await page.waitForFunction(() => __game.qLevel < 3, null, { timeout: 60000 }).catch(() => {});
  const r = await page.evaluate(() => ({ level: __game.qLevel, dpr: __game.renderer.getPixelRatio(), hist: __game.quality.history }));
  check(r.level < 3, `a slow device is detected and the quality is lowered automatically (level ${r.level}, dpr ${r.dpr}) ${JSON.stringify(r.hist)}`);
  const saved = await page.evaluate(() => localStorage.getItem('dongame.quality'));
  check(saved !== null && Number(saved) === r.level, 'the chosen level is remembered for the next visit');
  await ctx.close();
}

// ---- 5. the loading cover goes away ----
{
  const { ctx, page } = await open('?quality=3&skipCalib=1&seed=3');
  check(await page.evaluate(() => document.getElementById('loading') === null), 'loading cover is removed once the game is running');
  await ctx.close();
}

// ---- 6. the city (V5): draw calls, triangles and CPU in the busiest places, at the top two quality levels ----
for (const q of [2, 3]) {
  const { ctx, page, errors } = await open(`?track=city&quality=${q}&skipCalib=1&seed=3`);
  await page.waitForTimeout(1500);
  const sample = async (label, setup) => {
    if (setup) await page.evaluate(setup);
    await page.waitForTimeout(900);
    const info = await page.evaluate(() => ({ calls: __game.renderer.info.render.calls, tris: __game.renderer.info.render.triangles }));
    const budget = q === 3 ? 130 : 100;
    check(info.calls <= budget, `city q${q} ${label}: ${info.calls} draw calls (budget ${budget})`);
    check(info.tris <= 160000, `city q${q} ${label}: ${info.tris} triangles (budget 160k)`);
  };
  await sample('start grid');
  await sample('a bend with opponents', () => { const g = __game, c = g.world.player; g.paused = true; c.s = 1250; c.d = 0; g.world.cars.forEach((o, i) => { if (!o.isPlayer) { o.s = 1256 + i * 6; o.d = -4 + i * 3; } }); });
  await sample('second lap', () => { const c = __game.world.player; c.s = __game.track.lapLength + 400; });
  check(errors.length === 0, `city q${q}: no console errors` + (errors.length ? ' ' + JSON.stringify(errors) : ''));
  await ctx.close();
}

await browser.close();
if (fails.length) { console.error('\nPERF SMOKE FAILED'); process.exit(1); }
console.log('\nPERF SMOKE OK');
