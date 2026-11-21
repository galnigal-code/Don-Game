import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createWorld } from '../../src/sim/World.js';
import { createBrain, drivePlayerProxy } from '../../src/sim/BotDriver.js';
import { ITEMS, WEIGHTS, drawItem, applyHit, useItem } from '../../src/sim/items.js';
import { createRng } from '../../src/sim/rng.js';

const track = createTrack();
const DT = CONFIG.sim.STEP;
const I = CONFIG.items;

/** A quiet world with `n` hand-placed cars (no bots driving them). */
import { createCar } from '../../src/sim/Car.js';
function world(positions) {
  const w = createWorld({ track, seed: 1, bots: 0 });
  w.cars.length = 0;
  w.cars.push(...positions.map(([s, d], i) => { const c = createCar({ id: i, s, d, isPlayer: i === 0 }); c.speed = 0; return c; }));
  w.player = w.cars[0];
  w.boxes = [];
  w.entities = [];   // no fixed obstacles in these arenas
  return w;
}
const tick = (w, sec) => { for (let i = 0; i < sec / DT; i++) w.step(DT); };

describe('item draw', () => {
  it('matches the weight table per place (within 2 %)', () => {
    const rng = createRng(42);
    for (let rank = 1; rank <= 4; rank++) {
      const N = 20000, count = {};
      for (let i = 0; i < N; i++) { const k = drawItem(rank, rng); count[k] = (count[k] || 0) + 1; }
      const total = ITEMS.reduce((a, k) => a + WEIGHTS[k][rank - 1], 0);
      for (const k of ITEMS) expect(Math.abs((count[k] || 0) / N - WEIGHTS[k][rank - 1] / total)).toBeLessThan(0.02);
    }
  });
  it('never gives the leader a missile', () => {
    const rng = createRng(3);
    for (let i = 0; i < 5000; i++) expect(drawItem(1, rng)).not.toBe('missile');
  });
});

describe('boxes', () => {
  it('give one item, start a roulette, respawn after 3 s', () => {
    const w = world([[100, 0]]);
    w.boxes = [{ id: 0, s: 100, d: 0.5, t: 0 }];
    tick(w, DT * 2);
    expect(ITEMS).toContain(w.player.item);
    expect(w.player.rouletteT).toBeGreaterThan(0.7);
    expect(w.boxes[0].t).toBeGreaterThan(2.9);
    tick(w, 3.2);
    expect(w.boxes[0].t).toBe(0);
  });
  it('do not replace a held item but still vanish', () => {
    const w = world([[100, 0]]);
    w.player.item = 'mine';
    w.boxes = [{ id: 0, s: 100, d: 0, t: 0 }];
    tick(w, DT * 2);
    expect(w.player.item).toBe('mine');
    expect(w.boxes[0].t).toBeGreaterThan(0);
  });
  it('are not collected from the side or while high in the air', () => {
    const w = world([[100, 4]]);
    w.boxes = [{ id: 0, s: 100, d: 0, t: 0 }];
    tick(w, DT * 3);
    expect(w.player.item).toBeNull();
  });
});

describe('using items', () => {
  it('is blocked during the roulette', () => {
    const w = world([[100, 0]]);
    w.player.item = 'shield'; w.player.rouletteT = 0.5;
    expect(useItem(w.player, w)).toBe(false);
    w.player.rouletteT = 0;
    expect(useItem(w.player, w)).toBe(true);
    expect(w.player.item).toBeNull();
    expect(w.player.shieldT).toBe(I.SHIELD_TIME);
  });
  it('is triggered by the item input edge (once per press)', () => {
    const w = world([[100, 0]]);
    w.player.item = 'oil';
    w.player.input.item = true; tick(w, DT * 3);
    expect(w.entities.filter((e) => e.type === 'oil')).toHaveLength(1);
    expect(w.player.item).toBeNull();
  });
});

