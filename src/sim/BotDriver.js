// Drivers. driveSimple: centre-line follower (used for ?autopilot=1 and tests).
// createBrain/driveBot: the opponents (racing line, personal offset, wobble, turbo timing, rubber band input).
import { CONFIG } from '../config.js';

const C = CONFIG.car;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const S1 = {}, S2 = {};

function steerTowards(car, track, target, here) {
  const look = Math.max(10, car.speed * 0.7);
  const ff = here.curvature * car.speed * C.DRIFT_K;
  const desiredYaw = clamp(Math.atan2(target - car.d, look) * 1.2 + ff, -C.MAX_YAW * 0.8, C.MAX_YAW * 0.8);
  const sf = clamp(car.speed / C.CRUISE_SPEED, 0.25, 1);
  return clamp(desiredYaw * (C.YAW_RETURN / C.STEER_RATE) / sf + (desiredYaw - car.yaw) * 2, -1, 1);
}

export function driveSimple(car, track, offset = 0) {
  const here = track.sample(car.s, S1);
  car.input.steer = steerTowards(car, track, clamp(offset, -here.halfWidth + 2, here.halfWidth - 2), here);
}

export function createBrain(rng, track) {
  const L = track.finishS;
  return {
    offset: (rng() - 0.5) * 4,                       // personal line, +-2 m
    noisePhase: rng() * Math.PI * 2, noiseFreq: 0.35 + rng() * 0.25,
    skill: 0.975 + rng() * 0.02,                     // 97.5-99.5 % of the player pace (rubber band closes the gap)
    turboAt: [0.2 * L + (rng() - 0.5) * 300, 0.5 * L + (rng() - 0.5) * 300],
    turboUsed: 0,
    startBoost: rng() < 0.4,
    dodge: new Map(),                 // entity id -> will this bot avoid it? (decided once, DODGE_SUCCESS)
    heldItem: null, heldSince: 0, useDelay: 0.4 + rng() * 0.8,
  };
}

/** Sets car.input for one step. `world` provides track, time, cars. */
export function driveBot(car, brain, world) {
  const track = world.track;
  const here = track.sample(car.s, S1);
  const look = Math.max(10, car.speed * 0.6);
  let k = 0;
  for (let i = 0; i < 4; i++) k += track.sample(car.s + look + i * 10, S2).curvature;
  k /= 4;
  const hw = here.halfWidth;
  let target = clamp(k * 45, -0.6, 0.6) * (hw - 2) + brain.offset
    + Math.sin(world.time * brain.noiseFreq + brain.noisePhase) * 1.2;
  const ahead = track.sample(car.s + look, S2);
  target = clamp(avoidAndCollect(car, brain, world, target), -hw + 1.5, hw - 1.5);
  const limL = ahead.edgeLeft === 'cliff' ? hw - 3.5 : hw - 2;
  const limR = ahead.edgeRight === 'cliff' ? hw - 3.5 : hw - 2;
  target = clamp(target, -limL, limR);
  car.input.steer = steerTowards(car, track, target, here);

  driveItems(car, brain, world);

  // turbo: planned spots, or earlier when far behind
  car.input.turbo = false;
  if (car.state === 'driving' && brain.turboUsed < C.TURBOS_PER_RACE && car.turbosLeft > 0 && car.turboT <= 0) {
    const planned = car.s >= brain.turboAt[brain.turboUsed];
    const behind = car.rank === world.cars.length && car.s > 200 && world.leaderS - car.s > 60;
    if (planned || behind) { car.input.turbo = true; brain.turboUsed++; }
  }
}


const HARMFUL = new Set(['mine', 'oil', 'barrel', 'rock']);

/** Aim at an item box when empty-handed, steer around traps (most of the time). */
export function avoidAndCollect(car, brain, world, target) {
  if (!car.item && car.rouletteT <= 0) {
    let best = null;
    for (const b of world.boxes) {
      if (b.t > 0 || b.s < car.s + 8 || b.s > car.s + 60) continue;
      if (!best || b.s < best.s - 1 || (Math.abs(b.s - best.s) <= 1 && Math.abs(b.d - car.d) < Math.abs(best.d - car.d))) best = b;
    }
    if (best) target = best.d;
  }
  for (const e of world.entities) {
    if (!HARMFUL.has(e.type) || !e.alive) continue;
    if (e.ownerId === car.id && e.age < CONFIG.items.OWN_DROP_IMMUNITY) continue;
    if (e.s < car.s + 6 || e.s > car.s + 45 || Math.abs(e.d - car.d) > 2.8) continue;
    let avoid = brain.dodge.get(e.id);
    if (avoid === undefined) { avoid = world.rng() < CONFIG.bots.DODGE_SUCCESS; brain.dodge.set(e.id, avoid); }
    if (avoid) target = e.d + (car.d >= e.d ? 3.2 : -3.2);
  }
  return target;
}

/** Decide whether to use the held item this step (sets car.input.item for one step). */
export function driveItems(car, brain, world) {
  car.input.item = false;
  if (car.item !== brain.heldItem) { brain.heldItem = car.item; brain.heldSince = world.time; }
  if (!car.item || car.rouletteT > 0 || car.state !== 'driving') return;
  const held = world.time - brain.heldSince;
  if (held < brain.useDelay) return;

  let ahead = null, behind = null;
  for (const c of world.cars) {
    if (c === car || c.state !== 'driving') continue;
    const ds = c.s - car.s;
    if (ds > 10 && ds < 80 && (!ahead || ds < ahead.s - car.s)) ahead = c;
    if (ds < -5 && ds > -40 && (!behind || -ds < car.s - behind.s)) behind = c;
  }
  let use = false;
  switch (car.item) {
    case 'missile': use = !!ahead; break;
    case 'gun': use = !!ahead && Math.abs(ahead.d - car.d) < 2; break;
    case 'mine': case 'oil': case 'barrel': use = !!behind || held > 8; break;
    case 'shield': {
      const incoming = world.entities.some((e) => e.type === 'missile' && e.alive && e.ownerId !== car.id
        && e.s < car.s && car.s - e.s < 60 && (e.targetId === car.id || Math.abs(e.d - car.d) < 4));
      use = incoming || held > 10;
      break;
    }
  }
  if (use) car.input.item = true;
}

/** A sensible human-like driver for the player (?autopilot=1, balance tests): dodges, grabs boxes, uses items. */
export function drivePlayerProxy(car, brain, world) {
  driveSimple(car, world.track, avoidAndCollect(car, brain, world, 0));
  driveItems(car, brain, world);
}
