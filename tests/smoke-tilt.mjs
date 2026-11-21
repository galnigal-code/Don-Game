// End-to-end tilt test in headless Chromium with synthetic devicemotion events.
// Run `npm run build && npm run preview` first. Usage: node tests/smoke-tilt.mjs [url]; env SHOTS=<dir> saves screenshots.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const url = (process.argv[2] || 'http://localhost:4173/Don-Game/') + '?debug=1&seed=1';
const shots = process.env.SHOTS;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const fails = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

// Feed the page a phone held upright and rotated by `deg` (clockwise positive), screen angle 0.
await page.addInitScript(() => {
  window.__tiltDeg = 0;
  setInterval(() => {
    const p = window.__tiltDeg * Math.PI / 180, G = 9.81;
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
      accelerationIncludingGravity: { x: -Math.sin(p) * G, y: Math.cos(p) * G, z: 0 },
    }));
  }, 16);
});

await page.goto(url);
await page.waitForFunction(() => window.__game);
check(await page.isVisible('#scr-menu'), 'menu screen is shown first');
if (shots) await page.screenshot({ path: `${shots}/menu.png` });

await page.click('#btn-play');
await page.waitForSelector('#scr-calib:not([hidden])');
await page.waitForTimeout(900);
check(await page.evaluate(() => __game.tilt.active), 'tilt sensor detected');

// gauge reacts in the right direction
await page.evaluate(() => { window.__tiltDeg = 15; });
await page.waitForTimeout(700);
const rightLit = await page.evaluate(() => document.getElementById('lbl-right').classList.contains('lit'));
const leftLit = await page.evaluate(() => document.getElementById('lbl-left').classList.contains('lit'));
check(rightLit && !leftLit, 'rotating clockwise lights the RIGHT label');
if (shots) await page.screenshot({ path: `${shots}/calib.png` });
await page.evaluate(() => { window.__tiltDeg = -15; });
await page.waitForTimeout(700);
check(await page.evaluate(() => document.getElementById('lbl-left').classList.contains('lit')), 'rotating counter-clockwise lights the LEFT label');

// hold a "comfortable" pose of 10 deg, calibrate on it
await page.evaluate(() => { window.__tiltDeg = 10; });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__cd = []; setInterval(() => { const e = document.getElementById('countdown'); const t = e.hidden ? '' : e.textContent; if (t && window.__cd[window.__cd.length - 1] !== t) window.__cd.push(t); }, 50); });
await page.click('#btn-start');
await page.waitForFunction(() => __game.state === 'racing', null, { timeout: 8000 });
await page.waitForTimeout(800);
const cd = await page.evaluate(() => window.__cd);
check(cd[0] === '3' && cd[1] === '2' && cd[2] === '1' && cd[3].startsWith('GO'), 'countdown shows 3, 2, 1, GO: ' + JSON.stringify(cd));
check(await page.evaluate(() => __game.world.cars.length === 4), 'race has 4 cars');
await page.waitForTimeout(1500);
const s0 = await page.evaluate(() => __game.world.player.steer);
check(Math.abs(s0) < 0.05, 'calibrated pose (10 deg) is "straight" (steer ~ 0), got ' + s0.toFixed(3));

// turn right: rotate to 10 + 20 deg
await page.evaluate(() => { window.__tiltDeg = 30; __game.world.player.s = 20; __game.world.player.d = 0; });
await page.waitForTimeout(1500);
const right = await page.evaluate(() => ({ d: __game.world.player.d, steer: __game.world.player.steer }));
check(right.d > 1.5 && right.steer > 0.3, `tilt right -> car moves right (d=${right.d.toFixed(1)}, steer=${right.steer.toFixed(2)})`);
if (shots) await page.screenshot({ path: `${shots}/race-right.png` });

// turn left: rotate to 10 - 20 deg
await page.evaluate(() => { window.__tiltDeg = -10; const c = __game.world.player; c.d = 0; c.yaw = 0; });
await page.waitForTimeout(1500);
const left = await page.evaluate(() => ({ d: __game.world.player.d, steer: __game.world.player.steer }));
check(left.d < -1.5 && left.steer < -0.3, `tilt left -> car moves left (d=${left.d.toFixed(1)}, steer=${left.steer.toFixed(2)})`);

// invert switch flips the direction
await page.evaluate(() => { __game.toCalibrate(); });
await page.click('#btn-invert');
await page.evaluate(() => { window.__tiltDeg = 10; });
await page.waitForTimeout(1200);
await page.click('#btn-start');
await page.waitForFunction(() => __game.state === 'racing', null, { timeout: 8000 });
await page.evaluate(() => { window.__tiltDeg = 30; const c = __game.world.player; c.s = 20; c.d = 0; c.yaw = 0; });
await page.waitForTimeout(1500);
const inv = await page.evaluate(() => __game.world.player.d);
check(inv < -1.5, `"invert direction" flips it (tilt right -> d=${inv.toFixed(1)})`);

// item button: grab an item, the button lights up, tapping it uses the item
await page.evaluate(() => { __game.toCalibrate(); });
await page.click('#btn-start');
await page.waitForFunction(() => __game.state === 'racing', null, { timeout: 8000 });
check(await page.evaluate(() => document.getElementById('btn-item').disabled), 'item button is disabled without an item');
check(await page.evaluate(() => document.getElementById('hud-timer') === null), 'live timer is gone from the HUD');
await page.evaluate(() => { const c = __game.world.player; c.item = 'shield'; });
await page.waitForTimeout(300);
check(await page.evaluate(() => !document.getElementById('btn-item').disabled && document.getElementById('item-ico').textContent === '🛡️'), 'item button shows the held item (shield) and is enabled');
await page.click('#btn-item', { force: true });
await page.waitForTimeout(300);
check(await page.evaluate(() => __game.world.player.shieldT > 4 && __game.world.player.item === null), 'tapping the item button uses the item');
// roulette from a box
await page.evaluate(() => { const w = __game.world, c = w.player, b = w.boxes[0]; c.s = b.s; c.d = b.d; c.item = null; c.rouletteT = 0; });
await page.waitForTimeout(250);
check(await page.evaluate(() => __game.world.player.rouletteT > 0 && document.getElementById('btn-item').classList.contains('rolling')), 'picking up a box starts the roulette on the button');
await page.waitForTimeout(1200);
check(await page.evaluate(() => __game.world.player.item !== null && document.getElementById('btn-item').classList.contains('ready')), 'after the roulette the item is ready');

check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + JSON.stringify(errors) : ''));
await browser.close();
if (fails.length) { console.error('\nTILT SMOKE FAILED'); process.exit(1); }
console.log('\nTILT SMOKE OK');
