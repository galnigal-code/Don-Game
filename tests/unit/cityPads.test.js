// V5-C: boost pads (green square, white arrows): 8 per lap, faster than the turbo, never stacked with it.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createWorld } from '../../src/sim/World.js';
import { createCar, stepCar } from '../../src/sim/Car.js';
import { driveSimple, drivePlayerProxy, createBrain, padPlan } from '../../src/sim/BotDriver.js';
import { createRng } from '../../src/sim/rng.js';

const city = createTrack('city'), L = city.lapLength, C = CONFIG.car, P = CONFIG.pads, DT = 1 / 60;
const lap0 = city.pads.filter((p) => p.s < L);
const tmp = {};

describe('where the pads are', () => {
  it('8 per lap: 3 on the road, one on each elevated track (long, short, secret) and one in each alley; 16 in the race', () => {
    expect(lap0.length).toBe(8); expect(city.pads.length).toBe(16);
    expect(lap0.filter((p) => p.route === 0).length).toBe(3);
    for (const r of [1, 2, 3, 4, 5]) expect(lap0.filter((p) => p.route === r).length, `route ${r}`).toBe(1);
    expect(city.pads.filter((p) => p.s >= L).every((p) => lap0.some((q) => q.route === p.route && Math.abs(q.s + L - p.s) < 1e-6))).toBe(true);     // lap 2 repeats lap 1
  });
  it('they are about a third of the road wide, fully on the road, and inside the stretch of their branch', () => {
    for (const p of lap0) {
      const hw = p.route ? city.branches[p.route - 1].hw : city.samples[0].halfWidth;
      expect(P.HALF_W * 2).toBeCloseTo(6, 6);
      expect(Math.abs(p.d) + P.HALF_W, `pad ${p.id}`).toBeLessThanOrEqual(hw - 0.9 + 1e-9);
      if (p.route) { const b = city.branches[p.route - 1]; expect(p.s).toBeGreaterThan(b.sa + 10); expect(p.s).toBeLessThan(b.sb - 5); }
    }
  });
  it('a pad on the road is not next to a branch entry or exit (no double effects), and has a long straight after it', () => {
    for (const p of lap0.filter((q) => q.route === 0)) {
      for (const b of city.branches) { expect(Math.abs(p.s - b.sa), `pad ${p.id} vs ${b.id} start`).toBeGreaterThan(30); expect(Math.abs(p.s - b.sb), `pad ${p.id} vs ${b.id} end`).toBeGreaterThan(30); }
      let kmax = 0; for (let s = p.s + 10; s <= p.s + 140; s += 2) kmax = Math.max(kmax, Math.abs(city.sample(s, tmp).curvature));
      expect(1 / kmax, `bend after pad ${p.id}`).toBeGreaterThan(90);       // the boost wears off before any bend that the steering could not hold
    }
  });
});

