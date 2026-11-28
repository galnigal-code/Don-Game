// The giant roller (V2-C). Pure logic.
// It starts behind the pack when the leader passes 25 % of the track, drives a little slower than cruise speed
// (so a car that keeps driving is never caught, but slowed / fallen / stuck cars are), covers the WHOLE road width
// and flattens every car it reaches: that car leaves the race.
import { CONFIG } from '../config.js';

const R = CONFIG.roller;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createRoller() {
  return { active: false, ended: false, s: 0, speed: 0, startS: 0, startedAt: null };
}

/** Speed the roller wants at position s (m/s): from SPEED_START to SPEED_END of cruise speed, along the rest of the track. */
export function rollerTargetSpeed(roller, finishS) {
  const k = clamp((roller.s - roller.startS) / Math.max(1, finishS - roller.startS), 0, 1);
  return CONFIG.car.CRUISE_SPEED * (R.SPEED_START + (R.SPEED_END - R.SPEED_START) * k);
}

/** Cars the roller can still catch. */
const racing = (c) => c.state === 'driving' || c.state === 'falling' || c.state === 'respawning';

export function stepRoller(world, dt) {
  const roller = world.roller, track = world.track;
  if (roller.ended) return;
  if (!roller.active) {
    if (world.leaderS < R.START_FRACTION * track.finishS) return;
    const behind = world.cars.filter(racing);
    if (!behind.length) return;
    roller.active = true; roller.startedAt = world.time;
    roller.s = Math.min(...behind.map((c) => c.s)) - R.SPAWN_BEHIND;
    roller.startS = roller.s;
    roller.speed = CONFIG.car.CRUISE_SPEED * R.START_SPEED_FRAC;
    world.events.push({ type: 'roller-start', s: roller.s });
    return;
  }
  let target = rollerTargetSpeed(roller, track.finishS);
  // mercy for the human: when the player is the car the roller is about to catch, it eases off a little (more time to react)
  const p = world.player;
  if (p.state === 'driving' && p.s - roller.s < R.MERCY_DIST && !world.cars.some((c) => c !== p && c.state === 'driving' && c.s < p.s && c.s > roller.s)) target *= R.MERCY_FACTOR;
  roller.speed += clamp(target - roller.speed, -R.ACCEL * dt, R.ACCEL * dt);
  roller.s += roller.speed * dt;
  if (roller.s >= track.finishS) { roller.active = false; roller.ended = true; return; }   // it never crosses the finish line

  // flatten whatever it reaches (shield, invulnerability and turbo do not help)
  for (const car of world.cars) {
    if (car.state !== 'driving') continue;
    if (car.s - CONFIG.race.COLLIDE_A <= roller.s + R.REACH) {
      car.state = 'eliminated'; car.eliminatedAt = world.time; car.speed = 0; car.vd = 0; car.vy = 0; car.turboT = 0; car.shieldT = 0;
      car.item = null; car.gunShotsLeft = 0;
      world.eliminated.push(car);
      world.stats.flattened = (world.stats.flattened || 0) + 1;
      world.events.push({ type: 'flattened', carId: car.id, s: car.s, d: car.d, route: car.route || 0 });
    }
  }
}

/** A car that respawns near / behind the roller is put in front of it. */
export function placeAheadOfRoller(world, car) {
  const roller = world.roller;
  if (!roller.active) return;
  const minS = roller.s + R.RESPAWN_AHEAD;
  if (car.s < minS) { car.s = world.track.safeSpawnS(minS); car.d = 0; car.lastCheckpointS = Math.max(car.lastCheckpointS, car.s); }
}