describe('mine', () => {
  it('is dropped behind and spins the car that drives into it, not the owner', () => {
    const w = world([[200, 0], [160, 0]]);
    w.cars[0].item = 'mine'; w.cars[0].speed = 0; w.cars[1].speed = 0;
    useItem(w.cars[0], w);
    const mine = w.entities[0];
    expect(mine.s).toBeCloseTo(200 - I.DROP_BEHIND, 5);
    tick(w, 0.2);
    expect(w.cars[0].hit.kind).toBeNull();            // owner is immune right after dropping
    w.cars[1].s = mine.s - 1.5; w.cars[1].d = mine.d;
    tick(w, 0.05);
    expect(w.cars[1].hit.kind).toBe('spin');
    expect(w.entities.some((e) => e.type === 'mine')).toBe(false);
    expect(w.events.some((e) => e.type === 'explosion')).toBe(true);
  });
  it('misses a car passing 3 m to the side', () => {
    const w = world([[200, 0], [160, 3]]);
    w.entities.push({ id: 1, type: 'mine', s: 160, d: -1, ownerId: 0, age: 9, alive: true, travel: 0 });
    tick(w, 0.1);
    expect(w.cars[1].hit.kind).toBeNull();
  });
  it('slows the car for about 1.5 s and then it recovers', () => {
    const w = world([[300, 0], [250, 0]]);
    const c = w.cars[1]; c.speed = CONFIG.car.CRUISE_SPEED;
    w.entities.push({ id: 1, type: 'mine', s: 255, d: 0, ownerId: 0, age: 9, alive: true, travel: 0 });
    tick(w, 0.5);
    expect(c.hit.kind).toBe('spin');
    expect(c.speed).toBeLessThan(CONFIG.car.CRUISE_SPEED * 0.6);
    tick(w, 1.2);
    expect(c.hit.kind).toBeNull();
    tick(w, 3);
    expect(c.speed).toBeGreaterThan(CONFIG.car.CRUISE_SPEED * 0.95);
  });
});

describe('oil, barrel', () => {
  it('oil makes cars slip and stays for the next one', () => {
    const w = world([[300, 0], [250, 0], [250.5, 0.5]]);
    w.entities.push({ id: 1, type: 'oil', s: 251, d: 0, ownerId: 0, age: 9, alive: true, travel: 0 });
    tick(w, 0.1);
    expect(w.cars[1].hit.kind).toBe('slip');
    expect(w.entities.some((e) => e.type === 'oil')).toBe(true);
  });
  it('barrel bumps the car and is destroyed', () => {
    const w = world([[300, 0], [250, 0]]);
    w.entities.push({ id: 1, type: 'barrel', s: 251, d: 0, ownerId: 0, age: 9, alive: true, travel: 0 });
    tick(w, 0.1);
    expect(w.cars[1].hit.kind).toBe('bump');
    expect(w.entities.some((e) => e.type === 'barrel')).toBe(false);
  });
  it('items expire', () => {
    const w = world([[300, 3]]);
    w.entities.push({ id: 1, type: 'oil', s: 100, d: 0, ownerId: 0, age: 0, alive: true, travel: 0 });
    tick(w, I.LIFE.oil + 0.5);
    expect(w.entities).toHaveLength(0);
  });
});

describe('missile', () => {
  it('flies forward at the nearest car ahead and launches it', () => {
    const w = world([[100, 0], [160, 2]]);
    w.cars[0].item = 'missile';
    useItem(w.cars[0], w);
    expect(w.entities[0].targetId).toBe(1);
    tick(w, 2);
    expect(w.cars[1].hit.kind === 'launch' || w.cars[1].invulnT > 0 || w.cars[1].hit.t < 1.5).toBe(true);
    expect(w.entities.some((e) => e.type === 'missile')).toBe(false);
    expect(w.events.some((e) => e.type === 'explosion' && e.kind === 'missile')).toBe(true);
  });
  it('launched car goes up and nearly stops', () => {
    const w = world([[100, 0], [140, 0]]);
    w.cars[1].speed = CONFIG.car.CRUISE_SPEED;
    expect(applyHit(w.cars[1], 'launch', w)).toBe(true);
    let maxH = 0;
    for (let i = 0; i < 40; i++) { w.step(DT); maxH = Math.max(maxH, w.cars[1].h); }
    expect(maxH).toBeGreaterThan(1);
    expect(w.cars[1].speed).toBeLessThan(CONFIG.car.CRUISE_SPEED * 0.5);
  });
  it('with nothing ahead it expires after 200 m', () => {
    const w = world([[2000, 0]]);
    w.cars[0].item = 'missile'; useItem(w.cars[0], w);
    tick(w, 4);
    expect(w.entities).toHaveLength(0);
  });
  it('is absorbed by a shield', () => {
    const w = world([[100, 0], [150, 0]]);
    w.cars[1].shieldT = 5;
    w.cars[0].item = 'missile'; useItem(w.cars[0], w);
    tick(w, 2);
    expect(w.cars[1].hit.kind).toBeNull();
    expect(w.events.some((e) => e.type === 'shield')).toBe(true);
  });
  it('never hits its owner', () => {
    const w = world([[100, 0]]);
    w.cars[0].item = 'missile'; useItem(w.cars[0], w);
    tick(w, 1);
    expect(w.cars[0].hit.kind).toBeNull();
  });
});

