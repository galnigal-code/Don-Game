import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createCar, stepCar } from '../../src/sim/Car.js';
import { RAMPS, FIXED_OBSTACLES, SEGMENTS } from '../../src/sim/trackData.js';

const track = createTrack();
const DT = CONFIG.sim.STEP;
const C = CONFIG.car;
const gapRamps = RAMPS.filter((r) => r.gap);

/** Drive straight onto a ramp at a given speed and report what happened. */
function jump(ramp, speed, { turbo = false, before = 60 } = {}) {
  const car = createCar({ s: ramp.s - before, d: 0 });
  car.state = 'driving'; car.speed = speed;
  car.lastCheckpointS = Math.max(0, Math.floor((ramp.s - before) / CONFIG.track.CHECKPOINT_EVERY) * CONFIG.track.CHECKPOINT_EVERY);
  if (turbo) car.turboT = 5;
  const out = { fell: false, maxH: 0, landedS: null, respawns: 0 };
  let wasAir = false;
  for (let i = 0; i < 60 * 7; i++) {
    car.input.steer = 0; car.input.speedMult = turbo ? 1 : speed / C.CRUISE_SPEED;
    stepCar(car, DT, track);
    if (car.state === 'falling') out.fell = true;
    out.maxH = Math.max(out.maxH, car.h);
    const air = car.h > track.groundHeight(car.s) + 0.01;
    if (wasAir && !air && out.landedS == null && car.state === 'driving') out.landedS = car.s;
    wasAir = air;
  }
  out.car = car; out.respawns = car.respawns;
  return out;
}

describe('ramp geometry', () => {
  it('surface rises along the ramp and is flat elsewhere', () => {
    const r = RAMPS[0];
    expect(track.groundHeight(r.s - r.len - 1)).toBe(0);
    expect(track.groundHeight(r.s + 1)).toBe(0);
    expect(track.groundHeight(r.s)).toBeCloseTo(r.rise, 6);
    let prev = -1;
    for (let s = r.s - r.len; s <= r.s; s += 0.5) { const h = track.groundHeight(s); expect(h).toBeGreaterThan(prev); prev = h; }
  });
  it('knows where the road is missing', () => {
    for (const r of gapRamps) {
      expect(track.inGap(r.gap.from - 0.1)).toBe(false);
      expect(track.inGap((r.gap.from + r.gap.to) / 2)).toBe(true);
      expect(track.inGap(r.gap.to + 0.1)).toBe(false);
    }
    expect(track.inGap(300)).toBe(false);
  });
  it('detects crossing the launch line once', () => {
    const r = RAMPS[1];
    expect(track.rampCrossed(r.s - 0.5, r.s + 0.5)).toBe(r);
    expect(track.rampCrossed(r.s + 0.5, r.s + 1.5)).toBeNull();
  });
});

describe('jumping', () => {
  it('there are 3-4 ramps and (V4) no trench after any of them: nobody can fall', () => {
    expect(RAMPS.length).toBeGreaterThanOrEqual(3);
    expect(RAMPS.length).toBeLessThanOrEqual(4);
    expect(gapRamps.length).toBe(0);
    for (let s = 0; s < track.finishS; s += 1) expect(track.inGap(s)).toBe(false);
  });
  it('a ramp without a gap is a hop: air time, no fall', () => {
    const r = jump(RAMPS[0], C.CRUISE_SPEED);
    expect(r.maxH).toBeGreaterThan(2);
    expect(r.fell).toBe(false);
    expect(r.car.state).toBe('driving');
    expect(r.landedS).toBeGreaterThan(RAMPS[0].s + 15);
  });
  for (const [name, speed, opts] of [['slow bot (80 %)', C.CRUISE_SPEED * 0.8, {}], ['cruise', C.CRUISE_SPEED, {}], ['turbo', C.CRUISE_SPEED * C.TURBO_MULT, { turbo: true }]]) {
    it(`clears every gap at ${name}`, () => {
      for (const ramp of gapRamps) {
        const r = jump(ramp, speed, opts);
        expect(r.fell, `ramp ${ramp.s}`).toBe(false);
        expect(r.respawns).toBe(0);
        expect(r.landedS).toBeGreaterThan(ramp.gap.to);
        expect(r.car.state).toBe('driving');
      }
    });
  }
  it('a slowed car (after a hit) falls into the trench and respawns before it', () => {
    for (const ramp of gapRamps) {
      const r = jump(ramp, 11, { before: 20 });
      expect(r.fell).toBe(true);
      expect(r.respawns).toBeGreaterThanOrEqual(1);
      expect(r.car.lastCheckpointS).toBeLessThan(ramp.gap.from);
    }
  });
  // (V4) the 'falls into the trench' tests were removed together with the trenches

  it('airborne cars cannot be steered', () => {
    const car = createCar({ s: RAMPS[0].s - 40, d: 0 });
    car.speed = C.CRUISE_SPEED;
    let yawInAir = null, steps = 0;
    for (let i = 0; i < 60 * 3; i++) {
      const air = car.h > 1.5;
      car.input.steer = air ? 1 : 0;           // straight to the ramp, then turn the wheel hard in the air
      stepCar(car, DT, track);
      if (air) { steps++; if (yawInAir == null) yawInAir = car.yaw; else expect(car.yaw).toBeCloseTo(yawInAir, 6); }
    }
    expect(steps).toBeGreaterThan(10);
  });
});

describe('track layout is sane', () => {
  const gapZones = gapRamps.map((r) => [r.gap.from - 8, r.gap.to + 8]);
  const rampZones = RAMPS.map((r) => [r.s - r.len - 60, (r.gap ? r.gap.to : r.s) + 60]);
  const inZones = (s, zs) => zs.some(([a, b]) => s >= a && s <= b);

  it('no checkpoint falls inside or right next to a gap', () => {
    for (let cp = 0; cp < track.finishS; cp += CONFIG.track.CHECKPOINT_EVERY) expect(inZones(cp, gapZones), `checkpoint ${cp}`).toBe(false);
  });
  it('ramps do not overlap cliffs, the canyon or each other', () => {
    for (const r of RAMPS) {
      for (const seg of SEGMENTS) expect(r.s - 20 > seg.to || (r.gap ? r.gap.to : r.s) + 20 < seg.from, `ramp ${r.s} vs ${seg.type}`).toBe(true);
    }
    const sorted = [...RAMPS].sort((a, b) => a.s - b.s);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].s - sorted[i - 1].s).toBeGreaterThan(300);
  });
  it('V4: there are no fixed obstacles on the road (only what players drop)', () => { expect(FIXED_OBSTACLES.length).toBe(0); });

  it('the whole race still takes about 90 s', () => {
    expect(track.finishS / C.CRUISE_SPEED).toBeGreaterThan(85);
    expect(track.finishS / C.CRUISE_SPEED).toBeLessThan(95);
  });
});
