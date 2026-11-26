import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createCar, stepCar } from '../../src/sim/Car.js';
import { createWorld } from '../../src/sim/World.js';
import { resolveCarCollisions, massOf } from '../../src/sim/collisions.js';
import { createBrain, drivePlayerProxy, driveBot } from '../../src/sim/BotDriver.js';
import { createRng } from '../../src/sim/rng.js';
import { SEGMENTS } from '../../src/sim/trackData.js';

const track = createTrack();
const DT = CONFIG.sim.STEP;
const K = CONFIG.bump;

function pair(a, b) {
  const A = createCar({ id: 1, ...a }), B = createCar({ id: 2, ...b });
  for (const [c, o] of [[A, a], [B, b]]) { c.state = 'driving'; c.speed = o.speed ?? 30; c.yaw = o.yaw ?? 0; c.vd = o.vd ?? 0; if (o.turbo) c.turboT = 2; }
  return [A, B];
}
const collide = (cars, world = null) => resolveCarCollisions(cars, world ? { world } : {});
const mkWorld = () => ({ events: [], stats: { hits: 0, bumps: 0 } });

describe('side impacts throw the other car sideways (direction contract)', () => {
  it('rammed from the RIGHT (the other car is at larger d and steers left into us) -> thrown LEFT', () => {
    const [a, b] = pair({ s: 100, d: 0 }, { s: 100, d: 1.6, yaw: -0.3 });
    collide([a, b]);
    expect(a.vd).toBeLessThan(-2);          // negative d = left
    expect(b.vd).toBeGreaterThan(0);        // the rammer bounces back to the right
  });
  it('rammed from the LEFT -> thrown RIGHT', () => {
    const [a, b] = pair({ s: 100, d: 0 }, { s: 100, d: -1.6, yaw: 0.3 });
    collide([a, b]);
    expect(a.vd).toBeGreaterThan(2);
    expect(b.vd).toBeLessThan(0);
  });
  it('the thrown car really moves that way over the next second and the nose turns with it', () => {
    const [a, b] = pair({ s: 300, d: 0 }, { s: 300, d: 1.6, yaw: -0.3 });
    collide([a, b]);
    const d0 = a.d;
    for (let i = 0; i < 60; i++) { a.input.steer = 0; stepCar(a, DT, track); }
    expect(a.d - d0).toBeLessThan(-1);
  });
  it('a car that is not approaching (side by side, same heading) is only separated, no impulse', () => {
    const [a, b] = pair({ s: 100, d: 0 }, { s: 100, d: 1.5 });
    collide([a, b]);
    expect(a.vd).toBe(0); expect(b.vd).toBe(0);
    expect(Math.abs(b.d - a.d)).toBeGreaterThanOrEqual(K.CONTACT_B - 1e-9);
  });
});

describe('impacts from behind', () => {
  it('the car behind slows, the car in front is pushed forward, momentum is conserved', () => {
    const [a, b] = pair({ s: 100, d: 0, speed: 34 }, { s: 103.5, d: 0, speed: 28 });
    const before = a.speed + b.speed;
    collide([a, b]);
    expect(a.speed).toBeLessThan(34); expect(b.speed).toBeGreaterThan(28);
    expect(a.speed + b.speed).toBeCloseTo(before, 6);
  });
  it('a gentle nudge (small closing speed) causes no shove; a hard one does', () => {
    const [a, b] = pair({ s: 100, d: 0, speed: 31 }, { s: 103.5, d: 0, speed: 29 });
    const w = mkWorld(); collide([a, b], w);
    expect(a.hit.kind).toBeNull(); expect(b.hit.kind).toBeNull();
    const [c, d] = pair({ s: 100, d: 0, speed: 40 }, { s: 103.5, d: 0, speed: 28 });
    const w2 = mkWorld(); collide([c, d], w2);
    expect([c.hit.kind, d.hit.kind].includes('shove')).toBe(true);
    expect(w2.events.some((e) => e.type === 'collide' && e.strength > K.SHOVE_REL)).toBe(true);
  });
});

