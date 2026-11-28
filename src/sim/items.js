// Items: random draw by race position, using an item, hit effects. Pure logic.
import { CONFIG } from '../config.js';

export const ITEMS = ['mine', 'oil', 'barrel', 'shield', 'gun', 'missile'];

// weights by place: [1st, 2nd, 3rd, 4th]. Leaders get traps, stragglers get missiles.
export const WEIGHTS = {
  mine: [30, 20, 12, 8], oil: [25, 18, 12, 8], barrel: [20, 15, 10, 6],
  shield: [15, 15, 14, 12], gun: [10, 20, 24, 26], missile: [0, 12, 28, 40],
};

/** Entity ids are unique across phones online ("<carId>.<n>"), plain counters offline. */
export function newEntityId(world, car) { const n = ++world.entityId; return world.online ? `${car.id}.${n}` : n; }

export function drawItem(rank, rng) {
  const r = Math.min(4, Math.max(1, rank)) - 1;
  let total = 0;
  for (const k of ITEMS) total += WEIGHTS[k][r];
  let x = rng() * total;
  for (const k of ITEMS) { x -= WEIGHTS[k][r]; if (x < 0) return k; }
  return 'mine';
}

/**
 * Try to hit a car. Returns true (applied), 'shield' (absorbed by a shield) or false (ignored).
 * Cars that are already hit, invulnerable, falling, respawning or finished are ignored.
 */
export function applyHit(car, kind, world) {
  if (car.owner === 'remote') return false;      // online: the phone that owns the car decides if it was hit
  if (car.state !== 'driving' || car.invulnT > 0 || car.hit.kind) return false;
  if (car.shieldT > 0) { world.events.push({ type: 'shield', carId: car.id }); return 'shield'; }
  car.hit.kind = kind;
  car.hit.t = CONFIG.car.HIT_TIME[kind];
  if (kind === 'launch') car.vy = CONFIG.items.LAUNCH_VY;
  world.stats.hits++;
  world.events.push({ type: 'hit', carId: car.id, kind });
  return true;
}

function nearestAhead(car, cars) {
  let best = null;
  for (const c of cars) {
    if (c === car || c.state === 'finished' || c.state === 'eliminated' || c.s <= car.s || (c.route || 0) !== (car.route || 0)) continue;
    if (!best || c.s < best.s) best = c;
  }
  return best;
}

/** Use the held item (needs the roulette to be over). */
export function useItem(car, world) {
  if (!car.item || car.rouletteT > 0 || car.state !== 'driving') return false;
  const it = car.item, I = CONFIG.items;
  car.item = null;
  const base = { id: newEntityId(world, car), ownerId: car.id, age: 0, alive: true, travel: 0, route: car.route || 0 };
  switch (it) {
    case 'mine': case 'oil': case 'barrel':
      world.entities.push({ ...base, type: it, s: car.s - I.DROP_BEHIND, d: car.d });
      break;
    case 'missile': {
      const t = nearestAhead(car, world.cars);
      world.entities.push({ ...base, type: 'missile', s: car.s + 3, d: car.d, targetId: t ? t.id : null });
      break;
    }
    case 'gun': car.gunShotsLeft = I.GUN_SHOTS; car.gunCooldown = 0; world.netOut?.push({ k: 'gun', c: car.id }); break;
    case 'shield': car.shieldT = I.SHIELD_TIME; break;
  }
  if (world.online && world.netOut && it !== 'gun' && it !== 'shield') {
    const e = world.entities[world.entities.length - 1];
    world.netOut.push({ k: it, id: e.id, c: car.id, s: e.s, d: e.d, tg: e.targetId ?? -1, r: e.route || 0 });
  }
  world.stats.uses++;
  world.events.push({ type: 'use', carId: car.id, item: it });
  return true;
}

/** Guns fire a burst of bullets straight ahead. */
export function stepGun(car, world, dt) {
  if (car.gunShotsLeft <= 0) return;
  if (car.state === 'falling' || car.state === 'respawning' || car.state === 'eliminated') { car.gunShotsLeft = 0; return; }
  car.gunCooldown -= dt;
  if (car.gunCooldown > 0) return;
  car.gunShotsLeft--; car.gunCooldown = CONFIG.items.GUN_INTERVAL;
  world.entities.push({ id: newEntityId(world, car), type: 'bullet', ownerId: car.id, age: 0, alive: true, travel: 0, route: car.route || 0, s: car.s + 2, d: car.d });
}

/** Item boxes: collect when driving through; the box respawns after a few seconds. (Layout: boxLayout.js) */
export function stepBoxes(world, dt) {
  const I = CONFIG.items;
  for (const b of world.boxes) {
    if (b.t > 0) { b.t = Math.max(0, b.t - dt); continue; }
    for (const car of world.cars) {
      if (car.owner === 'remote' || (car.route || 0) !== (b.route || 0)) continue;           // online: the box vanishes when the room confirms that car took it; a box belongs to one route
      if (car.state !== 'driving' || car.h > I.BOX_MAX_H) continue;
      if (Math.abs(b.s - car.s) >= I.BOX_REACH_S || Math.abs(b.d - car.d) >= I.BOX_REACH_D) continue;
      b.t = I.BOX_RESPAWN;
      if (!car.item && car.rouletteT <= 0) {
        car.item = drawItem(car.rank, world.rng);
        car.rouletteT = I.ROULETTE_TIME;
        world.stats.pickups++;
        world.events.push({ type: 'pickup', carId: car.id, boxId: b.id });
      }
      break;
    }
  }
}