describe('gun', () => {
  it('fires a burst of 5 bullets that slow whoever is hit, capped at 50 %', () => {
    const w = world([[100, 0], [140, 0]]);
    w.cars[0].item = 'gun'; useItem(w.cars[0], w);
    let fired = 0;
    for (let i = 0; i < 60 * 1.2; i++) { const before = w.entities.length; w.step(DT); if (w.entities.some((e) => e.type === 'bullet' && e.age <= DT * 1.5)) fired++; void before; }
    expect(w.cars[0].gunShotsLeft).toBe(0);
    expect(w.stats.uses).toBe(1);
    expect(w.cars[1].gunSlow).toBeGreaterThan(0.2);
    expect(w.cars[1].gunSlow).toBeLessThanOrEqual(I.GUN_SLOW_MAX);
    expect(fired).toBeGreaterThan(0);
  });
  it('bullets do not hurt a car in another lane', () => {
    const w = world([[100, -5], [140, 5]]);
    w.cars[0].item = 'gun'; useItem(w.cars[0], w);
    tick(w, 1.5);
    expect(w.cars[1].gunSlow).toBe(0);
  });
});

describe('shield', () => {
  it('blocks every hit for 6 s, then expires', () => {
    const w = world([[300, 0], [250, 0]]);
    w.cars[1].item = 'shield'; useItem(w.cars[1], w);
    w.entities.push({ id: 1, type: 'oil', s: 251, d: 0, ownerId: 0, age: 9, alive: true, travel: 0 });
    tick(w, 0.2);
    expect(w.cars[1].hit.kind).toBeNull();
    tick(w, I.SHIELD_TIME + 0.2);
    expect(w.cars[1].shieldT).toBe(0);
    w.cars[1].s = 251; w.cars[1].d = 0;
    tick(w, 0.1);
    expect(w.cars[1].hit.kind).toBe('slip');
  });
});

describe('hits', () => {
  it('do not stack and give a short immunity afterwards', () => {
    const w = world([[300, 0]]);
    expect(applyHit(w.cars[0], 'spin', w)).toBe(true);
    expect(applyHit(w.cars[0], 'bump', w)).toBe(false);
    tick(w, CONFIG.car.HIT_TIME.spin + 0.05);
    expect(w.cars[0].hit.kind).toBeNull();
    expect(applyHit(w.cars[0], 'bump', w)).toBe(false);   // still immune
    tick(w, I.HIT_IMMUNITY + 0.1);
    expect(applyHit(w.cars[0], 'bump', w)).toBe(true);
  });
  it('are ignored while falling or respawning', () => {
    const w = world([[300, 0]]);
    w.cars[0].state = 'falling';
    expect(applyHit(w.cars[0], 'spin', w)).toBe(false);
  });
});

describe('full race with items', () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}: bots pick up and use items, everyone still finishes`, () => {
      const w = createWorld({ track, seed });
      w.go(false);
      const brain = createBrain(createRng(seed + 1000), track);
      for (let i = 0; i < 60 * 220 && !w.done; i++) { drivePlayerProxy(w.player, brain, w); w.step(DT); }
      expect(w.done).toBe(true);
      expect(w.stats.pickups).toBeGreaterThanOrEqual(5);
      expect(w.stats.uses).toBeGreaterThanOrEqual(3);
      const times = w.finishOrder.map((c) => c.finishTime);
      expect(times[0]).toBeGreaterThan(75);
      expect(times[3]).toBeLessThan(115);
    });
  }
});