describe('mass: a turbo car is heavier', () => {
  it('masses', () => { const c = createCar({}); expect(massOf(c)).toBe(1); c.turboT = 1; expect(massOf(c)).toBe(K.TURBO_MASS); });
  it('the heavy car loses less speed and the LIGHT one gets the shove, never the heavy one', () => {
    const [a, b] = pair({ s: 100, d: 0, speed: 42, turbo: true }, { s: 103.5, d: 0, speed: 30 });
    collide([a, b], mkWorld());
    expect(a.hit.kind).toBeNull();
    expect(b.hit.kind).toBe('shove');
    expect(42 - a.speed).toBeLessThan(b.speed - 30);
  });
  it('with equal mass the car that was driven INTO gets the shove, not the one that rammed', () => {
    const [a, b] = pair({ s: 100, d: 0 }, { s: 100, d: 1.6, yaw: -0.45 });       // b rams a
    collide([a, b], mkWorld());
    expect(a.hit.kind).toBe('shove');
    expect(b.hit.kind).toBeNull();
  });
  it('a shield protects against the shove', () => {
    const [a, b] = pair({ s: 100, d: 0, speed: 42, turbo: true }, { s: 103.5, d: 0, speed: 30 });
    b.shieldT = 5;
    collide([a, b], mkWorld());
    expect(b.hit.kind).toBeNull();
  });
});

describe('robustness', () => {
  it('an immediate second contact of the same pair has no extra effect (cooldown), a later one does', () => {
    const [a, b] = pair({ s: 100, d: 0, speed: 34 }, { s: 103.5, d: 0, speed: 28 });
    collide([a, b]); const sa = a.speed;
    a.s = 100; b.s = 103.5; a.speed = 34; b.speed = 28;
    collide([a, b]); expect(a.speed).toBe(34);
    for (let i = 0; i < 20; i++) { stepCar(a, DT, track); stepCar(b, DT, track); }
    a.s = 100; b.s = 103.5; a.speed = 34; b.speed = 28;
    collide([a, b]); expect(a.speed).toBeLessThan(34);
    void sa;
  });
  it('exactly overlapping cars: no NaN, they end up apart', () => {
    const [a, b] = pair({ s: 50, d: 0 }, { s: 50, d: 0 });
    collide([a, b]);
    for (const x of [a.s, a.d, a.speed, a.vd, b.s, b.d, b.speed, b.vd]) expect(Number.isFinite(x)).toBe(true);
    expect(a.d).not.toBe(b.d);
  });
  it('the sideways velocity dies out within 2 seconds', () => {
    const c = createCar({ s: 100, d: 0 }); c.speed = 30; c.vd = K.MAX_VD;
    for (let i = 0; i < 120; i++) { c.input.steer = 0; stepCar(c, DT, track); }
    expect(Math.abs(c.vd)).toBeLessThan(0.1);
  });
  it('cars that are finished, falling or respawning take no part', () => {
    for (const state of ['finished', 'falling', 'respawning']) {
      const [a, b] = pair({ s: 100, d: 0 }, { s: 100, d: 1.6, yaw: -0.3 });
      b.state = state; collide([a, b]);
      expect(a.vd, state).toBe(0); expect(b.vd, state).toBe(0);
    }
  });
  it('the impulse is capped (a crazy closing speed cannot launch a car)', () => {
    const [a, b] = pair({ s: 100, d: 0, speed: 60 }, { s: 103, d: 0, speed: 0 });
    collide([a, b]);
    expect(Math.abs(a.speed - 60)).toBeLessThanOrEqual(K.MAX_DSPEED + 1e-9);
    expect(Math.abs(b.vd)).toBeLessThanOrEqual(K.MAX_VD);
  });
});

