import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/sim/rng.js';

describe('createRng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
  it('returns values in [0,1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('differs between seeds', () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
});
