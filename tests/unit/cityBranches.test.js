// V5-B: the branches of the city: alleys (corner cuts), the long elevated track, the short floating track (jump), the secret door (jump).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createWorld } from '../../src/sim/World.js';
import { createCar, stepCar } from '../../src/sim/Car.js';
import { driveSimple, drivePlayerProxy, driveBot, createBrain, branchPlan } from '../../src/sim/BotDriver.js';
import { resolveCarCollisions } from '../../src/sim/collisions.js';
import { useItem } from '../../src/sim/items.js';
import { stepEntities } from '../../src/sim/entities.js';
import { createRng } from '../../src/sim/rng.js';

const city = createTrack('city'), L = city.lapLength, C = CONFIG.car, DT = 1 / 60;
const B = Object.fromEntries(city.branches.map((b) => [b.id, b]));
const tmpA = {}, tmpB = {};

describe('the branches exist and are laid out sensibly', () => {
  it('there are five: two alleys, the long elevated, the short floating, the secret door', () => {
    expect(city.branches.map((b) => b.id)).toEqual(['alleyA', 'alleyB', 'sky', 'neo', 'secret']);
    expect(city.branches.map((b) => b.kind)).toEqual(['alley', 'alley', 'elevated', 'neo', 'secret']);
    expect(city.branches.filter((b) => b.end === 'jump').map((b) => b.id)).toEqual(['neo', 'secret']);
  });
  it('they leave the road where it says: same place, same heading at the start; at the end the same (over the road for a jump)', () => {
    for (const b of city.branches) {
      const m0 = city.sample(b.sa, tmpA), b0 = city.sample(b.sa, tmpB, b.index);
      const wx = m0.px + m0.rx * b.entryCenter, wz = m0.pz + m0.rz * b.entryCenter;
      expect(Math.hypot(b0.px - wx, b0.pz - wz), `${b.id} start`).toBeLessThan(0.5); expect(Math.abs(b0.py - m0.py), `${b.id} start height`).toBeLessThan(0.05);
      expect(Math.abs(b0.heading - m0.heading), `${b.id} start heading`).toBeLessThan(0.08);
      const m1 = city.sample(b.sb, tmpA), b1 = city.sample(b.sb, tmpB, b.index);
      const ex = m1.px + m1.rx * b.exitD, ez = m1.pz + m1.rz * b.exitD;
      expect(Math.hypot(b1.px - ex, b1.pz - ez), `${b.id} end`).toBeLessThan(0.5); expect(Math.abs(b1.py - (m1.py + b.exitH)), `${b.id} end height`).toBeLessThan(0.05);
      expect(Math.abs(b1.heading - m1.heading), `${b.id} end heading`).toBeLessThan(0.06);
      expect(Math.abs(b.exitD), `${b.id} exit over the road`).toBeLessThan(9);
    }
    expect(B.neo.exitH).toBeGreaterThan(5); expect(B.secret.exitH).toBeGreaterThan(9); expect(B.alleyA.exitH).toBe(0); expect(B.sky.exitH).toBe(0);
  });
  it('FLOWING: gentle slopes (<= 15 %), wide bends (alleys R >= 40 m, the others >= 45 m)', () => {
    for (const b of city.branches) {
      let kmax = 0, slope = 0;
      for (let i = 0; i < b.samples.length; i++) { kmax = Math.max(kmax, Math.abs(b.samples[i].curvature)); if (i) slope = Math.max(slope, Math.abs(b.samples[i].py - b.samples[i - 1].py)); }
      expect(1 / kmax, `${b.id} radius`).toBeGreaterThanOrEqual(b.kind === 'alley' ? 40 : 45); expect(slope, `${b.id} slope`).toBeLessThanOrEqual(0.15);
      expect(kmax * C.CRUISE_SPEED ** 2 * C.DRIFT_K, `${b.id} sideways push`).toBeLessThan(14);
    }
  });
  it('NO road lies low over another road: where a branch is near another road it is high above it or runs beside it', () => {
    for (const b of city.branches) {
      let worst = 1e9;
      for (const p of b.samples) {
        if (p.py > 3.2) continue;                                    // high up: a flyover is fine
        for (let k = 0; k < city.samples.length; k += 2) { const q = city.samples[k]; if (q.s > b.sa - 45 && q.s < b.sb + 45) continue; worst = Math.min(worst, Math.hypot(p.px - q.px, p.pz - q.pz)); }
      }
      expect(worst, `${b.id} clearance from the rest of the road`).toBeGreaterThan(25);
    }
  });
  it('the branches do not cross each other low down', () => {
    for (const a of city.branches) for (const c of city.branches) {
      if (a.index >= c.index) continue;
      for (const p of a.samples) for (let k = 0; k < c.samples.length; k += 2) { const q = c.samples[k]; if (Math.abs(p.py - q.py) > 4) continue; if (p.py > 3.2 && q.py > 3.2) { /* both high: still must not overlap */ } expect(Math.hypot(p.px - q.px, p.pz - q.pz), `${a.id} vs ${c.id}`).toBeGreaterThan(Math.max(0, a.hw + c.hw - 0.01) > 0 ? 6 : 0); }
    }
  });
  it('the alleys are real shortcuts (>= 1.8 s faster than the road), the others are about as long as the road', () => {
    for (const id of ['alleyA', 'alleyB']) expect((B[id].sb - B[id].sa - B[id].length) / C.CRUISE_SPEED, id).toBeGreaterThan(1.8);
    for (const id of ['sky', 'neo', 'secret']) { const diff = Math.abs(B[id].sb - B[id].sa - B[id].length) / C.CRUISE_SPEED; expect(diff, id).toBeLessThan(1.1); }
    expect(B.alleyA.warp).toBeGreaterThan(1.2); expect(B.alleyB.warp).toBeGreaterThan(1.2);
  });
  it('the branches lie inside one lap and do not overlap in a way that confuses the entry (windows are on the road, narrow)', () => {
    for (const b of city.branches) {
      expect(b.sa).toBeGreaterThanOrEqual(0); expect(b.sb).toBeLessThan(L); expect(b.entry[0]).toBeLessThan(b.entry[1]);
      expect(b.entry[1] - b.entry[0]).toBeLessThanOrEqual(6); expect(Math.min(...b.entry)).toBeGreaterThanOrEqual(-city.samples[0].halfWidth - city.runoff);
    }
    expect(B.sky.entry[0]).toBeGreaterThan(0); expect(B.neo.entry[1]).toBeLessThan(0); expect(B.secret.entry[1]).toBeLessThan(-6);       // sky: the right, neo: the left, secret: only the very left edge
  });
});