describe('walls and cliffs', () => {
  it('a canyon wall stops a thrown car and bounces it back a little', () => {
    const canyon = SEGMENTS.find((x) => x.type === 'canyon'), s = (canyon.from + canyon.to) / 2;
    const hw = track.sample(s).halfWidth;
    const c = createCar({ s, d: hw - 0.5 }); c.speed = 30; c.vd = K.MAX_VD;
    let maxD = 0;
    for (let i = 0; i < 90; i++) { c.input.steer = 0; stepCar(c, DT, track); maxD = Math.max(maxD, Math.abs(c.d)); }
    expect(maxD).toBeLessThanOrEqual(hw + 1e-9);
    expect(c.state).toBe('driving');
  });
  it('a car at the edge of an unfenced cliff that is thrown over it falls (and comes back)', () => {
    const s = 1950;                                           // the right-hand cliff, on an almost straight bit (no bend drift to fight the throw)
    expect(track.sample(s).edgeRight).toBe('cliff');
    const hw = track.sample(s).halfWidth;
    const c = createCar({ s, d: hw - 0.5 }); c.speed = 30; c.vd = K.MAX_VD;     // half a metre from the edge, thrown towards it
    let fell = false;
    for (let i = 0; i < 60 * 6 && c.respawns === 0; i++) { c.input.steer = 0; stepCar(c, DT, track); if (c.state === 'falling') fell = true; }
    expect(fell).toBe(true); expect(c.respawns).toBe(1); expect(c.vd).toBe(0);
  });
  it('a thrown car in the middle of the road does NOT fall off a cliff: the throw is at most about 3 m', () => {
    const cliff = SEGMENTS.find((x) => x.type === 'cliff' && x.side === 'left'), s = cliff.from + 40;
    const hw = track.sample(s).halfWidth;
    const c = createCar({ s, d: -(hw - 5.5) }); c.speed = 30; c.vd = -K.MAX_VD;
    for (let i = 0; i < 120; i++) { c.input.steer = 0; stepCar(c, DT, track); }
    expect(c.respawns).toBe(0);
  });
});

describe('bots', () => {
  it('lean into a neighbour now and then, but never next to a cliff', () => {
    const w = createWorld({ track, seed: 1, bots: 1 });
    const [p, bot] = w.cars; const brain = w.brains.get(bot);
    brain.aggression = 0.7;
    const run = (s, lateral) => { brain.nudgeUntil = 0; for (let i = 0; i < 60 * 20; i++) { bot.s = s; bot.d = 0; bot.speed = 30; p.s = s; p.d = lateral; p.state = 'driving'; bot.state = 'driving'; w.time += DT; driveBot(bot, brain, w); if (brain.nudgeUntil > 0) return true; } return false; };
    expect(run(300, 3)).toBe(true);                         // open road: it eventually nudges
    const cliff = SEGMENTS.find((x) => x.type === 'cliff' && x.side === 'left');
    expect(run(cliff.from + 40, 3)).toBe(false);            // cliff: never
  });
});

describe('whole races with the new collisions', () => {
  it('everyone still finishes in 70-110 s and collisions actually happen', () => {
    let bumps = 0, respawns = 0, shoves = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = createWorld({ track, seed, roller: false }); w.go(false);
      const brain = createBrain(createRng(seed + 1000), track);
      for (let i = 0; i < 60 * 220 && !w.done; i++) {
        drivePlayerProxy(w.player, brain, w); w.step(DT);
        for (const e of w.events) if (e.type === 'hit' && e.kind === 'shove') shoves++;
        w.events.length = 0;
      }
      expect(w.done, `seed ${seed}`).toBe(true);
      expect(w.finishOrder[0].finishTime, `seed ${seed}`).toBeGreaterThan(70);
      expect(w.finishOrder[3].finishTime, `seed ${seed}`).toBeLessThan(110);
      bumps += w.stats.bumps; respawns += w.cars.reduce((x, c) => x + c.respawns, 0);
    }
    expect(bumps).toBeGreaterThan(6);                        // cars really do hit each other
    expect(respawns).toBeLessThanOrEqual(8);                 // but it does not turn into a demolition derby
    void shoves;
  });
});
