import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEG, wrapPi, gravityToScreen, rollAngle, rollFromMotion, smoothAngle, steerFromRoll } from '../../src/input/tiltMath.js';

const G = 9.81;
// World-up vector in device frame for a device rotated CLOCKWISE by phi (as the user sees it)
// while its screen is at orientation `angle`. (inverse of gravityToScreen)
function deviceUp(phiDeg, angle) {
  const p = phiDeg * DEG, t = angle * DEG;
  const gs = { x: -Math.sin(p) * G, y: Math.cos(p) * G };            // up in screen frame
  return { x: gs.x * Math.cos(t) + gs.y * Math.sin(t), y: -gs.x * Math.sin(t) + gs.y * Math.cos(t) };
}
const OPTS = { deadZone: 3 * DEG, maxAngle: 30 * DEG };

describe('gravityToScreen', () => {
  it('upright phone has world-up = screen-up in all four orientations', () => {
    const ups = { 0: { x: 0, y: G }, 90: { x: G, y: 0 }, 180: { x: 0, y: -G }, 270: { x: -G, y: 0 } };
    for (const [angle, u] of Object.entries(ups)) {
      const g = gravityToScreen(u, Number(angle));
      expect(g.x).toBeCloseTo(0, 6); expect(g.y).toBeCloseTo(G, 6);
    }
  });
});

describe('roll / steering direction', () => {
  it('clockwise rotation (right side down) gives positive roll and steers RIGHT, in every orientation', () => {
    for (const angle of [0, 90, 180, 270]) {
      const { roll } = rollFromMotion(deviceUp(20, angle), angle, false);
      expect(roll / DEG).toBeCloseTo(20, 4);
      expect(steerFromRoll(roll, 0, OPTS)).toBeGreaterThan(0);
    }
  });
  it('counter-clockwise rotation steers LEFT, in every orientation', () => {
    for (const angle of [0, 90, 180, 270]) {
      const { roll } = rollFromMotion(deviceUp(-20, angle), angle, false);
      expect(roll / DEG).toBeCloseTo(-20, 4);
      expect(steerFromRoll(roll, 0, OPTS)).toBeLessThan(0);
    }
  });
  it('iOS reports the inverted sign and is corrected', () => {
    const u = deviceUp(25, 90);
    const ios = rollFromMotion({ x: -u.x, y: -u.y }, 90, true);
    expect(ios.roll / DEG).toBeCloseTo(25, 4);
  });
  it('reports a small planar component when the phone lies flat', () => {
    expect(rollFromMotion({ x: 0.3, y: 0.2, z: 9.8 }, 0, false).planar).toBeLessThan(1);
    expect(rollFromMotion(deviceUp(0, 90), 90, false).planar).toBeCloseTo(G, 4);
  });
});

describe('steerFromRoll', () => {
  it('has a dead zone', () => {
    expect(steerFromRoll(2 * DEG, 0, OPTS)).toBe(0);
    expect(steerFromRoll(-2.9 * DEG, 0, OPTS)).toBe(0);
  });
  it('saturates at maxAngle and is symmetric', () => {
    expect(steerFromRoll(30 * DEG, 0, OPTS)).toBeCloseTo(1, 6);
    expect(steerFromRoll(80 * DEG, 0, OPTS)).toBe(1);
    expect(steerFromRoll(-80 * DEG, 0, OPTS)).toBe(-1);
    expect(steerFromRoll(16.5 * DEG, 0, OPTS)).toBeCloseTo(0.5, 6);
  });
  it('is relative to the calibrated zero', () => {
    expect(steerFromRoll(40 * DEG, 40 * DEG, OPTS)).toBe(0);
    expect(steerFromRoll(70 * DEG, 40 * DEG, OPTS)).toBeCloseTo(1, 6);
    expect(steerFromRoll(10 * DEG, 40 * DEG, OPTS)).toBeCloseTo(-1, 6);
  });
  it('can be inverted', () => {
    expect(steerFromRoll(20 * DEG, 0, { ...OPTS, invert: true })).toBeLessThan(0);
  });
  it('handles angle wrap-around', () => {
    expect(steerFromRoll(-175 * DEG, 175 * DEG, OPTS)).toBeGreaterThan(0);   // 10° clockwise across the ±180° seam
  });
});

