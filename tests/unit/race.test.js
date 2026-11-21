import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createCar } from '../../src/sim/Car.js';
import { createWorld } from '../../src/sim/World.js';
import { driveSimple } from '../../src/sim/BotDriver.js';
import { computeRanks } from '../../src/sim/race.js';
import { resolveCarCollisions } from '../../src/sim/collisions.js';

const track = createTrack();
const DT = CONFIG.sim.STEP;

function runRace(seed, { turboPlayer = false, maxSeconds = 200 } = {}) {
  const w = createWorld({ track, seed });
  w.go(false);
  for (let i = 0; i < maxSeconds * 60 && !w.done; i++) {
    driveSimple(w.player, track);
    w.player.input.turbo = turboPlayer && i % 2000 === 600;
    w.step(DT);
  }
  return w;
}

describe('world setup', () => {
  it('has 4 cars on 4 distinct grid slots, player included', () => {
    const w = createWorld({ track, seed: 7 });
    expect(w.cars).toHaveLength(4);
    expect(w.cars.filter((c) => c.isPlayer)).toHaveLength(1);
    const keys = new Set(w.cars.map((c) => `${c.s}|${c.d}`));
    expect(keys.size).toBe(4);
    for (const c of w.cars) { expect(c.s).toBeLessThan(0); expect(Math.abs(c.d)).toBe(3); }
  });
  it('is deterministic for a seed and varies between seeds', () => {
    const slot = (seed) => { const w = createWorld({ track, seed }); return `${w.player.s}|${w.player.d}|${w.cars.map((c) => c.name).join()}`; };
    expect(slot(5)).toBe(slot(5));
    const all = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(slot));
    expect(all.size).toBeGreaterThan(3);
  });
  it('bots have distinct names and colours, none is the player colour', () => {
    const w = createWorld({ track, seed: 3 });
    const bots = w.cars.filter((c) => !c.isPlayer);
    expect(new Set(bots.map((b) => b.name)).size).toBe(3);
    expect(new Set(bots.map((b) => b.color)).size).toBe(3);
    expect(bots.every((b) => b.color !== w.player.color)).toBe(true);
  });
});

describe('ranking', () => {
  it('finished cars first by time, then by distance', () => {
    const a = createCar({ id: 1, s: 500 }), b = createCar({ id: 2, s: 900 }), c = createCar({ id: 3, s: 100 });
    c.finishTime = 90; a.finishTime = 85;
    const r = computeRanks([b, c, a]);
    expect(r.map((x) => x.id)).toEqual([1, 3, 2]);
    expect(a.rank).toBe(1); expect(c.rank).toBe(2); expect(b.rank).toBe(3);
  });
});

describe('collisions', () => {
  it('pushes overlapping cars apart and slows only the car behind (once)', () => {
    const a = createCar({ id: 1, s: 100, d: 0 }), b = createCar({ id: 2, s: 101.5, d: 0.3 });
    a.state = b.state = 'driving'; a.speed = b.speed = 30;
    resolveCarCollisions([a, b]);
    const { COLLIDE_A: A, COLLIDE_B: B } = CONFIG.race;
    expect(Math.hypot((b.s - a.s) / A, (b.d - a.d) / B)).toBeGreaterThanOrEqual(0.99);
    expect(a.speed).toBeCloseTo(27, 5);
    expect(b.speed).toBe(30);
    resolveCarCollisions([a, b]);
    expect(a.speed).toBeCloseTo(27, 5); // cooldown: no repeated drain
  });
  it('ignores cars that are far apart, side by side in separate lanes, or not driving', () => {
    const a = createCar({ id: 1, s: 100, d: -3 }), b = createCar({ id: 2, s: 100, d: 3 }), c = createCar({ id: 3, s: 160, d: -3 });
    resolveCarCollisions([a, b, c]);
    expect([a.s, a.d, b.s, b.d]).toEqual([100, -3, 100, 3]);
    const f = createCar({ id: 4, s: 100, d: -3 }); f.state = 'finished';
    const before = a.speed; resolveCarCollisions([a, f]); expect(a.speed).toBe(before);
  });
  it('handles exactly overlapping cars without NaN', () => {
    const a = createCar({ id: 1, s: 50, d: 0 }), b = createCar({ id: 2, s: 50, d: 0 });
    resolveCarCollisions([a, b]);
    expect(Number.isFinite(a.d) && Number.isFinite(b.d)).toBe(true);
    expect(a.d).not.toBe(b.d);
  });
});

describe('full race with 3 bots', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: everyone finishes, nobody falls, race is close and 80-105 s`, () => {
      const w = runRace(seed);
      expect(w.done).toBe(true);
      expect(w.finishOrder).toHaveLength(4);
      for (const c of w.cars) expect(c.respawns, c.name).toBe(0);
      const times = w.finishOrder.map((c) => c.finishTime);
      expect(times[0]).toBeGreaterThan(80);
      expect(times[3]).toBeLessThan(105);
      expect(times[3] - times[0]).toBeLessThan(8);
      expect(w.finishOrder.map((c) => c.place)).toEqual([1, 2, 3, 4]);
    });
  }
  it('a player using both turbos usually beats the bots', () => {
    let wins = 0;
    for (const seed of [1, 2, 3, 4, 5]) if (runRace(seed, { turboPlayer: true }).player.place === 1) wins++;
    expect(wins).toBeGreaterThanOrEqual(3);
  });
  it('bots use at most 2 turbos', () => {
    const w = runRace(2);
    for (const c of w.cars) expect(c.turbosLeft).toBeGreaterThanOrEqual(0);
  });
  it('start boost makes a car faster off the line', () => {
    const w1 = createWorld({ track, seed: 1, bots: 0 }), w2 = createWorld({ track, seed: 1, bots: 0 });
    w2.go(true);
    for (let i = 0; i < 120; i++) { driveSimple(w1.player, track); driveSimple(w2.player, track); w1.step(DT); w2.step(DT); }
    expect(w2.player.s).toBeGreaterThan(w1.player.s + 8);
  });
  it('forces stragglers to finish 60 s after the player', () => {
    const w = createWorld({ track, seed: 1 });
    w.player.s = track.finishS - 1; w.player.speed = 32;
    for (const [car] of w.brains) { car.input.speedMult = 0; }
    let n = 0;
    while (!w.done && n++ < 60 * 80) {
      driveSimple(w.player, track);
      w.step(DT);
      for (const [car] of w.brains) { car.s = Math.min(car.s, 300); car.speed = 0; car.stuckT = 0; }
    }
    expect(w.done).toBe(true);
    expect(w.time).toBeLessThan(80);
  });
});

describe('initial state', () => {
  it('ranks are 1..4 before the first step', () => {
    const w = createWorld({ track, seed: 2 });
    expect(w.cars.map((c) => c.rank).sort()).toEqual([1, 2, 3, 4]);
  });
});
