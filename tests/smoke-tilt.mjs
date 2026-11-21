// End-to-end UI test in headless Chromium with synthetic devicemotion events produced by a PHYSICAL phone model
// (not the game's formulas). Direction rules are checked in the real sensor pipeline by tests/real-sensor.mjs.
// Run `npm run build && npm run preview` first. Usage: node tests/smoke-tilt.mjs [url]; env SHOTS=<dir> saves screenshots.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const url = (process.argv[2] || 'http://localhost:4173/Don-Game/') + '?debug=1&seed=3';
const shots = process.env.SHOTS;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

// physical phone: held upright in portrait (rest 0), rotated `cw` degrees clockwise. Reports the reaction-to-gravity vector.
await page.addInitScript(() => {
  window.__pose = { cw: 0, mirrorX: false };
  setInterval(() => {
    const p = window.__pose.cw * Math.PI / 180, G = 9.81;
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: (window.__pose.mirrorX ? -1 : 1) * -Math.sin(p) * G, y: Math.cos(p) * G, z: 0 } }));
  }, 16);
});
const pose = (cw) => page.evaluate((cw) => { window.__pose.cw = cw; }, cw);
const wait = (ms) => page.waitForTimeout(ms);
const calibrate = async () => {           // the on-screen protocol: straight, right, left, middle
  await pose(0); await wait(1500);
  await pose(22); await wait(1400);
  await pose(-22); await wait(1400);
  await pose(0); await wait(1600);
};
const drive = async (cw) => {
  await page.evaluate(() => { const c = __game.world.player; c.s = 20; c.d = 0; c.yaw = 0; c.steer = 0; });
  await pose(cw);
  await page.waitForFunction(() => Math.abs(__game.world.player.d) > 2.5, null, { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => ({ d: __game.world.player.d, steer: __game.tilt.steer }));
};

await page.goto(url);
await page.waitForFunction(() => window.__game);
check(await page.isVisible('#scr-menu'), 'menu screen is shown first');
check(await page.isVisible('#btn-mute'), 'mute button is available');
if (shots) await page.screenshot({ path: `${shots}/menu.png` });

await page.click('#btn-play');
await page.waitForSelector('#scr-calib:not([hidden])');
await wait(900);
check(await page.evaluate(() => __game.tilt.active), 'tilt sensor detected');
check(await page.evaluate(() => document.getElementById('btn-start').disabled), '"Start" is disabled until the calibration is finished');
check((await page.evaluate(() => document.querySelectorAll('#calib-steps li').length)) === 4, 'calibration shows the 4 steps');
await pose(0); await wait(1300);
check(await page.evaluate(() => __game.tilt.step === 'right'), 'step 1 (hold straight) completes by holding still');
if (shots) await page.screenshot({ path: `${shots}/calib1.png` });
await pose(22); await wait(1300);
check(await page.evaluate(() => document.getElementById('lbl-right').classList.contains('lit')), 'tilting right lights the RIGHT label');
check(await page.evaluate(() => __game.tilt.step === 'left'), 'step 2 (tilt right, hold) completes');
if (shots) await page.screenshot({ path: `${shots}/calib2.png` });
await pose(-22); await wait(1300);
check(await page.evaluate(() => document.getElementById('lbl-left').classList.contains('lit')), 'tilting left lights the LEFT label');
await pose(0); await wait(1600);
check(await page.evaluate(() => __game.tilt.step === 'done'), 'calibration finished');
check(await page.evaluate(() => !document.getElementById('btn-start').disabled), '"Start" is enabled');
if (shots) await page.screenshot({ path: `${shots}/calib3.png` });

await page.evaluate(() => { window.__cd = []; setInterval(() => { const e = document.getElementById('countdown'); const t = e.hidden ? '' : e.textContent; if (t && window.__cd[window.__cd.length - 1] !== t) window.__cd.push(t); }, 50); });
await page.click('#btn-start');
await page.waitForFunction(() => __game.state === 'racing', null, { timeout: 8000 });
await wait(800);
const cd = await page.evaluate(() => window.__cd);
check(cd[0] === '3' && cd[1] === '2' && cd[2] === '1' && cd[3].startsWith('GO'), 'countdown shows 3, 2, 1, GO: ' + JSON.stringify(cd));
check(await page.evaluate(() => getComputedStyle(document.getElementById('countdown')).direction === 'ltr'), 'GO! is laid out left-to-right (not "!GO")');
check(await page.evaluate(() => __game.world.cars.length === 4), 'race has 4 cars');
await wait(1500);

const right = await drive(22);
check(right.d > 1.5 && right.steer > 0.2, `phone clockwise -> car right (d=${right.d.toFixed(1)}, steer=${right.steer.toFixed(2)})`);
const left = await drive(-22);
check(left.d < -1.5 && left.steer < -0.2, `phone counter-clockwise -> car left (d=${left.d.toFixed(1)}, steer=${left.steer.toFixed(2)})`);
const mid = await drive(0);
check(Math.abs(mid.steer) < 0.15, `held at the calibrated middle -> straight (steer=${mid.steer.toFixed(2)})`);

// emergency flip button during the race
await page.click('#btn-flip');
const flipped = await drive(22);
check(flipped.d < -1.5, `"↔" button reverses the direction instantly (clockwise now goes left, d=${flipped.d.toFixed(1)})`);
await page.click('#btn-flip');
check((await drive(22)).d > 1.5, 'pressing "↔" again restores it');

// item button, roulette
check(await page.evaluate(() => document.getElementById('btn-item').disabled), 'item button is disabled without an item');
check(await page.evaluate(() => document.getElementById('hud-timer') === null), 'live timer is gone from the HUD');
await page.evaluate(() => { __game.world.player.item = 'shield'; });
await wait(300);
check(await page.evaluate(() => !document.getElementById('btn-item').disabled && document.getElementById('item-ico').textContent === '🛡️'), 'item button shows the held item (shield) and is enabled');
await page.click('#btn-item', { force: true });
await wait(300);
check(await page.evaluate(() => __game.world.player.shieldT > 4 && __game.world.player.item === null), 'tapping the item button uses the item');
await page.evaluate(() => { const w = __game.world, c = w.player, b = w.boxes[w.boxes.length - 1]; c.s = b.s; c.d = b.d; c.item = null; c.rouletteT = 0; });   // the LAST box: no bot has reached it yet
await wait(250);
check(await page.evaluate(() => __game.world.player.rouletteT > 0 && document.getElementById('btn-item').classList.contains('rolling')), 'picking up a box starts the roulette on the button');
await wait(1200);
check(await page.evaluate(() => __game.world.player.item !== null && document.getElementById('btn-item').classList.contains('ready')), 'after the roulette the item is ready');

// turbo recharge ring
await page.evaluate(() => { const c = __game.world.player; c.turbosLeft = 1; c.turboRecharge = 3.5; });
await wait(400);
const ring = await page.evaluate(() => { const r = document.getElementById('turbo-ring'); return { p: r.style.getPropertyValue('--p'), o: r.style.opacity }; });
check(ring.o === '1' && Math.abs(Number(ring.p) - 0.5) < 0.12, `turbo ring shows the recharge progress (${ring.p})`);
await page.evaluate(() => { __game.world.player.turboRecharge = 6.6; });
await wait(900);
check(await page.evaluate(() => __game.world.player.turbosLeft === 2 && document.getElementById('turbo-count').textContent === '2'), 'a turbo charge is added after the recharge time and the counter shows 2');

// car-to-car collision: a car on the RIGHT that steers into us throws us LEFT (direction contract), with feedback and no errors
await page.evaluate(() => { const w = __game.world, p = w.player, o = w.cars.find((c) => !c.isPlayer); p.s = 400; p.d = 0; p.speed = 30; p.yaw = 0; p.vd = 0; p.state = 'driving'; p.hit.kind = null;
  o.s = 400; o.d = 1.6; o.speed = 30; o.yaw = -0.3; o.vd = 0; o.state = 'driving'; o.hit.kind = null; o.bumpCd = {}; p.bumpCd = {}; window.__b0 = w.stats.bumps; });
await wait(400);
const col = await page.evaluate(() => ({ bumps: __game.world.stats.bumps - window.__b0, vd: __game.world.player.vd, d: __game.world.player.d }));
check(col.bumps >= 1, `a collision was registered (${col.bumps})`);
check(col.d < 0.2 || col.vd < 0, `rammed from the right -> we are thrown LEFT (d=${col.d.toFixed(2)}, vd=${col.vd.toFixed(2)})`);

// audio
check(await page.evaluate(() => __game.sound.ctx && __game.sound.ctx.state === 'running'), 'audio context is running after the play tap');
check(await page.evaluate(() => __game.sound.musicOn), 'music is playing during the race');
await wait(1200);
check(await page.evaluate(() => __game.sound.eng.gain.gain.value > 0.01), 'engine sound is audible while driving');
await page.click('#btn-mute'); await wait(400);
check(await page.evaluate(() => __game.sound.muted && localStorage.getItem('dongame.muted') === '1' && __game.sound.master.gain.value < 0.2), 'mute button silences the master gain and is remembered');
await page.click('#btn-mute'); await wait(400);
check(await page.evaluate(() => !__game.sound.muted && __game.sound.master.gain.value > 0.5), 'unmute restores the volume');

// a second calibration on a mirrored-x phone must still end up with clockwise = right
await page.evaluate(() => { window.__pose.mirrorX = true; __game.toCalibrate(); });
await calibrate();
check(await page.evaluate(() => __game.tilt.step === 'done' && __game.tilt.invert === true), 'mirrored sensor: direction measured by the protocol');
await page.click('#btn-start');
await page.waitForFunction(() => __game.state === 'racing', null, { timeout: 8000 });
await wait(1500);
const mir = await drive(22);
check(mir.d > 1.5, `mirrored sensor: clockwise still drives right (d=${mir.d.toFixed(1)})`);

check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + JSON.stringify(errors) : ''));
await browser.close();
if (fails.length) { console.error('\nTILT SMOKE FAILED'); process.exit(1); }
console.log('\nTILT SMOKE OK');
