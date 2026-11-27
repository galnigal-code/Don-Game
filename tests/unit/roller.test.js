import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createCar, stepCar } from '../../src/sim/Car.js';
import { createWorld } from '../../src/sim/World.js';
import { stepRoller, rollerTargetSpeed, placeAheadOfRoller } from '../../src/sim/roller.js';
import { computeRanks } from '../../src/sim/race.js';
import { createBrain, driveBot, drivePlayerProxy, driveItems } from '../../src/sim/BotDriver.js';
import { createRng } from '../../src/sim/rng.js';
import { useItem } from '../../src/sim/items.js';

const track = createTrack();
const DT = CONFIG.sim.STEP;
const R = CONFIG.roller;

/** A world with hand-placed cars; only the roller is stepped (cars stay where they are). */
function arena(positions) {
  const w = createWorld({ track, seed: 1, bots: 0, roller: true });
  w.cars.length = 0;
  w.cars.push(...positions.map((s, i) => { const c = createCar({ id: i, s, isPlayer: i === 0 }); c.speed = 30; return c; }));
  w.player = w.cars[0];
  w.leaderS = Math.max(...positions);
  return w;
}
const stepRollerFor = (w, sec) => { for (let i = 0; i < sec / DT; i++) { w.time += DT; w.leaderS = Math.max(...w.cars.filter((c) => c.state === 'driving').map((c) => c.s), 0); stepRoller(w, DT); } };

describe('start', () => {
  it('stays away until the leader passes 25 % of the track', () => {
    const w = arena([100, 500]);
    stepRollerFor(w, 2); expect(w.roller.active).toBe(false);
    w.cars[1].s = R.START_FRACTION * track.finishS - 1; stepRollerFor(w, 1); expect(w.roller.active).toBe(false);
    w.cars[1].s = R.START_FRACTION * track.finishS + 5; stepRollerFor(w, DT * 2);
    expect(w.roller.active).toBe(true);
  });
  it('appears SPAWN_BEHIND metres behind the LAST car and announces itself', () => {
    const w = arena([300, 760, 700]);
    stepRollerFor(w, DT * 2);
    expect(w.roller.s).toBeCloseTo(300 - R.SPAWN_BEHIND, 0);
    expect(w.events.filter((e) => e.type === 'roller-start')).toHaveLength(1);
    stepRollerFor(w, 1);
    expect(w.events.filter((e) => e.type === 'roller-start')).toHaveLength(1);       // only once
  });
  it('can be switched off, and IS off by default (the roller is shelved)', () => {
    expect(createWorld({ track, seed: 1, roller: false }).roller.ended).toBe(true);
    expect(CONFIG.roller.ENABLED).toBe(false);
    expect(createWorld({ track, seed: 1 }).roller.ended).toBe(true);
  });
});

