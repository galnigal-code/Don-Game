// Moving / lying item entities: mines, oil, barrels, missiles, bullets. Pure logic.
import { CONFIG } from '../config.js';
import { applyHit } from './items.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function stepEntities(world, dt) {
  const I = CONFIG.items, { cars, track } = world;
  for (const e of world.entities) {
    if (!e.alive) continue;
    e.age += dt;

    // movement & lifetime
    if (e.fixed) {
      // fixed obstacles never expire
    } else if (e.type === 'mine' || e.type === 'oil' || e.type === 'barrel') {
      if (e.age > I.LIFE[e.type]) e.alive = false;
    } else if (e.type === 'missile') {
      const target = e.targetId != null ? cars.find((c) => c.id === e.targetId && (c.route || 0) === (e.route || 0)) : null;
      if (target && target.state === 'driving') e.d += clamp(target.d - e.d, -I.MISSILE_TURN * dt, I.MISSILE_TURN * dt);
      e.s += I.MISSILE_SPEED * dt; e.travel += I.MISSILE_SPEED * dt;
      const tracking = target && target.state === 'driving';
      if ((!tracking && e.travel > I.MISSILE_RANGE_NO_TARGET) || e.travel > I.MISSILE_RANGE_MAX || e.s > track.maxS) {
        e.alive = false; world.events.push({ type: 'explosion', s: e.s, d: e.d, kind: 'missile', route: e.route || 0 });
      }
    } else if (e.type === 'bullet') {
      e.s += I.BULLET_SPEED * dt; e.travel += I.BULLET_SPEED * dt;
      if (e.travel > I.BULLET_RANGE || e.s > track.maxS) e.alive = false;
    }
    if (!e.alive) continue;

    // hits
    const reach = I.REACH[e.type];
    const A = CONFIG.race.COLLIDE_A + reach, B = CONFIG.race.COLLIDE_B + reach;
    for (const car of cars) {
      if (car.id === e.ownerId && (e.type === 'missile' || e.type === 'bullet' || e.age < I.OWN_DROP_IMMUNITY)) continue;
      if (car.state !== 'driving' || car.owner === 'remote' || (car.route || 0) !== (e.route || 0)) continue;    // online: each phone only hits ITS cars
      const ds = (e.s - car.s) / A, dd = (e.d - car.d) / B;
      if (ds * ds + dd * dd >= 1) continue;

      // oil and rocks stay and can catch many cars
      if (e.type === 'oil') { applyHit(car, 'slip', world); continue; }
      if (e.type === 'rock') { applyHit(car, 'bump', world); continue; }
      if (e.type === 'bullet') {
        if (car.invulnT > 0) continue;
        if (car.shieldT > 0) world.events.push({ type: 'shield', carId: car.id });
        else car.gunSlow = Math.min(I.GUN_SLOW_MAX, car.gunSlow + I.GUN_SLOW_PER_HIT);
        e.alive = false; break;
      }
      const kind = e.type === 'mine' ? 'spin' : e.type === 'barrel' ? 'bump' : 'launch';
      if (applyHit(car, kind, world)) {
        e.alive = false;
        if (world.online) world.netOut?.push({ k: 'ehit', e: e.id });
        world.events.push({ type: 'explosion', s: e.s, d: e.d, kind: e.type, route: e.route || 0 });
        break;
      }
    }
  }
  if (world.entities.length && world.entities.some((e) => !e.alive)) world.entities = world.entities.filter((e) => e.alive);
}
