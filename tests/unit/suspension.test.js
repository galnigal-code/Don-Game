import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Spring, CarSuspension, wheelSteerAngle } from '../../src/render/suspension.js';

describe('suspension', () => {
  it('a spring settles back to its target without blowing up, for any frame time', () => {
    for (const dt of [0.004, 0.016, 0.05, 0.2]) {
      const s = new Spring(); s.kick(5);
      let peak = 0;
      for (let t = 0; t < 4; t += dt) peak = Math.max(peak, Math.abs(s.step(0, dt)));
      expect(Math.abs(s.x)).toBeLessThan(0.01); expect(peak).toBeLessThan(2); expect(Number.isFinite(s.x)).toBe(true);
    }
  });
  it('landing compresses the body down, then it recovers', () => {
    const sus = new CarSuspension();
    for (let i = 0; i < 200; i++) sus.update({ vy: -12, speed: 40, steer: 0 }, 0.016);   // falling steadily
    const r = sus.update({ vy: 0, speed: 40, steer: 0 }, 0.016);          // sudden stop of the fall = jolt up
    let low = 0, cur = r;
    for (let i = 0; i < 20; i++) { cur = sus.update({ vy: 0, speed: 40, steer: 0 }, 0.016); low = Math.min(low, cur.y); }
    expect(low).toBeLessThan(-0.03);
    for (let i = 0; i < 300; i++) cur = sus.update({ vy: 0, speed: 40, steer: 0 }, 0.016);
    expect(Math.abs(cur.y)).toBeLessThan(0.005);
  });
  it('nose dips when braking, rises when accelerating', () => {
    const a = new CarSuspension(), b = new CarSuspension();
    let ra, rb;
    for (let i = 0; i < 30; i++) { ra = a.update({ vy: 0, speed: 40 - i, steer: 0 }, 0.016); rb = b.update({ vy: 0, speed: 20 + i, steer: 0 }, 0.016); }
    expect(ra.pitch).toBeGreaterThan(rb.pitch);
    expect(Math.sign(ra.pitch)).not.toBe(Math.sign(rb.pitch));
  });
  it('NaN-free on wild input', () => {
    const sus = new CarSuspension();
    for (const v of [1e6, -1e6, 0]) { const r = sus.update({ vy: v, speed: v, steer: v }, 0.5); expect(Number.isFinite(r.y + r.pitch + r.roll)).toBe(true); }
  });
});

describe('front wheel direction (direction contract)', () => {
  // Independent check: a wheel pivot turned by wheelSteerAngle(+1) must point its forward axis (-z) to the car's RIGHT (+x).
  const forwardOf = (steer) => new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, wheelSteerAngle(steer), 0));
  it('steer right (+) points the wheels to the right (+x)', () => { expect(forwardOf(1).x).toBeGreaterThan(0.3); expect(forwardOf(1).z).toBeLessThan(0); });
  it('steer left (-) points the wheels to the left (-x)', () => { expect(forwardOf(-1).x).toBeLessThan(-0.3); });
  it('straight is straight', () => { expect(Math.abs(forwardOf(0).x)).toBeLessThan(1e-9); });
});