describe('helpers', () => {
  it('wrapPi', () => { expect(wrapPi(3 * Math.PI)).toBeCloseTo(Math.PI, 6); expect(wrapPi(-3.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 6); });
  it('smoothAngle moves towards the target the short way round', () => {
    expect(smoothAngle(179 * DEG, -179 * DEG, 0.5) / DEG).toBeCloseTo(180, 4);
    expect(smoothAngle(0, 10 * DEG, 0.25) / DEG).toBeCloseTo(2.5, 6);
  });
  it('rollAngle of straight-up is 0', () => { expect(rollAngle({ x: 0, y: 9.8 })).toBeCloseTo(0, 9); });
});

import { TiltInput } from '../../src/input/TiltInput.js';

describe('direction test (learns what "right" means from the player)', () => {
  let clock = 1000;
  const realNow = performance.now.bind(performance);
  beforeEach(() => { clock = 1000; performance.now = () => clock; });
  afterEach(() => { performance.now = realNow; });

  // feed the sensor for `ms` milliseconds at 60 Hz with a phone rotated `deg` degrees clockwise
  // mirrorX = a device whose x axis is reported mirrored (the only kind of fault that flips the steering direction;
  // negating BOTH axes, as iOS does, only shifts the zero angle by 180 degrees)
  function feed(t, deg, angle = 0, ms = 1000, mirrorX = false) {
    const u = deviceUp(deg, angle);
    for (let i = 0; i < ms / 16; i++) {
      clock += 16;
      t.onMotion({ accelerationIncludingGravity: { x: mirrorX ? -u.x : u.x, y: u.y, z: 0 } });
    }
  }
  function pose(mirrorX, angle) {
    const t = new TiltInput();
    t.isIOS = false;
    feed(t, 0, angle, 800, mirrorX);
    t.beginDirectionTest();
    return t;
  }
  it('keeps the default when the sensor agrees (tilting right gives positive roll)', () => {
    const t = pose(false, 0);
    feed(t, 20, 0, 300); t.updateDirectionTest();
    expect(t.dirLearned).toBe(true); expect(t.invert).toBe(false);
  });
  it('flips when the device reports the opposite sign for the same physical motion', () => {
    for (const angle of [0, 90, 270]) {
      const t = pose(true, angle);            // a phone whose x axis is mirrored
      feed(t, 20, angle, 300, true); t.updateDirectionTest();
      expect(t.dirLearned).toBe(true); expect(t.invert).toBe(true);
      expect(t.previewSteer).toBeGreaterThan(0);   // and now tilting right steers right
    }
  });
  it('negating both axes (iOS-style) does not change the direction at all', () => {
    const t = new TiltInput(); t.isIOS = false;
    const u0 = deviceUp(0, 0), u1 = deviceUp(20, 0);
    for (let i = 0; i < 50; i++) { clock += 16; t.onMotion({ accelerationIncludingGravity: { x: -u0.x, y: -u0.y, z: 0 } }); }
    t.beginDirectionTest();
    for (let i = 0; i < 20; i++) { clock += 16; t.onMotion({ accelerationIncludingGravity: { x: -u1.x, y: -u1.y, z: 0 } }); }
    t.updateDirectionTest();
    expect(t.dirLearned).toBe(true); expect(t.invert).toBe(false);
  });
  it('ignores tiny movements and stops after learning once', () => {
    const t = pose(false, 0);
    feed(t, 6, 0, 500); t.updateDirectionTest();
    expect(t.dirLearned).toBe(false);
    feed(t, 20, 0, 300); t.updateDirectionTest();
    expect(t.dirLearned).toBe(true);
    const inv = t.invert;
    feed(t, -25, 0, 500); t.updateDirectionTest();
    expect(t.invert).toBe(inv);
  });
  it('manual flip overrides and stops the test', () => {
    const t = pose(false, 0);
    t.flipDirection();
    expect(t.invert).toBe(true); expect(t.dirTest).toBe(false);
    feed(t, 25, 0, 500); t.updateDirectionTest();
    expect(t.invert).toBe(true);
  });
});
