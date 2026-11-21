import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createCar, stepCar } from '../../src/sim/Car.js';
import { createWorld } from '../../src/sim/World.js';
import { driveSimple } from '../../src/sim/BotDriver.js';
import { SEGMENTS } from '../../src/sim/trackData.js';

const track = createTrack();
const DT = CONFIG.sim.STEP;
const C = CONFIG.car;

function run(car, seconds, steer = 0, turbo = false) {
  for (let t = 0; t < seconds; t += DT) { car.input.steer = steer; car.input.turbo = turbo; stepCar(car, DT, track); }
}

describe('TrackModel', () => {
  it('has a race length of about 2900 m', () => {
    expect(track.finishS).toBeGreaterThan(2750);
    expect(track.finishS).toBeLessThan(3050);
  });
  it('starts at s=0 flat and with a lead-in', () => {
    expect(track.minS).toBeLessThan(0);
    expect(Math.abs(track.sample(0).py)).toBeLessThan(0.01);
  });
  it('is continuous: 1 m steps, right is perpendicular to tangent, heading is unwrapped', () => {
    for (let s = track.minS; s < track.maxS - 1; s += 7) {
      const a = track.toWorld(s, 0), b = track.toWorld(s + 1, 0);
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.9);
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1.1);
      const p = track.sample(s);
      expect(Math.abs(p.rx * p.tx + p.rz * p.tz)).toBeLessThan(0.02 + 0.2 * Math.abs(p.ty));
      expect(Math.abs(track.sample(s + 1).heading - p.heading)).toBeLessThan(0.05);
    }
  });
  it('toWorld offsets along the right vector (+d = right)', () => {
    const p = track.sample(100), w = track.toWorld(100, 5);
    expect(w.x).toBeCloseTo(p.px + p.rx * 5, 6);
    expect(w.z).toBeCloseTo(p.pz + p.rz * 5, 6);
  });
  it('first straight faces -z and right is +x', () => {
    const p = track.sample(20);
    expect(p.tz).toBeLessThan(-0.99);
    expect(p.rx).toBeGreaterThan(0.99);
  });
  it('never crosses itself', () => {
    let min = Infinity;
    for (let i = 0; i < track.samples.length; i += 5)
      for (let j = i + 150; j < track.samples.length; j += 5) {
        const a = track.samples[i], b = track.samples[j];
        min = Math.min(min, Math.hypot(a.px - b.px, a.pz - b.pz));
      }
    expect(min).toBeGreaterThan(50);
  });
  it('marks canyon (narrow, walls) and cliff sections', () => {
    const canyon = SEGMENTS.find((x) => x.type === 'canyon');
    const mid = track.sample((canyon.from + canyon.to) / 2);
    expect(mid.halfWidth).toBeCloseTo(CONFIG.track.CANYON_HALF_WIDTH, 1);
    expect(mid.edgeLeft).toBe('wall');
    const cliff = SEGMENTS.find((x) => x.type === 'cliff' && x.side === 'left');
    expect(track.sample((cliff.from + cliff.to) / 2).edgeLeft).toBe('cliff');
    expect(track.sample(300).edgeLeft).toBe('sand');
  });
});

describe('Car', () => {
  it('accelerates by itself to cruise speed and drives straight', () => {
    const car = createCar({ s: 0 });
    run(car, 5);
    expect(car.speed).toBeCloseTo(C.CRUISE_SPEED, 0);
    expect(car.s).toBeGreaterThan(90);
    expect(Math.abs(car.d)).toBeLessThan(0.5);
  });
  it('steers right with positive input', () => {
    const car = createCar({ s: 0 });
    run(car, 3);                 // reach cruise speed on the straight
    const d0 = car.d;
    run(car, 1, 0.5);
    expect(car.d - d0).toBeGreaterThan(2);
    const car2 = createCar({ s: 0 });
    run(car2, 3); run(car2, 1, -0.5);
    expect(car2.d).toBeLessThan(-2);
  });
  it('is slowed by sand and can drive on it', () => {
    const car = createCar({ s: 0, d: 0 });
    run(car, 3);            // still on the opening straight
    car.d = 11; car.yaw = 0;
    run(car, 1, 0);
    expect(car.offroad).toBe(true);
    expect(car.speed).toBeLessThan(C.CRUISE_SPEED * 0.8);
  });
  it('is stopped by canyon walls', () => {
    const car = createCar({ s: 1250 });
    run(car, 3, 1);
    const hw = track.sample(car.s).halfWidth;
    expect(Math.abs(car.d)).toBeLessThanOrEqual(hw + 1e-6);
    expect(car.state).toBe('driving');
  });
  it('falls off a cliff and respawns at the last checkpoint', () => {
    const car = createCar({ s: 640 });
    run(car, 1);
    let fell = false;
    for (let i = 0; i < 60 * 6 && car.respawns === 0; i++) {
      car.input.steer = -1; stepCar(car, DT, track);
      if (car.state === 'falling') fell = true;
    }
    expect(fell).toBe(true);
    expect(car.respawns).toBe(1);
    expect(car.state).toBe('driving');
    expect(car.s).toBe(car.lastCheckpointS);
    expect(car.d).toBe(0);
    expect(car.lastCheckpointS % CONFIG.track.CHECKPOINT_EVERY).toBe(0);
  });
  it('has exactly 2 turbos per race', () => {
    const car = createCar({ s: 0 });
    const press = () => { car.input.turbo = true; stepCar(car, DT, track); car.input.turbo = false; stepCar(car, DT, track); };
    press(); expect(car.turbosLeft).toBe(1); expect(car.turboT).toBeGreaterThan(0);
    press(); expect(car.turbosLeft).toBe(1); // still active, not wasted
    run(car, C.TURBO_TIME + 0.2);
    press(); expect(car.turbosLeft).toBe(0);
    run(car, C.TURBO_TIME + 0.2);
    press(); expect(car.turbosLeft).toBe(0);
  });
  it('turbo makes the car faster', () => {
    const a = createCar({ s: 0 }), b = createCar({ s: 0 });
    run(a, 3); b.input.turbo = true; run(b, 3, 0, true);
    expect(b.s).toBeGreaterThan(a.s + 10);
  });
});

describe('full race simulation', () => {
  it('a simple driver finishes in 80-105 s without falling', () => {
    const world = createWorld({ track, seed: 1, bots: 0 });
    const car = world.player;
    let guard = 0;
    while (car.state !== 'finished' && guard++ < 60 * 200) {
      driveSimple(car, track);
      world.step(DT);
    }
    expect(car.state).toBe('finished');
    expect(car.respawns).toBe(0);
    expect(car.finishTime).toBeGreaterThan(80);
    expect(car.finishTime).toBeLessThan(105);
    expect(world.finishOrder[0]).toBe(car);
    expect(car.place).toBe(1);
  });
  it('a finished car coasts to a stop before the end of the road', () => {
    const world = createWorld({ track, seed: 1, bots: 0 });
    const car = world.player;
    for (let i = 0; i < 60 * 110; i++) { driveSimple(car, track); world.step(DT); }
    expect(car.speed).toBeLessThan(0.5);
    expect(car.s).toBeLessThan(track.maxS);
  });
});
