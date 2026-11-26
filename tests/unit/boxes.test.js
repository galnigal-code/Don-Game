import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createRng } from '../../src/sim/rng.js';
import { createWorld } from '../../src/sim/World.js';
import { generateBoxes } from '../../src/sim/boxLayout.js';
import { createBrain, drivePlayerProxy } from '../../src/sim/BotDriver.js';
import { FIXED_OBSTACLES } from '../../src/sim/trackData.js';

const track = createTrack();
const B = CONFIG.boxes;
const layout = (seed) => generateBoxes(track, createRng(seed * 7919 + 13));
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe('scattered item boxes', () => {
  it('every seed gives 20-32 boxes', () => {
    for (const seed of SEEDS) { const n = layout(seed).length; expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(20); expect(n, `seed ${seed}`).toBeLessThanOrEqual(32); }
  });
  it('obeys every placement rule, for 200 layouts', () => {
    for (const seed of SEEDS) for (const b of layout(seed)) {
      const sm = track.sample(b.s), where = `seed ${seed} box ${b.id} s=${b.s.toFixed(0)} d=${b.d.toFixed(1)}`;
      expect(b.s, where).toBeGreaterThan(100);
      expect(b.s, where).toBeLessThan(track.finishS - B.LAST_MARGIN + 1);
      expect(Math.abs(b.d), where).toBeLessThanOrEqual(sm.halfWidth - B.WALL_MARGIN + 1e-9);        // never glued to a wall
      expect(track.inGap(b.s), where).toBe(false);
      for (const r of track.ramps) {
        const end = r.gap ? r.gap.to : r.s;
        expect(b.s < r.s - r.len - B.RAMP_CLEAR || b.s > end + B.RAMP_CLEAR, `${where} near ramp ${r.s}`).toBe(true);
      }
      if (sm.edgeLeft === 'cliff') expect(b.d, where).toBeGreaterThanOrEqual(-(sm.halfWidth - B.CLIFF_MARGIN));
      if (sm.edgeRight === 'cliff') expect(b.d, where).toBeLessThanOrEqual(sm.halfWidth - B.CLIFF_MARGIN);
      for (const o of FIXED_OBSTACLES) expect(Math.hypot(o.s - b.s, o.d - b.d), `${where} near obstacle ${o.s}`).toBeGreaterThanOrEqual(B.OBSTACLE_CLEAR);
    }
  });
  it('is not a row: boxes at the same distance are never lined up, and pairs are spread apart', () => {
    for (const seed of SEEDS) {
      const bs = layout(seed);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        if (Math.abs(bs[i].s - bs[j].s) < B.PAIR_SPREAD_S + 0.5 + 7) expect(Math.abs(bs[i].d - bs[j].d), `seed ${seed}`).toBeGreaterThanOrEqual(B.PAIR_MIN_D - 1e-9);
      }
      expect(bs.some((b, i) => i && Math.abs(b.s - bs[i - 1].s) < 10)).toBe(true);       // some pairs exist
      expect(bs.filter((b, i) => !i || Math.abs(b.s - bs[i - 1].s) >= 10).length).toBeGreaterThan(14);   // and plenty of single boxes
    }
  });
  it('spreads over the road width: every third of the width gets at least 25 % of the boxes', () => {
    const thirds = [0, 0, 0]; let total = 0;
    for (const seed of SEEDS) for (const b of layout(seed)) { const hw = track.sample(b.s).halfWidth; thirds[Math.min(2, Math.floor((b.d + hw) / (2 * hw) * 3))]++; total++; }
    for (const t of thirds) expect(t / total).toBeGreaterThan(0.25);
  });
  it('there is always a box coming up: consecutive boxes are rarely far apart (dead zones are ramps)', () => {
    const gaps = [];
    for (const seed of SEEDS) { const bs = layout(seed); for (let i = 1; i < bs.length; i++) gaps.push(bs[i].s - bs[i - 1].s); }
    gaps.sort((a, b) => a - b);
    expect(gaps[Math.floor(gaps.length * 0.95)]).toBeLessThan(230);
    expect(gaps[gaps.length - 1]).toBeLessThan(350);
  });
  it('is deterministic for a seed and different between seeds', () => {
    expect(JSON.stringify(layout(5))).toBe(JSON.stringify(layout(5)));
    expect(JSON.stringify(layout(5))).not.toBe(JSON.stringify(layout(6)));
    const w1 = createWorld({ track, seed: 9 }), w2 = createWorld({ track, seed: 9 }), w3 = createWorld({ track, seed: 10 });
    expect(JSON.stringify(w1.boxes)).toBe(JSON.stringify(w2.boxes));
    expect(JSON.stringify(w1.boxes)).not.toBe(JSON.stringify(w3.boxes));
  });
  it('the layout does not disturb the bots: grid and names depend only on the seed as before', () => {
    const w = createWorld({ track, seed: 3 });
    expect(w.cars.map((c) => c.name).join()).toBe(createWorld({ track, seed: 3 }).cars.map((c) => c.name).join());
  });
  it('bots still collect plenty of items and every race finishes (4 seeds)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const w = createWorld({ track, seed, roller: false }); w.go(false);
      const brain = createBrain(createRng(seed + 1000), track);
      const picked = new Map();
      for (let i = 0; i < 60 * 220 && !w.done; i++) {
        drivePlayerProxy(w.player, brain, w); w.step(CONFIG.sim.STEP);
        for (const e of w.events) if (e.type === 'pickup') picked.set(e.carId, (picked.get(e.carId) || 0) + 1);
      }
      expect(w.done, `seed ${seed}`).toBe(true);
      expect(w.stats.pickups, `seed ${seed}`).toBeGreaterThanOrEqual(8);
    }
  });
  it('a bot reaches boxes it can steer to and ignores those it cannot', () => {
    const w = createWorld({ track, seed: 1, bots: 0 });
    const car = w.player; car.s = 500; car.d = 0; car.speed = 30; car.item = null; car.rouletteT = 0;
    w.boxes = [{ id: 0, s: 520, d: 9, t: 0 }, { id: 1, s: 545, d: -1, t: 0 }];     // first one: 9 m sideways in 20 m (limit is 8 m), unreachable
    const brain = createBrain(createRng(1), track);
    const steer = () => { drivePlayerProxy(car, brain, w, { turbo: false }); return car.input.steer; };
    car.yaw = 0; steer();
    // the target must be the second box (d = -1), so the steering is not pulled towards +7
    expect(car.input.steer).toBeLessThanOrEqual(0.15);
  });
});
