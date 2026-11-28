// REAL-BROWSER direction contract. Uses Chromium's virtual sensors (CDP) and a physical rotation model that does NOT use
// the game's own formulas. It plays the whole flow a phone player goes through and asserts the one rule that must never break:
//   physically rotating the phone CLOCKWISE (right edge down) makes the car go RIGHT, and counter-clockwise makes it go LEFT.
// Scenarios cover: portrait start -> OS locks the screen to landscape (angle jumps by +-90 without the phone moving),
// both landscape orientations, and a phone whose x axis is mirrored.
// Run `npm run build && npm run preview` first. Usage: node tests/real-sensor.mjs [url]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const base = process.argv[2] || 'http://localhost:4173/Don-Game/';
const G = 9.81, rad = (d) => d * Math.PI / 180;

/** Reaction vector (what the accelerometer reports) of a phone whose natural top is rotated CCW by `rest` degrees
 *  from the viewer's upright and then rotated further CLOCKWISE by `cw` degrees. Explicit rotation matrices. */
function reading(rest, cw, { mirrorX = false, flipSign = false } = {}) {
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });   // CCW by a
  const t = rad(rest), cwR = -rad(cw);                                  // clockwise = negative CCW
  const xd = rot(rot({ x: 1, y: 0 }, t), cwR), yd = rot(rot({ x: 0, y: 1 }, t), cwR);   // device axes in the world (viewer) frame
  const up = { x: 0, y: 1 };
  let u = { x: (up.x * xd.x + up.y * xd.y) * G, y: (up.x * yd.x + up.y * yd.y) * G, z: 0 };
  if (mirrorX) u.x = -u.x;
  if (flipSign) u = { x: -u.x, y: -u.y, z: 0 };
  return u;
}