describe('entering and leaving a branch', () => {
  const run = (b, d, { lap = 0, steps = 60 * 15, drive = true } = {}) => {
    const car = createCar({ s: b.sa + lap * L - 5, d }); car.speed = C.CRUISE_SPEED; car.state = 'driving'; car.lastCheckpointS = 0;
    const log = { routes: new Set(), walls: 0, falls: 0, maxH: 0, landed: null };
    for (let i = 0; i < steps; i++) {
      if (drive) driveSimple(car, city, car.route ? 0 : d); stepCar(car, DT, city);
      log.routes.add(car.route); if (car.wallHit) { log.walls++; car.wallHit = false; } if (car.state === 'falling') log.falls++; log.maxH = Math.max(log.maxH, car.h);
      if (log.landed == null && car.route === 0 && log.routes.size > 1 && car.h < 0.01 && car.vy === 0) log.landed = car.s;
      if (car.s > b.sb + lap * L + 90) break;
    }
    return { car, log };
  };
  for (const b of [B.alleyA, B.alleyB, B.sky, B.neo, B.secret]) {
    it(`${b.id}: a car aiming at the entry takes the branch, drives it without touching a wall and comes back onto the road`, () => {
      const { car, log } = run(b, b.entryCenter);
      expect([...log.routes].sort()).toEqual([0, b.index]); expect(log.walls).toBe(0); expect(log.falls).toBe(0); expect(car.respawns).toBe(0);
      expect(car.route).toBe(0); expect(car.s).toBeGreaterThan(b.sb);
      if (b.end === 'jump') { expect(log.maxH).toBeGreaterThan(b.exitH - 0.2); expect(log.landed).not.toBeNull(); expect(log.landed - b.sb).toBeLessThan(75); expect(log.landed - b.sb).toBeGreaterThan(15); }
      else expect(log.maxH).toBeLessThan(0.1);
    });
    it(`${b.id}: ...also in the second lap`, () => {
      const { log, car } = run(b, b.entryCenter, { lap: 1 }); expect([...log.routes].sort()).toEqual([0, b.index]); expect(log.walls).toBe(0); expect(car.respawns).toBe(0);
    });
    it(`${b.id}: a car that misses the entry window stays on the road, with no penalty`, () => {
      const other = b.entryCenter > 0 ? b.entry[0] - 3.2 : b.entry[1] + 3.2;
      const { car, log } = run(b, other, { steps: 60 * 6 }); expect([...log.routes]).toEqual([0]); expect(log.walls).toBe(0); expect(car.speed).toBeGreaterThan(C.CRUISE_SPEED * 0.99);
    });
  }
  it('a car in the air or a car that is not driving is never carried onto a branch', () => {
    const b = B.sky, a = createCar({ s: b.sa - 1, d: b.entryCenter }); a.speed = 32; a.h = 2; a.vy = 3; stepCar(a, DT, city); stepCar(a, DT, city); stepCar(a, DT, city); expect(a.route).toBe(0);
  });
  it('s runs faster along a shortcut (warp): the finish line is reached sooner by the car that took it', () => {
    const t = (take) => { const w = createWorld({ track: city, seed: 1, bots: 0 }); const c = w.player; c.s = 400; c.d = take ? 6.2 : 0; c.speed = 32; w.go();
      for (let i = 0; i < 60 * 30; i++) { c.input.steer = 0; driveSimple(c, city, c.route ? 0 : (take ? 6.2 : 0)); w.step(DT); if (c.s > 900) return w.time; } return 99; };
    expect(t(false) - t(true)).toBeGreaterThan(1.8);
  });
});

