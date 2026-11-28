import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { TRACKS, TRACK_IDS, isTrackId, DEFAULT_TRACK } from '../../src/sim/tracks/index.js';
import { createWorld } from '../../src/sim/World.js';
import { createCar, stepCar } from '../../src/sim/Car.js';
import { driveSimple, drivePlayerProxy, createBrain } from '../../src/sim/BotDriver.js';
import { createRng } from '../../src/sim/rng.js';
import { generateBoxes } from '../../src/sim/boxLayout.js';

const city = createTrack('city'), desert = createTrack('desert');
const C = CONFIG.car;

describe('track registry', () => {
  it('knows the city and the desert; the city is the default; unknown ids are rejected', () => {
    expect(TRACK_IDS.sort()).toEqual(['city', 'desert']); expect(DEFAULT_TRACK).toBe('city');
    expect(isTrackId('city')).toBe(true); expect(isTrackId('moon')).toBe(false); expect(isTrackId(undefined)).toBe(false); expect(isTrackId('__proto__')).toBe(false);
    expect(() => createTrack('moon')).toThrow();
    expect(createTrack().id).toBe('desert');                 // old callers: no argument = the desert
  });
  it('the desert is unchanged: one lap, point to point', () => {
    expect(desert.loop).toBe(false); expect(desert.laps).toBe(1); expect(desert.lapAt(1000)).toBe(1); expect(desert.finishS).toBeCloseTo(desert.maxS - 120, 6);
  });
});

describe('city track: a closed loop of 2 laps', () => {
  const L = city.lapLength;
  it('about 60 s per lap at cruise speed, 2 laps, finish after the second', () => {
    expect(L / C.CRUISE_SPEED).toBeGreaterThan(55); expect(L / C.CRUISE_SPEED).toBeLessThan(68);
    expect(city.laps).toBe(2); expect(city.finishS).toBeCloseTo(2 * L, 6); expect(city.loop).toBe(true);
    expect(city.lapAt(-5)).toBe(1); expect(city.lapAt(L - 1)).toBe(1); expect(city.lapAt(L + 1)).toBe(2); expect(city.lapAt(2 * L + 50)).toBe(2);
  });
  it('closes exactly: the end of a lap is the start, with the same direction, and the heading never jumps', () => {
    const a = city.sample(0), b = city.sample(L), c = city.sample(2 * L);
    expect(Math.hypot(a.px - b.px, a.pz - b.pz)).toBeLessThan(0.01); expect(Math.hypot(a.px - c.px, a.pz - c.pz)).toBeLessThan(0.01);
    expect(Math.abs(Math.abs(city.headingTurn) - 2 * Math.PI)).toBeLessThan(1e-9);
    let prev = city.sample(city.minS), worst = 0;
    for (let s = city.minS + 0.5; s <= city.maxS; s += 0.5) { const p = city.sample(s); worst = Math.max(worst, Math.abs(p.heading - prev.heading)); prev = p; }
    expect(worst).toBeLessThan(0.05);                        // no 2*pi jump at the lap seam (the camera would swing)
  });
  it('the start grid and the run-out are on the loop (nothing outside the track)', () => {
    for (const s of [-40, -18, -6, 0, L, 2 * L, 2 * L + 120]) { const p = city.sample(s); expect(Number.isFinite(p.px + p.pz + p.heading)).toBe(true); }
    const a = city.sample(-10), b = city.sample(L - 10); expect(Math.hypot(a.px - b.px, a.pz - b.pz)).toBeLessThan(0.01);
  });
  it('FLOWING: every bend of the main road is wide (radius >= 50 m): at cruise speed nothing needs braking', () => {
    let kmax = 0; for (const s of city.samples) kmax = Math.max(kmax, Math.abs(s.curvature));
    expect(1 / kmax).toBeGreaterThanOrEqual(50);
    expect(kmax * C.CRUISE_SPEED ** 2 * C.DRIFT_K).toBeLessThan(12);         // sideways push in the tightest bend, m/s (the steering holds ~16)
  });
  it('the road is 18 m wide with a red/white kerb strip as the only run-off, no cliffs, walls, ramps or fixed obstacles', () => {
    for (const s of city.samples) { expect(s.halfWidth).toBe(9); expect(s.edgeLeft).toBe('sand'); expect(s.edgeRight).toBe('sand'); expect(s.sandLimL).toBeCloseTo(9 + city.runoff, 6); }
    expect(city.allRamps.length).toBe(0); expect(city.obstacles.length).toBe(0);                 // (the branches are separate roads) expect(city.groundHeight(500)).toBe(0); expect(city.inGap(500)).toBe(false);
  });
  it('a car cannot leave the road side of the kerb, and driving on the kerb strip does not slow it down', () => {
    const car = createCar({ s: 40, d: 0 }); car.speed = 32; car.yaw = 0.4;
    let worst = 0;
    for (let i = 0; i < 60 * 6; i++) { car.input.steer = 1; stepCar(car, 1 / 60, city); worst = Math.max(worst, Math.abs(car.d)); }
    expect(worst).toBeLessThanOrEqual(9 + city.runoff + 0.01); expect(car.state).toBe('driving');
    const on = createCar({ s: 40, d: 10 }), off = createCar({ s: 40, d: 0 }); on.speed = off.speed = 32;
    for (let i = 0; i < 120; i++) { on.input.steer = off.input.steer = 0; stepCar(on, 1 / 60, city); stepCar(off, 1 / 60, city); }
    expect(on.speed).toBeCloseTo(off.speed, 6);
  });
  it('the item boxes are laid out over both laps, on the road', () => {
    const boxes = generateBoxes(city, createRng(3));
    expect(boxes.length).toBeGreaterThan(30);
    for (const b of boxes) { expect(b.s).toBeGreaterThan(0); expect(b.s).toBeLessThan(city.finishS); expect(Math.abs(b.d)).toBeLessThan(9); }
  });
});