describe('speed', () => {
  it('rises smoothly from SPEED_START to SPEED_END of cruise along the track and never past', () => {
    const r = { s: 0, startS: 0 };
    let prev = 0;
    for (let s = 0; s <= track.finishS; s += 100) { r.s = s; const v = rollerTargetSpeed(r, track.finishS); expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
    r.s = 0; expect(rollerTargetSpeed(r, track.finishS)).toBeCloseTo(CONFIG.car.CRUISE_SPEED * R.SPEED_START, 6);
    r.s = track.finishS * 5; expect(rollerTargetSpeed(r, track.finishS)).toBeCloseTo(CONFIG.car.CRUISE_SPEED * R.SPEED_END, 6);
  });
  it('accelerates from a standing-ish start gradually', () => {
    const w = arena([300, 760]); stepRollerFor(w, DT * 2); const v0 = w.roller.speed;
    stepRollerFor(w, 1); expect(w.roller.speed).toBeGreaterThan(v0); expect(w.roller.speed - v0).toBeLessThanOrEqual(R.ACCEL + 0.1);
  });
  it('stops at the finish line and never crosses it', () => {
    const w = arena([2500, 2800]); w.leaderS = 2800;
    for (let i = 0; i < 60 * 40 && !w.roller.ended; i++) { w.time += DT; w.cars.forEach((c) => { c.s = Math.max(c.s, w.roller.s + 100); }); stepRoller(w, DT); }
    expect(w.roller.ended).toBe(true); expect(w.roller.active).toBe(false);
    expect(w.roller.s).toBeGreaterThanOrEqual(track.finishS); expect(w.roller.s).toBeLessThan(track.finishS + 3);
  });
});

describe('flattening', () => {
  it('a car that stands still in its way is flattened: state, time, list, event, stats', () => {
    const w = arena([900, 1200]); w.cars[1].speed = 0; w.cars[1].s = 1200;
    w.cars[0].speed = 0;
    // freeze both cars (only the roller moves)
    stepRollerFor(w, 30);
    expect(w.cars[0].state).toBe('eliminated'); expect(w.cars[1].state).toBe('eliminated');
    expect(w.eliminated).toHaveLength(2);
    expect(w.cars[0].eliminatedAt).toBeLessThan(w.cars[1].eliminatedAt);                // the one further back goes first
    expect(w.events.filter((e) => e.type === 'flattened').map((e) => e.carId)).toEqual([0, 1]);
    expect(w.stats.flattened).toBe(2);
  });
  it('shield, invulnerability and turbo do not help; the car loses its item and everything', () => {
    const w = arena([900, 1500]);
    const c = w.cars[0]; c.shieldT = 5; c.invulnT = 5; c.turboT = 2; c.item = 'missile'; c.gunShotsLeft = 3; c.speed = 0;
    w.cars[1].speed = 0;
    stepRollerFor(w, 20);
    expect(c.state).toBe('eliminated'); expect(c.item).toBeNull(); expect(c.shieldT).toBe(0); expect(c.gunShotsLeft).toBe(0);
  });
  it('catches the whole width of the road: any lateral position', () => {
    for (const d of [-8, -3, 0, 3, 8]) {
      const w = arena([900, 1500]); w.cars[0].d = d; w.cars[0].speed = 0;
      stepRollerFor(w, 20);
      expect(w.cars[0].state, `d=${d}`).toBe('eliminated');
    }
  });
  it('does not touch cars that are finished, falling or respawning', () => {
    for (const state of ['finished', 'falling', 'respawning']) {
      const w = arena([900, 1500]); w.cars[0].state = state; w.cars[0].speed = 0;
      stepRollerFor(w, 20);
      expect(w.cars[0].state, state).toBe(state);
    }
  });
  it('an eliminated car never moves again and takes no part in collisions or items', () => {
    const c = createCar({ s: 500 }); c.state = 'eliminated'; c.speed = 20; c.vd = 3;
    stepCar(c, DT, track); expect(c.s).toBe(500); expect(c.speed).toBe(0);
    const w = arena([300, 301]); w.cars[0].state = 'eliminated'; w.cars[0].item = null;
    w.cars[1].item = 'missile'; useItem(w.cars[1], w);
    expect(w.entities.filter((e) => e.type === 'missile')[0].targetId).not.toBe(0);
  });
});

describe('respawning in front of the roller', () => {
  it('a car that comes back from a fall is put RESPAWN_AHEAD in front of the roller, not behind it', () => {
    const w = arena([900, 1200]); w.roller.active = true; w.roller.s = 880;
    const c = w.cars[0]; c.s = 700; c.lastCheckpointS = 640; c.justRespawned = true;
    placeAheadOfRoller(w, c);
    expect(c.s).toBeGreaterThanOrEqual(880 + R.RESPAWN_AHEAD);
    expect(c.d).toBe(0);
  });
  it('is not moved when it is already far enough ahead, or when the roller is not out', () => {
    const w = arena([900, 1200]); const c = w.cars[0];
    w.roller.active = true; w.roller.s = 600; c.s = 800; placeAheadOfRoller(w, c); expect(c.s).toBe(800);
    w.roller.active = false; c.s = 100; placeAheadOfRoller(w, c); expect(c.s).toBe(100);
  });
  it('never lands above a trench or on a ramp', () => {
    for (const r of track.ramps.filter((x) => x.gap)) {
      for (let s = r.s - r.len - 3; s <= r.gap.to + 10; s += 2) {
        const safe = track.safeSpawnS(s);
        expect(track.inGap(safe), `from ${s}`).toBe(false);
        expect(safe < r.s - r.len - 3 || safe > r.gap.to + 9, `from ${s} -> ${safe}`).toBe(true);
      }
    }
    expect(track.safeSpawnS(300)).toBe(300);
  });
  it('through the real world step: a car that fell in a trench in front of the roller comes back ahead of it', () => {
    const w = createWorld({ track, seed: 1, bots: 1, roller: true });
    const c = w.player; const ramp = track.ramps.find((r) => r.gap);
    w.roller.active = true; w.roller.startS = 0; w.roller.s = ramp.gap.from - 20; w.roller.speed = 30; w.leaderS = 1000;
    c.s = ramp.gap.from + 2; c.d = 0; c.speed = 8; c.input.speedMult = 0.25; c.lastCheckpointS = ramp.gap.from - 60;
    let back = null;
    for (let i = 0; i < 60 * 9; i++) { w.step(DT); if (c.justRespawned === false && c.respawns === 1 && back === null) back = { s: c.s, rs: w.roller.s }; }
    expect(c.respawns).toBeGreaterThanOrEqual(1);
    expect(back.s).toBeGreaterThanOrEqual(back.rs + R.RESPAWN_AHEAD - 1);
  });
});

describe('ranking and the end of the race', () => {
  it('flattened cars rank after everyone still racing; the one flattened later ranks higher', () => {
    const a = createCar({ id: 1, s: 900 }), b = createCar({ id: 2, s: 400 }), c = createCar({ id: 3, s: 600 }), d = createCar({ id: 4, s: 100 });
    c.finishTime = 90; b.state = 'eliminated'; b.eliminatedAt = 50; d.state = 'eliminated'; d.eliminatedAt = 70;
    const r = computeRanks([a, b, c, d]);
    expect(r.map((x) => x.id)).toEqual([3, 1, 4, 2]);
  });
  it('the race is over when everyone has finished or been flattened; finalOrder gives the places', () => {
    const w = createWorld({ track, seed: 1, roller: false });
    expect(w.done).toBe(false);
    const [p, a, b, c] = w.cars;
    for (const [car, t] of [[a, 80], [c, 85]]) { car.state = 'finished'; car.finishTime = t; w.finishOrder.push(car); }
    b.state = 'eliminated'; b.eliminatedAt = 40; w.eliminated.push(b);
    expect(w.done).toBe(false);
    p.state = 'eliminated'; p.eliminatedAt = 60; w.eliminated.push(p);
    expect(w.done).toBe(true);
    const order = w.finalOrder();
    expect(order.map((x) => x.id)).toEqual([a.id, c.id, p.id, b.id]);
    expect(order.map((x) => x.place)).toEqual([1, 2, 3, 4]);
  });
  it('if the player is flattened and someone is stuck, the safety net still ends the race', () => {
    const w = createWorld({ track, seed: 1, bots: 1, roller: false });
    w.player.state = 'eliminated'; w.player.eliminatedAt = 1; w.eliminated.push(w.player);
    const bot = w.cars[1]; w.brains.delete(bot); bot.input.speedMult = 0; bot.speed = 0;
    let n = 0; while (!w.done && n++ < 60 * 80) { bot.stuckT = 0; bot.s = Math.min(bot.s, 200); bot.speed = 0; w.step(DT); }
    expect(w.done).toBe(true); expect(w.time).toBeLessThan(75);
  });
});

describe('bots and the roller', () => {
  function botWorld(alert) {
    const w = createWorld({ track, seed: 2, bots: 1, roller: false });
    const bot = w.cars[1], brain = w.brains.get(bot);
    brain.alert = alert; bot.s = 800; bot.speed = 30; bot.turbosLeft = 2; bot.turboT = 0; brain.nextTurboAt = 99999;
    w.roller.active = true; w.roller.ended = false; w.roller.s = 800 - 50;
    return { w, bot, brain };
  }
  it('an alert bot uses a turbo at once when the roller is close, an oblivious one does not', () => {
    for (const [alert, expectTurbo] of [[true, true], [false, false]]) {
      const { w, bot, brain } = botWorld(alert);
      driveBot(bot, brain, w);
      expect(bot.input.turbo, `alert ${alert}`).toBe(expectTurbo);
    }
  });
  it('no panic turbo when the roller is far away', () => {
    const { w, bot, brain } = botWorld(true); w.roller.s = 800 - 200;
    driveBot(bot, brain, w); expect(bot.input.turbo).toBe(false);
  });
  it('keeps its shield when the roller is close (a shield does not stop it)', () => {
    const { w, bot, brain } = botWorld(true);
    w.roller.s = 800 - 40;                                              // inside the 50 m zone
    bot.item = 'shield'; brain.heldItem = 'shield'; brain.heldSince = -100; brain.useDelay = 0; w.time = 20; bot.rouletteT = 0;
    driveItems(bot, brain, w); expect(bot.input.item).toBe(false);
    w.roller.s = 800 - 200; driveItems(bot, brain, w); expect(bot.input.item).toBe(true);
  });
  it('a bot in front of the roller is never slowed by the rubber band', () => {
    const w = createWorld({ track, seed: 2, bots: 1, roller: false });
    const bot = w.cars[1]; w.player.s = 100; w.player.speed = 30; bot.s = 1000; bot.speed = 30;
    w.step(DT); const slowed = bot.input.speedMult;
    w.roller.active = true; w.roller.ended = false; w.roller.s = 950; w.roller.speed = 30; w.step(DT);
    expect(bot.input.speedMult).toBeGreaterThan(slowed);
  });
});

describe('mercy and tuning', () => {
  it('the roller eases off when the car it is about to catch is the player', () => {
    const w = arena([900, 1200]); w.roller.active = true; w.roller.startS = 800; w.roller.s = 880; w.roller.speed = 36; w.cars[0].s = 900; w.leaderS = 1200;
    const t = rollerTargetSpeed(w.roller, track.finishS);
    w.time += DT; stepRoller(w, DT);
    expect(w.roller.speed).toBeLessThan(36);                           // heading for the mercy speed (below the normal target)
    expect(t).toBeGreaterThan(CONFIG.car.CRUISE_SPEED);
  });
  it('the roller is faster than plain cruise speed (turbo recharging makes the real pace higher) but not absurdly', () => {
    expect(R.SPEED_START).toBeGreaterThan(1); expect(R.SPEED_END).toBeLessThan(1.4); expect(R.SPEED_END).toBeGreaterThanOrEqual(R.SPEED_START);
  });
});

describe('whole races (40, with the player proxy)', () => {
  it('everyone finishes or is flattened, the roller is a real threat, the careful player rarely loses', () => {
    let flattened = 0, races1 = 0, playerOut = 0, ended = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld({ track, seed, roller: true }); w.go(false);
      const brain = createBrain(createRng(seed + 1000), track);
      for (let i = 0; i < 60 * 200 && !w.done; i++) { drivePlayerProxy(w.player, brain, w); w.step(DT); }
      if (w.done) ended++;
      flattened += w.eliminated.length; if (w.eliminated.length) races1++; if (w.player.state === 'eliminated') playerOut++;
      expect(w.finishOrder.length + w.eliminated.length, `seed ${seed}`).toBe(4);
      for (const c of w.eliminated) expect(c.s, `seed ${seed}`).toBeLessThan(track.finishS);
    }
    expect(ended).toBe(40);
    expect(races1 / 40).toBeGreaterThanOrEqual(0.12);          // measured ~30 %
    expect(flattened / 40).toBeLessThanOrEqual(1.2);           // measured ~0.4 per race
    expect(playerOut / 40).toBeLessThanOrEqual(0.2);           // measured ~5 %
  }, 60000);
});