const results = [];
let failures = 0;
const check = (ok, msg) => { results.push((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures++; };

async function scenario(browser, name, { lockAngle, restAngle, mirrorX = false, flipSign = false, accidentalMoves = false, second = null }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['accelerometer', 'gyroscope', 'magnetometer'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  for (const type of ['accelerometer', 'linear-acceleration', 'gravity', 'gyroscope', 'absolute-orientation', 'relative-orientation', 'magnetometer']) await cdp.send('Emulation.setSensorOverrideEnabled', { enabled: true, type });
  const xyz = (type, v) => cdp.send('Emulation.setSensorOverrideReadings', { type, reading: { xyz: v } });
  const quat = (type) => cdp.send('Emulation.setSensorOverrideReadings', { type, reading: { quaternion: { x: 0, y: 0, z: 0, w: 1 } } });
  const setPose = async (rest, cw) => {
    const u = reading(rest, cw, { mirrorX, flipSign });
    await xyz('accelerometer', u); await xyz('gravity', u); await xyz('linear-acceleration', { x: 0, y: 0, z: 0 }); await xyz('gyroscope', { x: 0, y: 0, z: 0 });
    await quat('absolute-orientation'); await quat('relative-orientation'); await xyz('magnetometer', { x: 0, y: 30, z: -30 });
  };
  const hold = (ms) => page.waitForTimeout(ms);
  const sweep = async (rest, from, to, ms) => { const n = Math.max(2, Math.round(ms / 60)); for (let i = 1; i <= n; i++) { await setPose(rest, from + (to - from) * i / n); await hold(60); } };

  // 1. the player holds the phone upright in portrait (natural pose), sits on the menu
  await setPose(0, 0);
  await page.goto(base + '?debug=1&seed=3');
  await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
  await hold(1200);
  if (accidentalMoves) { await sweep(0, 0, 25, 400); await sweep(0, 25, -20, 400); await sweep(0, -20, 0, 400); await hold(900); }

  // 2. taps Play: the OS rotates the UI to landscape RIGHT AWAY (the phone has not moved yet)
  await page.click('#btn-play');
  // (lockAngle == null: the screen stays in portrait, e.g. the page runs in an in-app browser that cannot lock the orientation)
  if (lockAngle != null) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true,
      screenOrientation: { type: lockAngle === 90 ? 'landscapePrimary' : 'landscapeSecondary', angle: lockAngle } });
  }
  await hold(900);
  // 3. ...then the player physically turns the phone into landscape (CCW 90 for angle 90, CW 90 = rest 270 for angle 270)
  const nat = (a) => (a === 90 ? 90 : 270);
  const rest = restAngle ?? (lockAngle != null ? nat(lockAngle) : 0);
  // (one quick turn: on a loaded test machine every CDP call is slow, and ten small steps would look like pauses half way)
  await setPose(rest > 180 ? (rest + 360) / 2 : rest / 2, 0); await hold(80);        // half way, the short way round
  await setPose(rest, 0);
  await hold(1300);

  // 4. the calibration protocol, exactly as instructed on screen: hold straight, tilt right, tilt left, back to the middle
  const protocol = async () => {
    await sweep(rest, 0, 22, 500); await setPose(rest, 22); await hold(1300);      // right = clockwise
    await sweep(rest, 22, -22, 700); await setPose(rest, -22); await hold(1300);    // left = counter-clockwise
    await sweep(rest, -22, 0, 500); await setPose(rest, 0); await hold(1500);
  };
  await protocol();
  // a heavily loaded test machine delivers sensor events late: give it time, and like a real player, do the steps once more
  const enabled = () => page.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 4000 }).then(() => true).catch(() => false);
  if (!(await enabled())) { console.log('   (slow machine: repeating the calibration steps once)'); await hold(1200); await protocol(); await enabled(); }

  const startEnabled = await page.evaluate(() => !document.getElementById('btn-start').disabled);
  const dbg = await page.evaluate(() => ({ step: __game.tilt.step, active: __game.tilt.active, roll: +(__game.tilt.roll * 57.3).toFixed(1), jumps: __game.tilt.jumps, angle: screen.orientation.angle }));
  check(startEnabled, `${name}: "Start" is enabled after the guided steps${startEnabled ? '' : ' ' + JSON.stringify(dbg)}`);
  await page.click('#btn-start', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => __game.state === 'racing', null, { timeout: 15000 }).catch(() => {});
  const state = await page.evaluate(() => __game.state);
  check(state === 'racing', `${name}: race started (state ${state})`);

  // 5. THE CONTRACT: clockwise -> right, counter-clockwise -> left (measured on the real car)
  const drive = async (cw) => {
    await page.evaluate(() => { const c = __game.world.player; c.s = 20; c.d = 0; c.yaw = 0; c.steer = 0; });
    await setPose(rest, cw); await hold(300);
    await page.waitForFunction(() => Math.abs(__game.world.player.d) > 2.5, null, { timeout: 15000 }).catch(() => {});
    return page.evaluate(() => ({ d: __game.world.player.d, steer: __game.tilt.steer }));
  };
  const right = await drive(22);
  check(right.d > 2 && right.steer > 0.2, `${name}: phone turned CLOCKWISE -> car goes RIGHT (d=${right.d.toFixed(1)}, steer=${right.steer.toFixed(2)})`);
  const left = await drive(-22);
  check(left.d < -2 && left.steer < -0.2, `${name}: phone turned COUNTER-CLOCKWISE -> car goes LEFT (d=${left.d.toFixed(1)}, steer=${left.steer.toFixed(2)})`);
  const mid = await drive(0);
  check(Math.abs(mid.steer) < 0.15, `${name}: held at the calibrated middle -> no steering (steer=${mid.steer.toFixed(2)})`);
  check(await page.evaluate(() => !!localStorage.getItem('dongame.dir')), `${name}: the direction is remembered after the guided calibration`);

  // 6. SECOND VISIT (V4-A): reload, tap Play -> no calibration screen; the centre comes from how the phone is held during 3-2-1
  if (second) {
    const lock2 = second.lockAngle ?? lockAngle, rest2 = second.restAngle ?? (lock2 != null ? nat(lock2) : 0), held = second.held ?? 0;
    if (lockAngle != null) await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await setPose(0, 0);
    await page.goto(base + '?debug=1&seed=4');
    await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
    await hold(1200);
    if (second.fidget) { await sweep(0, 0, 30, 300); await sweep(0, 30, -30, 400); await sweep(0, -30, 0, 300); }
    const recalVisible = await page.isVisible('#btn-menu-recal');
    check(recalVisible, `${name} / 2nd visit: the menu offers "calibrate again"`);
    await page.click('#btn-play');
    if (lock2 != null) await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: lock2 === 90 ? 'landscapePrimary' : 'landscapeSecondary', angle: lock2 } });
    for (let i = 1; i <= 8; i++) { await setPose(rest2 * i / 8, held * i / 8); await hold(50); }
    await setPose(rest2, held);
    const sawCalib = await page.evaluate(() => __game.state === 'calibrate' || !document.getElementById('scr-calib').hidden);
    check(!sawCalib, `${name} / 2nd visit: no calibration screen (state ${await page.evaluate(() => __game.state)})`);
    await page.waitForFunction(() => __game.state === 'racing', null, { timeout: 15000 }).catch(() => {});
    check(await page.evaluate(() => __game.state) === 'racing', `${name} / 2nd visit: straight into the race`);
    const drive2 = async (cw) => {
      await page.evaluate(() => { const c = __game.world.player; c.s = 20; c.d = 0; c.yaw = 0; c.steer = 0; });
      await setPose(rest2, cw); await hold(300);
      await page.waitForFunction(() => Math.abs(__game.world.player.d) > 2.5, null, { timeout: 15000 }).catch(() => {});
      return page.evaluate(() => ({ d: __game.world.player.d, steer: __game.tilt.steer }));
    };
    const r2 = await drive2(held + 22), l2 = await drive2(held - 22), m2 = await drive2(held);
    check(r2.d > 2 && r2.steer > 0.2, `${name} / 2nd visit: CLOCKWISE -> RIGHT (d=${r2.d.toFixed(1)}, steer=${r2.steer.toFixed(2)})`);
    check(l2.d < -2 && l2.steer < -0.2, `${name} / 2nd visit: COUNTER-CLOCKWISE -> LEFT (d=${l2.d.toFixed(1)}, steer=${l2.steer.toFixed(2)})`);
    check(Math.abs(m2.steer) < 0.15, `${name} / 2nd visit: held as during the 3-2-1 (${held} deg) -> straight (steer=${m2.steer.toFixed(2)})`);
  }
  check(errors.length === 0, `${name}: no console errors${errors.length ? ' ' + JSON.stringify(errors) : ''}`);
  await ctx.close();
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const only = process.env.ONLY;
const scenarios = [
  ['landscape-left (angle 90)', { lockAngle: 90, second: {} }],
  ['landscape-right (angle 270)', { lockAngle: 270, second: { held: 12 } }],
  ['calibrated at 90, next time held at 270, fidgeting before Play', { lockAngle: 90, second: { lockAngle: 270, fidget: true, held: -10 } }],
  ['angle 270 + accidental moves before play', { lockAngle: 270, accidentalMoves: true }],
  ['angle 90 + accidental moves before play', { lockAngle: 90, accidentalMoves: true }],
  ['portrait only (orientation lock fails)', { lockAngle: null }],
  ['portrait page, phone physically landscape (angle 90 hold)', { lockAngle: null, restAngle: 90 }],
  ['portrait page, phone physically landscape (angle 270 hold)', { lockAngle: null, restAngle: 270 }],
  ['mirrored-x phone, angle 270', { lockAngle: 270, mirrorX: true, second: { lockAngle: 90 } }],
  ['iOS-style negated axes, angle 90', { lockAngle: 90, flipSign: true, second: { held: 8 } }],
];
for (const [name, opts] of scenarios) { if (only && !name.includes(only)) continue; console.log('--', name); await scenario(browser, name, opts); }
await browser.close();
console.log(results.join('\n'));
if (failures) { console.error(`\nREAL SENSOR CONTRACT FAILED (${failures})`); process.exit(1); }
console.log('\nREAL SENSOR CONTRACT OK');
