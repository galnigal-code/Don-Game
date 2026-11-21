import { describe, it, expect } from 'vitest';
import { QualityController, LEVELS, initialLevel } from '../../src/render/quality.js';

/** Run the controller for `seconds` at a constant frame rate; returns the level changes. */
function run(q, seconds, fps) {
  const dt = 1 / fps, changes = [];
  for (let t = 0; t < seconds; t += dt) { const c = q.frame(dt); if (c !== null) changes.push(c); }
  return changes;
}

describe('quality controller', () => {
  it('stays put at a steady 60 fps', () => {
    const q = new QualityController();
    expect(run(q, 60, 60)).toEqual([]);
    expect(q.level).toBe(3);
  });
  it('ignores the warm-up (shader compilation, loading)', () => {
    const q = new QualityController();
    expect(run(q, 2.4, 8)).toEqual([]);
  });
  it('steps down when the frame rate stays low, one level at a time, until the lowest', () => {
    const q = new QualityController();
    const changes = run(q, 60, 20);
    expect(changes[0]).toBe(2);
    expect(changes).toEqual([2, 1, 0]);
    expect(q.level).toBe(0);
  });
  it('reacts within a few seconds to a slow phone', () => {
    const q = new QualityController();
    run(q, 2.5, 60);
    const t0 = q.t; let at = null;
    for (let i = 0; i < 60 * 12 && at === null; i++) if (q.frame(1 / 30) === 2) at = q.t - t0;
    expect(at).toBeGreaterThan(2);
    expect(at).toBeLessThan(6);
  });
  it('does not step down for a short dip or a single hitch', () => {
    const q = new QualityController();
    run(q, 5, 60); run(q, 1.2, 25); run(q, 10, 60);
    expect(q.level).toBe(3);
    q.frame(0.9); q.frame(0.5);                       // tab was hidden for a moment
    run(q, 5, 60); expect(q.level).toBe(3);
  });
  it('never goes below level 0 or above the maximum', () => {
    const q = new QualityController({ start: 0 });
    run(q, 40, 10); expect(q.level).toBe(0);
    const r = new QualityController({ start: 3 });
    run(r, 120, 60); expect(r.level).toBe(3);
  });
  it('recovers one step after a long stretch of good frame rate, but only once per level', () => {
    const q = new QualityController();
    run(q, 8, 20);                                    // drop (to 2, maybe 1)
    const low = q.level; expect(low).toBeLessThan(3);
    run(q, 40, 60);                                   // phone is fine now: climbs back
    expect(q.level).toBeGreaterThan(low);
    const up = q.level;
    run(q, 15, 20);                                   // fails again at that level -> down
    expect(q.level).toBeLessThan(up);
    run(q, 60, 60);                                   // it must not flip-flop forever
    const ups = q.history.filter((h) => h.dir === 'up' && h.level === up).length;
    expect(ups).toBeLessThanOrEqual(1);
  });
  it('a borderline 50 fps neither drops nor climbs', () => {
    const q = new QualityController();
    expect(run(q, 90, 50)).toEqual([]);
  });
  it('levels get cheaper as the level goes down', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].pixelRatio).toBeGreaterThanOrEqual(LEVELS[i - 1].pixelRatio);
      expect(LEVELS[i].particles).toBeGreaterThanOrEqual(LEVELS[i - 1].particles);
      expect(LEVELS[i].decor).toBeGreaterThanOrEqual(LEVELS[i - 1].decor);
    }
    expect(LEVELS[0].pixelRatio).toBeLessThan(LEVELS[3].pixelRatio);
  });
  it('weak devices start lower', () => {
    expect(initialLevel({ cores: 8, memory: 8 })).toBe(3);
    expect(initialLevel({ cores: 4, memory: 8 })).toBe(2);
    expect(initialLevel({ cores: 8, memory: 2 })).toBe(2);
  });
});
