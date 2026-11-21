import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEG, wrapPi, rollAngle, rollFromMotion, smoothAngle, steerFromRoll } from '../../src/input/tiltMath.js';
import { TiltInput } from '../../src/input/TiltInput.js';
import { createRng } from '../../src/sim/rng.js';
import { reading } from '../helpers/phone.js';

const OPTS = { deadZone: 3 * DEG, maxAngle: 30 * DEG };
const RESTS = [0, 90, 180, 270];

describe('tilt math', () => {
  it('clockwise rotation INCREASES the roll for every way of holding the phone and every sensor sign convention', () => {
    for (const rest of RESTS) for (const flipSign of [false, true]) {
      let prev = -Infinity, base = null;
      for (let cw = -60; cw <= 60; cw += 10) {
        const roll = rollFromMotion(reading(rest, cw, { flipSign }), false).roll;
        if (base === null) base = roll;
        const unwrapped = base + wrapPi(roll - base);
        expect(unwrapped, `rest ${rest} flip ${flipSign} cw ${cw}`).toBeGreaterThan(prev);
        prev = unwrapped;
      }
    }
  });
  it('the roll difference equals the physical rotation (so zero + steering are exact)', () => {
    for (const rest of RESTS) {
      const r0 = rollFromMotion(reading(rest, 0)).roll, r1 = rollFromMotion(reading(rest, 25)).roll;
      expect(wrapPi(r1 - r0) / DEG).toBeCloseTo(25, 4);
    }
  });
  it('iOS reports the opposite sign; the correction keeps the same roll', () => {
    const a = reading(90, 20), b = reading(90, 20, { flipSign: true });
    expect(wrapPi(rollFromMotion(b, true).roll - rollFromMotion(a, false).roll)).toBeCloseTo(0, 6);
  });
  it('negating both axes only shifts the angle by 180 degrees, it never flips the direction', () => {
    const d = (flip) => wrapPi(rollFromMotion(reading(0, 25, { flipSign: flip })).roll - rollFromMotion(reading(0, 0, { flipSign: flip })).roll);
    expect(d(true)).toBeCloseTo(d(false), 6);
  });
  it('a mirrored axis (the only hardware-like fault) flips the direction', () => {
    const d = wrapPi(rollFromMotion(reading(0, 25, { mirrorX: true })).roll - rollFromMotion(reading(0, 0, { mirrorX: true })).roll);
    expect(d).toBeLessThan(0);
  });
  it('reports a small planar component when the phone lies flat', () => {
    expect(rollFromMotion({ x: 0.3, y: 0.2 }).planar).toBeLessThan(1);
    expect(rollFromMotion(reading(90, 0)).planar).toBeCloseTo(9.81, 4);
  });
  it('rollAngle of straight-up is 0', () => { expect(rollAngle({ x: 0, y: 9.8 })).toBeCloseTo(0, 9); });
  it('steerFromRoll: dead zone, saturation, zero offset, invert, wrap-around', () => {
    expect(steerFromRoll(2 * DEG, 0, OPTS)).toBe(0);
    expect(steerFromRoll(30 * DEG, 0, OPTS)).toBeCloseTo(1, 6);
    expect(steerFromRoll(80 * DEG, 0, OPTS)).toBe(1);
    expect(steerFromRoll(-80 * DEG, 0, OPTS)).toBe(-1);
    expect(steerFromRoll(16.5 * DEG, 0, OPTS)).toBeCloseTo(0.5, 6);
    expect(steerFromRoll(70 * DEG, 40 * DEG, OPTS)).toBeCloseTo(1, 6);
    expect(steerFromRoll(20 * DEG, 0, { ...OPTS, invert: true })).toBeLessThan(0);
    expect(steerFromRoll(-175 * DEG, 175 * DEG, OPTS)).toBeGreaterThan(0);
  });
  it('helpers', () => {
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
    expect(smoothAngle(179 * DEG, -179 * DEG, 0.5) / DEG).toBeCloseTo(180, 4);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/* The protocol, driven by a simulated phone. THE CONTRACT: physically clockwise => steer > 0, counter-clockwise => steer < 0 */

let clock = 1000;
const realNow = performance.now.bind(performance);
const realScreen = globalThis.screen;
beforeEach(() => { clock = 1000; performance.now = () => clock; globalThis.screen = { orientation: { angle: 0 } }; });
afterEach(() => { performance.now = realNow; globalThis.screen = realScreen; });

/** A simulated phone + player. `rest` = how the phone is held (0/90/180/270), `cw` = extra clockwise turn in degrees. */
function rig(opts = {}) {
  const t = new TiltInput();
  t.isIOS = false;
  const me = { t, rest: opts.rest ?? 0, cw: 0, remap: 0 };
  const sample = () => {
    clock += 16;
    let u = reading(me.rest, me.cw, opts);
    if (me.remap) { const a = me.remap * DEG; u = { x: u.x * Math.cos(a) - u.y * Math.sin(a), y: u.x * Math.sin(a) + u.y * Math.cos(a), z: 0 }; }
    t.onMotion({ accelerationIncludingGravity: u });
    t.updateProtocol();
  };
  me.hold = (ms) => { for (let i = 0; i < ms / 16; i++) sample(); };
  me.to = (cw, ms = 400) => { const from = me.cw, n = Math.max(2, Math.round(ms / 16)); for (let i = 1; i <= n; i++) { me.cw = from + (cw - from) * i / n; sample(); } me.cw = cw; };
  me.rotateScreen = (angle, remapDeg = 0) => { globalThis.screen.orientation.angle = angle; me.remap = remapDeg; sample(); };   // OS rotates the UI (and some browsers re-express the axes)
  me.protocol = (tilt = 22) => { me.hold(1200); me.to(tilt, 400); me.hold(800); me.to(-tilt, 700); me.hold(800); me.to(0, 500); me.hold(1100); };
  me.contract = () => {
    const out = {};
    for (const cw of [22, -22, 0]) { me.to(cw, 300); me.hold(500); out[cw] = t.steer; }
    return out;
  };
  return me;
}
const expectContract = (m, label = '') => {
  const s = m.contract();
  expect(s[22], `${label} clockwise -> right`).toBeGreaterThan(0.2);
  expect(s[-22], `${label} counter-clockwise -> left`).toBeLessThan(-0.2);
  expect(Math.abs(s[0]), `${label} middle -> straight`).toBeLessThan(0.1);
};

describe('guided calibration protocol', () => {
  it('walks neutral -> right -> left -> centre -> done and satisfies the contract', () => {
    const m = rig(); m.t.beginProtocol(); m.hold(100);
    expect(m.t.step).toBe('neutral'); expect(m.t.ready).toBe(false);
    m.hold(1200); expect(m.t.step).toBe('right');
    m.to(22); m.hold(800); expect(m.t.step).toBe('left');
    m.to(-22, 700); m.hold(800); expect(m.t.step).toBe('center');
    m.to(0); m.hold(1100); expect(m.t.step).toBe('done'); expect(m.t.ready).toBe(true);
    expectContract(m);
  });
  it('holds for every way of holding the phone and every sensor convention', () => {
    for (const rest of RESTS) for (const o of [{}, { flipSign: true }, { mirrorX: true }, { mirrorX: true, flipSign: true }]) {
      const m = rig({ rest, ...o }); m.t.isIOS = !!o.flipSign; m.t.beginProtocol();
      m.protocol(); expect(m.t.step, JSON.stringify({ rest, ...o })).toBe('done');
      expectContract(m, JSON.stringify({ rest, ...o }));
    }
  });
  it('does not react to movement that is not held (fidgeting, picking the phone up)', () => {
    const m = rig(); m.t.beginProtocol();
    for (let i = 0; i < 12; i++) m.to((i % 2 ? 1 : -1) * 40, 250);      // wild waving, never held
    expect(m.t.step).toBe('neutral');
    m.to(0, 300); m.protocol(); expect(m.t.step).toBe('done'); expectContract(m);
  });
  it('is not fooled by a big move BEFORE the protocol (e.g. before tapping Play)', () => {
    const m = rig({ rest: 270 }); m.hold(800); m.to(25); m.to(-25, 600); m.to(0); m.hold(700);
    m.t.beginProtocol(); m.protocol(); expectContract(m);
  });
  it('ignores the same side twice, and starts over when the whole phone is repositioned', () => {
    const m = rig(); m.t.beginProtocol();
    m.hold(1200); m.to(22); m.hold(800); expect(m.t.step).toBe('left');
    m.to(24, 300); m.hold(1500); expect(m.t.step).toBe('left');         // same side again: no progress
    m.rest = 90; m.cw = 0; m.hold(1600);                                  // turned the phone into landscape
    expect(m.t.step).toBe('neutral');
    m.protocol(); expect(m.t.step).toBe('done'); expectContract(m);
  });
  it('survives the screen rotating under it (frame jump) at every point of the protocol', () => {
    for (const when of ['neutral', 'right-hold', 'left-hold', 'center', 'done']) for (const to of [90, 270]) {
      const m = rig({ rest: 0 }); m.t.beginProtocol();
      const jump = () => m.rotateScreen(to, to === 90 ? 90 : -90);
      m.hold(1200);
      if (when === 'neutral') jump();
      m.to(22, 400);
      if (when === 'right-hold') jump();
      m.hold(800); m.to(-22, 700);
      if (when === 'left-hold') jump();
      m.hold(800); m.to(0, 500);
      if (when === 'center') jump();
      m.hold(1500);
      if (m.t.step !== 'done') { m.hold(1500); m.protocol(); }           // a restart is allowed, a wrong result is not
      expect(m.t.step, `${when} ${to}`).toBe('done');
      if (when === 'done') jump(); m.hold(800);
      expectContract(m, `${when} ${to}`);
    }
  });
  it('steering keeps working after the screen rotates during a race (zero follows the frame)', () => {
    const m = rig(); m.t.beginProtocol(); m.protocol(); expect(m.t.step).toBe('done');
    m.rotateScreen(90, 90); m.hold(300);
    expect(Math.abs(m.t.steer)).toBeLessThan(0.1); expect(m.t.jumps).toBeGreaterThan(0);
    expectContract(m);
  });
  it('no jump compensation without a screen rotation (real motion is never "corrected")', () => {
    const m = rig(); m.t.beginProtocol(); m.protocol();
    m.to(60, 40); m.hold(300);
    expect(m.t.jumps).toBe(0); expect(m.t.steer).toBeGreaterThan(0.9);
  });
  it('the direction is measured every time and never restored from storage', () => {
    const a = rig({ mirrorX: true }); a.t.beginProtocol(); a.protocol(); expect(a.t.invert).toBe(true);
    const b = rig(); expect(b.t.invert).toBe(false);
  });
  it('Start is available without a sensor, and the manual flip reverses the mapping', () => {
    const t = new TiltInput(); t.beginProtocol();
    expect(t.ready).toBe(true);
    const m = rig(); m.t.beginProtocol(); m.protocol(); const s0 = m.contract()[22];
    m.t.flipDirection(); expect(m.contract()[22]).toBeLessThan(0); expect(s0).toBeGreaterThan(0);
  });
  it('PROPERTY: for 300 random histories (wandering, repositioning, screen rotations, noise) the contract always holds', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = createRng(seed);
      const o = { rest: RESTS[Math.floor(r() * 4)], mirrorX: r() < 0.3, flipSign: r() < 0.3 };
      const m = rig(o); m.t.isIOS = !!o.flipSign;
      m.hold(200 + r() * 800);
      for (let k = 0, n = Math.floor(r() * 6); k < n; k++) {                      // before and during calibration: random junk
        const kind = r();
        if (kind < 0.4) m.to((r() - 0.5) * 120, 100 + r() * 500);
        else if (kind < 0.6) m.hold(r() * 1500);
        else if (kind < 0.8) { m.rest = RESTS[Math.floor(r() * 4)]; m.cw = 0; m.hold(300); }
        else m.rotateScreen([0, 90, 180, 270][Math.floor(r() * 4)], [0, 90, -90, 180][Math.floor(r() * 4)]);
        if (r() < 0.3) m.t.beginProtocol();
      }
      m.remap = 0; m.to(0, 200);
      m.t.beginProtocol();
      for (let attempt = 0; attempt < 3 && m.t.step !== 'done'; attempt++) m.protocol();
      expect(m.t.step, `seed ${seed}`).toBe('done');
      expectContract(m, `seed ${seed} ${JSON.stringify(o)}`);
    }
  });
});