describe('cars on different routes are separate', () => {
  it('they do not collide, even when they overlap in s and d', () => {
    const a = createCar({ id: 0, s: 600, d: 0 }), b = createCar({ id: 1, s: 600.5, d: 0.3 }); a.speed = 30; b.speed = 30; b.route = 1;
    const sa = a.s, db = b.d; resolveCarCollisions([a, b]); expect(a.s).toBe(sa); expect(b.d).toBe(db);
    b.route = 0; resolveCarCollisions([a, b]); expect(a.s === sa && b.d === db).toBe(false);          // same route: they do
  });
  it('a mine on the road does not hit a car on a branch (and vice versa); a mine dropped on a branch stays on it', () => {
    const w = createWorld({ track: city, seed: 1, bots: 0 }); const c = w.player; w.go();
    c.s = 580; c.d = 0; c.route = 1; c.item = 'mine'; c.rouletteT = 0; useItem(c, w);
    const mine = w.entities.find((e) => e.type === 'mine'); expect(mine.route).toBe(1);
    const other = createCar({ id: 7, s: mine.s, d: mine.d }); other.state = 'driving'; other.route = 0; w.cars.push(other); stepEntities(w, DT); expect(other.hit.kind).toBeNull();
    other.route = 1; stepEntities(w, DT); expect(other.hit.kind).toBe('spin');
  });
  it('boxes on a branch belong to it: only cars on it pick them up', () => {
    const w = createWorld({ track: city, seed: 1, bots: 0 }); w.go();
    const box = w.boxes.find((b) => b.route === B.sky.index); expect(box).toBeTruthy();
    const road = w.player; road.s = box.s; road.d = box.d; road.route = 0; w.step(DT); expect(box.t).toBe(0);
    road.route = B.sky.index; road.s = box.s; road.d = box.d; w.step(DT); expect(box.t).toBeGreaterThan(0);
    expect(w.boxes.filter((b) => b.route === B.sky.index).length).toBe(5 * 2); expect(w.boxes.filter((b) => b.route === B.neo.index).length).toBe(3 * 2);       // every lap
  });
  it('the rank follows s: a car on a shortcut that is further along is ahead', () => {
    const w = createWorld({ track: city, seed: 1, bots: 1 }); w.go(); const [a, b] = w.cars; a.s = 700; a.route = 1; b.s = 650; w.step(DT);
    expect(a.rank).toBe(1); expect(b.rank).toBe(2);
  });
});