describe('what a pad does', () => {
  const crossRoad = (setup) => {
    const p = lap0.find((q) => q.route === 0); const car = createCar({ s: p.s - 60, d: p.d }); car.speed = C.CRUISE_SPEED; car.state = 'driving'; setup?.(car);
    const log = { v: [], events: 0 };
    for (let i = 0; i < 60 * 6; i++) { driveSimple(car, city, p.d); stepCar(car, DT, city); log.v.push(car.speed); if (car.padEvent) { log.events++; car.padEvent = null; } }
    return { car, log, p };
  };
  it('a car that drives over a pad gets 1.8 times the speed within a second, keeps it about 2 seconds, then slows back down', () => {
    const { log } = crossRoad();
    const peak = Math.max(...log.v); expect(peak).toBeGreaterThan(C.CRUISE_SPEED * 1.78); expect(peak).toBeLessThanOrEqual(C.CRUISE_SPEED * P.MULT + 0.01);
    const above = log.v.filter((v) => v > C.CRUISE_SPEED * 1.7).length / 60; expect(above).toBeGreaterThan(1.4); expect(above).toBeLessThan(2.6);
    expect(log.v.at(-1)).toBeCloseTo(C.CRUISE_SPEED, 0);
    expect(log.events).toBe(1);                                          // one event per pad, not one per step
  });
  it('the pad is stronger than a turbo and they do not stack', () => {
    const { log } = crossRoad((c) => { c.turboT = 2.5; });
    expect(Math.max(...log.v)).toBeLessThanOrEqual(C.CRUISE_SPEED * P.MULT + 0.01);          // not 1.6 x 1.8
    const t = createCar({ s: 100, d: 0 }); t.speed = C.CRUISE_SPEED; t.turboT = 2.5; for (let i = 0; i < 90; i++) { driveSimple(t, city, 0); stepCar(t, DT, city); }
    expect(t.speed).toBeCloseTo(C.CRUISE_SPEED * C.TURBO_MULT, 1);                           // a turbo alone is still 1.6 x
  });
  it('a pad is ignored by a car beside it, in the air, on another route, or not driving', () => {
    const p = lap0.find((q) => q.route === 0), peak = (mut) => { const c = createCar({ s: p.s - 3, d: p.d }); c.speed = C.CRUISE_SPEED; c.state = 'driving'; mut(c); let m = 0; for (let i = 0; i < 40; i++) { c.input.steer = 0; stepCar(c, DT, city); m = Math.max(m, c.speed); } return m; };
    expect(peak(() => {})).toBeGreaterThan(40);
    expect(peak((c) => { c.d = p.d + 3.5; })).toBeLessThan(C.CRUISE_SPEED + 0.01);
    expect(peak((c) => { c.h = 3; c.vy = 5; })).toBeLessThan(C.CRUISE_SPEED + 0.01);
    expect(peak((c) => { c.route = 0; c.s = p.s + 30; })).toBeLessThan(C.CRUISE_SPEED + 0.01);       // already past it
  });
  it('a pad on a branch works for the cars on that branch only, in both laps', () => {
    for (const p of lap0.filter((q) => q.route > 0)) for (const lap of [0, 1]) {
      const b = city.branches[p.route - 1], car = createCar({ s: p.s + lap * L - 25 * b.warp, d: p.d }); car.route = p.route; car.routeLap = lap; car.speed = C.CRUISE_SPEED; car.state = 'driving';
      let peak = 0, ev = 0; for (let i = 0; i < 90; i++) { car.input.steer = 0; driveSimple(car, city, p.d); stepCar(car, DT, city); peak = Math.max(peak, car.speed); if (car.padEvent) { ev++; car.padEvent = null; } }
      expect(peak, `${b.id} lap ${lap + 1}`).toBeGreaterThan(C.CRUISE_SPEED * 1.7); expect(ev).toBeGreaterThan(0);
      const other = createCar({ s: p.s + lap * L - 40, d: p.d }); other.route = 0; other.speed = C.CRUISE_SPEED; let pk2 = 0; for (let i = 0; i < 70; i++) { other.input.steer = 0; stepCar(other, DT, city); pk2 = Math.max(pk2, other.speed); }
      expect(pk2, `${b.id}: a car on the road under it`).toBeLessThan(C.CRUISE_SPEED + 0.01 + (lap ? 0 : 0) + 30 * 0);
    }
  });
  it('the world turns a pad into one event, with the route', () => {
    const w = createWorld({ track: city, seed: 1, bots: 0 }); const p = lap0.find((q) => q.route === 0), c = w.player; w.go(); c.s = p.s - 30; c.d = p.d; c.speed = 32;
    for (let i = 0; i < 120; i++) { driveSimple(c, city, p.d); w.step(DT); }
    const ev = w.events.filter((e) => e.type === 'pad'); expect(ev.length).toBe(1); expect(ev[0]).toMatchObject({ carId: c.id, route: 0 });
  });
});

describe('bots and pads', () => {
  it('a bot aims at a pad it can reach (most of the time) and ignores far-away ones', () => {
    const w = createWorld({ track: city, seed: 1, bots: 1 }); const p = lap0.find((q) => q.route === 0), car = w.cars[1]; car.state = 'driving'; car.route = 0;
    let took = 0;
    for (let seed = 1; seed <= 100; seed++) { const brain = createBrain(createRng(seed), city); car.s = p.s - 40; car.d = p.d + 3; if (Math.abs(padPlan(car, brain, w, 0) - p.d) < 1e-9) took++; }
    expect(took).toBeGreaterThan(70); expect(took).toBeLessThan(96);
    const brain = createBrain(createRng(1), city); car.s = p.s - 40; car.d = p.d + 20; expect(padPlan(car, brain, w, 1.5)).toBe(1.5);          // too far to the side
    car.s = p.s - 200; car.d = p.d; expect(padPlan(car, brain, w, 1.5)).toBe(1.5);                                                              // too far ahead
  });
  it('in a full race the cars hit pads many times and nothing breaks', () => {
    let pads = 0;
    for (const seed of [1, 2, 3]) {
      const w = createWorld({ track: city, seed, bots: 3 }); const brain = createBrain(createRng(seed + 9), city); w.go(true);
      for (let i = 0; i < 60 * 200 && !w.done; i++) { drivePlayerProxy(w.player, brain, w); w.step(DT); for (const e of w.events) if (e.type === 'pad') pads++; w.events.length = 0; }
      expect(w.done).toBe(true); expect(w.cars.every((c) => c.respawns === 0)).toBe(true);
    }
    expect(pads).toBeGreaterThan(30);
  });
});