describe('racing on the city loop', () => {
  it('a centre-line driver at cruise speed laps 3 times without touching the kerb or slowing down for any bend', () => {
    const car = createCar({ s: -10, d: 0 }); car.speed = C.CRUISE_SPEED; let minSpeed = 99, edge = 0;
    for (let i = 0; i < 60 * 190; i++) {
      driveSimple(car, city, 0); stepCar(car, 1 / 60, city);
      if (car.s > 20 && car.s < 3 * city.lapLength - 100) { minSpeed = Math.min(minSpeed, car.speed); edge = Math.max(edge, Math.abs(car.d)); }
      if (car.s >= city.finishS) break;
    }
    expect(car.respawns).toBe(0); expect(minSpeed).toBeGreaterThan(C.CRUISE_SPEED * 0.97); expect(edge).toBeLessThan(5);
  });
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: 4 cars finish 2 laps, nobody falls or respawns, the winner takes 80-125 s`, () => {
      const w = createWorld({ track: city, seed, bots: 3 }); const brain = createBrain(createRng(seed + 99), city); w.go(true);
      let walls = 0;
      for (let i = 0; i < 60 * 220 && !w.done; i++) { drivePlayerProxy(w.player, brain, w); w.step(1 / 60); for (const c of w.cars) if (c.wallHit) { walls++; c.wallHit = false; } }
      expect(w.done, 'race finished').toBe(true);
      expect(w.cars.every((c) => c.finishTime != null && c.respawns === 0)).toBe(true);
      const t = Math.min(...w.cars.map((c) => c.finishTime));
      expect(t).toBeGreaterThan(80); expect(t).toBeLessThan(125);
      expect(walls).toBeLessThan(40);                      // bumping a wall is rare (a bend never forces it); the narrow alleys are where it happens
    });
  }
});