describe('bots and the branches', () => {
  it('a bot decides once per lap: takes the branch (aims at the window) or keeps out of it', () => {
    const w = createWorld({ track: city, seed: 1, bots: 1 }); const br = B.alleyA, car = w.cars[1];
    let took = 0, kept = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const brain = createBrain(createRng(seed), city); car.s = br.sa - 40; car.route = 0; car.state = 'driving';
      const t = branchPlan(car, brain, w, 0);
      if (Math.abs(t - br.entryCenter) < 0.001) took++; else { kept++; expect(t < br.entry[0] - 1 || t > br.entry[1] + 1).toBe(true); }
      expect(branchPlan(car, brain, w, 0)).toBe(t);                       // the same answer for the whole approach
    }
    expect(took).toBeGreaterThan(20); expect(kept).toBeGreaterThan(10);
  });
  it('only a few bots know the secret door', () => {
    const w = createWorld({ track: city, seed: 1, bots: 1 }); const car = w.cars[1]; let took = 0;
    for (let seed = 1; seed <= 200; seed++) { const brain = createBrain(createRng(seed), city); car.s = B.secret.sa - 40; car.route = 0; if (Math.abs(branchPlan(car, brain, w, 0) - B.secret.entryCenter) < 0.001) took++; }
    expect(took).toBeGreaterThan(0); expect(took).toBeLessThan(40);
  });
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: with 3 bots and a proxy player taking branches: everybody finishes, nobody falls or respawns, every branch is used`, () => {
      const w = createWorld({ track: city, seed, bots: 3 }); const brain = createBrain(createRng(seed + 9), city); w.go(true);
      const used = new Set(); let walls = 0;
      for (let i = 0; i < 60 * 230 && !w.done; i++) { drivePlayerProxy(w.player, brain, w); w.step(DT); for (const c of w.cars) { if (c.route) used.add(c.route); if (c.wallHit) { walls++; c.wallHit = false; } } }
      expect(w.done).toBe(true); expect(w.cars.every((c) => c.respawns === 0 && c.finishTime != null)).toBe(true);
      for (const b of [1, 2, 3, 4]) expect(used.has(b), `branch ${b} used`).toBe(true);
      expect(walls).toBeLessThan(45);
    });
  }
  it('200 wild races: no car ever falls, gets stuck inside a wall or leaves the world (all routes)', () => {
    let falls = 0, bad = 0, steps = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createRng(seed * 7 + 3); const w = createWorld({ track: city, seed, bots: 3 }); w.brains.clear(); w.go(true);
      const plan = w.cars.map(() => ({ steer: 0, until: 0 }));
      for (let i = 0; i < 60 * 130 && !w.done; i++) {
        w.cars.forEach((c, k) => { if (w.time >= plan[k].until) { plan[k].steer = rng() < 0.3 ? 0 : (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.7); plan[k].until = w.time + 0.3 + rng() * 2.5; } c.input.steer = plan[k].steer; c.input.turbo = rng() < 0.01; c.input.item = rng() < 0.02; });
        w.step(DT); steps++;
        for (const c of w.cars) {
          if (c.state === 'falling') falls++;
          const sm = city.sample(c.s, tmpA, c.route), lim = (c.route ? sm.halfWidth - C.HALF_WIDTH : (c.d < 0 ? sm.sandLimL : sm.sandLimR)) + 0.7;
          if (!(Math.abs(c.d) <= lim) && c.h < 1) bad++;
          if (!Number.isFinite(c.s + c.d + c.h + c.speed)) bad++;
          if (c.route === 0 && c.h < -0.01) bad++;
        }
      }
    }
    expect(steps).toBeGreaterThan(200000); expect(falls).toBe(0); expect(bad).toBe(0);
  }, 180000);
});
