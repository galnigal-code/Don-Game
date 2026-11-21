import { describe, it, expect } from 'vitest';
import { baseFov, horizontalFov } from '../../src/render/cameraMath.js';

describe('camera field of view', () => {
  it('keeps the tuned 65 degrees in landscape', () => {
    for (const a of [1.2, 1.78, 2.16, 2.4]) expect(baseFov(a)).toBe(65);
  });
  it('widens in portrait so the road and bends stay visible, with a cap', () => {
    expect(baseFov(0.5)).toBeGreaterThan(80);
    expect(baseFov(0.5)).toBeLessThanOrEqual(95);
    expect(baseFov(0.3)).toBe(95);
  });
  it('portrait gets at least ~55 degrees of horizontal view (it was ~33 before)', () => {
    for (const a of [0.5, 0.56, 0.75]) expect(horizontalFov(baseFov(a), a)).toBeGreaterThan(55);
    expect(horizontalFov(baseFov(0.45), 0.45)).toBeGreaterThan(50);       // very tall screens hit the 95 degree vertical cap
    expect(horizontalFov(65, 0.5)).toBeLessThan(40);
  });
  it('is continuous enough around the switch point and never below the landscape value', () => {
    for (let a = 0.3; a < 2.5; a += 0.05) expect(baseFov(a)).toBeGreaterThanOrEqual(65);
    expect(Math.abs(baseFov(1.19) - baseFov(1.2))).toBeLessThan(25);
  });
});
