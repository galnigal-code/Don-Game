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
  const here = track.sample(car.s, S1, car.route);
  car.input.steer = steerTowards(car, track, clamp(offset, -here.halfWidth + 2, here.halfWidth - 2), here);
}

export function createBrain(rng, track, lane = null) {
  const L = track.finishS;
  const brain = {
    // personal line: bots spread over three lanes (about 4 m apart) so that bots running side by side do not touch
    offset: lane === null ? (rng() - 0.5) * 4 : (lane - 1) * 4 + (rng() - 0.5),
    noisePhase: rng() * Math.PI * 2, noiseFreq: 0.35 + rng() * 0.25,
    skill: 0.975 + rng() * 0.02,                     // 97.5-99.5 % of the player pace (rubber band closes the gap)
    nextTurboAt: 0.08 * L + rng() * 250,             // next spot where this bot wants to use a turbo
    startBoost: rng() < 0.4,
    rng, wants: new Map(), smart: false,       // which branches this bot takes (decided per lap); a few bots know about the secret door
    dodge: new Map(),                 // entity id -> will this bot avoid it? (decided once, DODGE_SUCCESS)
    aggression: 0.2 + rng() * 0.5,    // how often it leans into a car next to it
    nudgeUntil: 0, nudgeCar: null, overtakeSkill: new Map(),
    alert: rng() < 0.5,                // does this bot notice the roller and use a turbo to flee? (the player gets warnings, so the proxy always does)
    heldItem: null, heldSince: 0, useDelay: 0.4 + rng() * 0.8,
  };
  brain.smart = Math.floor(brain.noisePhase * 977) % 10 === 0;      // derived (no extra random number: the desert races stay as they were)
  return brain;
}

/** Sets car.input for one step. `world` provides track, time, cars. */
export function driveBot(car, brain, world) {
  const track = world.track;
  const here = track.sample(car.s, S1, car.route);
  const look = Math.max(10, car.speed * 0.6);
  let k = 0;
  for (let i = 0; i < 4; i++) k += track.sample(car.s + look + i * 10, S2, car.route).curvature;
  k /= 4;
  const hw = here.halfWidth;
  const bf = Math.min(1, (hw - 1.5) / 7.5);                      // narrow roads (alleys, elevated tracks): smaller personal offset and wobble
  let target = clamp(k * 45, -0.6, 0.6) * (hw - 2) + brain.offset * bf
    + Math.sin(world.time * brain.noiseFreq + brain.noisePhase) * 1.2 * bf;
  const ahead = track.sample(car.s + look, S2, car.route);
  target = clamp(avoidAndCollect(car, brain, world, target), -hw + 1.5, hw - 1.5);
  target = overtake(car, brain, world, target, here, hw);
  target = nudge(car, brain, world, target, here, hw);
  const limL = ahead.edgeLeft === 'cliff' ? hw - 3.5 : hw - 2;
  const limR = ahead.edgeRight === 'cliff' ? hw - 3.5 : hw - 2;
  target = clamp(branchPlan(car, brain, world, target), -limL, limR);
  car.input.steer = steerTowards(car, track, target, here);

  driveItems(car, brain, world);

  driveTurbo(car, brain, world);
}


/**
 * Overtake instead of driving into the back of a slower car: pass on the side with more room (away from the nearer edge).
 * Each bot skips this for a given car with probability 1 - OVERTAKE_SKILL, so contact still happens now and then.
 */
function overtake(car, brain, world, target, here, hw) {
  let ahead = null;
  for (const c of world.cars) {
    if (c === car || c.state !== 'driving' || (c.route || 0) !== (car.route || 0)) continue;
    const ds = c.s - car.s;
    if (ds > 1 && ds < CONFIG.bots.OVERTAKE_DIST && Math.abs(c.d - car.d) < 2.9 && c.speed < car.speed + 4 && (!ahead || ds < ahead.s - car.s)) ahead = c;
  }
  if (!ahead) return target;
  let skilled = brain.overtakeSkill.get(ahead.id);
  if (skilled === undefined) { skilled = world.rng() < CONFIG.bots.OVERTAKE_SKILL; brain.overtakeSkill.set(ahead.id, skilled); }
  if (!skilled) return target;
  // pass on the side with more room; never towards a cliff edge
  let side = ahead.d > 0 ? -1 : 1;
  if ((side < 0 && here.edgeLeft === 'cliff') || (side > 0 && here.edgeRight === 'cliff')) side = -side;
  return clamp(ahead.d + side * 3.2, -hw + 1.8, hw - 1.8);
}

/** Now and then lean into a car that is right beside us (never near a cliff edge: bots do not push each other off). */
function nudge(car, brain, world, target, here, hw) {
  if (world.time < brain.nudgeUntil && brain.nudgeCar && brain.nudgeCar.state === 'driving') return clamp(brain.nudgeCar.d, -hw + 1.5, hw - 1.5);
  if (here.edgeLeft === 'cliff' || here.edgeRight === 'cliff' || car.state !== 'driving') return target;
  for (const c of world.cars) {
    if (c === car || c.state !== 'driving' || (c.route || 0) !== (car.route || 0)) continue;
    const gapD = Math.abs(c.d - car.d);
    if (Math.abs(c.s - car.s) < 3 && gapD > 1.5 && gapD < 4.5) {
      if (world.rng() < brain.aggression * CONFIG.bots.NUDGE_RATE / 60) { brain.nudgeUntil = world.time + CONFIG.bots.NUDGE_TIME; brain.nudgeCar = c; }
      break;
    }
  }
  return target;
}

/** Use a turbo when one is charged: at planned spots along the track, or right away when far behind. */
export function driveTurbo(car, brain, world, alert = brain.alert) {
  car.input.turbo = false;
  if (car.state !== 'driving' || car.turbosLeft <= 0 || car.turboT > 0) return;
  const panic = world.roller.active && car.s - world.roller.s < CONFIG.roller.TURBO_PANIC_DIST;      // the roller is close: use it now
  if (panic && alert) { car.input.turbo = true; return; }
  const behind = car.rank === world.cars.length && car.s > 200 && world.leaderS - car.s > 60;
  if (car.s >= brain.nextTurboAt || behind) {
    car.input.turbo = true;
    brain.nextTurboAt = car.s + 200 + world.rng() * 250;
  }
}

const HARMFUL = new Set(['mine', 'oil', 'barrel', 'rock']);

/**
 * Branches (alleys, elevated tracks, the secret door): before each entry, decide ONCE per lap whether to take it. To take it, aim at the
 * middle of its entry window; to skip it, keep clear of the window (a car inside the window is carried onto the branch).
 */
const TAKE = { alley: 0.6, elevated: 0.5, neo: 0.45, secret: 0 };
export function branchPlan(car, brain, world, target) {
  const track = world.track;
  if (car.route !== 0 || !track.branches.length || car.state !== 'driving') return target;
  const L = track.lapLength, lap = Math.floor(car.s / L), sl = car.s - lap * L;
  for (const br of track.branches) {
    if (sl < br.sa - 95 || sl > br.sa + 1) continue;
    const key = lap * 16 + br.index;
    let want = brain.wants.get(key);
    if (want === undefined) { want = brain.rng() < (br.kind === 'secret' ? (brain.smart ? 0.5 : 0) : TAKE[br.kind] ?? 0.4); brain.wants.set(key, want); }
    if (want) return clamp(br.entryCenter, br.entry[0] + 0.8, br.entry[1] - 0.8);
    if (target > br.entry[0] - 2.2 && target < br.entry[1] + 2.2) return br.entryCenter > 0 ? br.entry[0] - 3 : br.entry[1] + 3;
  }
  return target;
}

/** Aim at an item box when empty-handed, steer around traps (most of the time). */
export function avoidAndCollect(car, brain, world, target) {
  if (!car.item && car.rouletteT <= 0) {
    let best = null;
    for (const b of world.boxes) {
      if (b.t > 0 || (b.route || 0) !== (car.route || 0) || b.s < car.s + 8 || b.s > car.s + 60) continue;
      if (Math.abs(b.d - car.d) > (b.s - car.s) * 0.35 + 1) continue;      // cannot steer there in time: take the next one
      if (!best || b.s < best.s) best = b;
    }
    if (best) target = best.d;
  }
  for (const e of world.entities) {
    if (!HARMFUL.has(e.type) || !e.alive || (e.route || 0) !== (car.route || 0)) continue;
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
    if (c === car || c.state !== 'driving' || (c.route || 0) !== (car.route || 0)) continue;
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
      if (world.roller.active && car.s - world.roller.s < 50) return;       // a shield does not stop the roller: keep it
      const incoming = world.entities.some((e) => e.type === 'missile' && e.alive && e.ownerId !== car.id
        && e.s < car.s && car.s - e.s < 60 && (e.targetId === car.id || Math.abs(e.d - car.d) < 4));
      use = incoming || held > 10;
      break;
    }
  }
  if (use) car.input.item = true;
}

/** A sensible human-like driver for the player (?autopilot=1, balance tests): dodges, grabs boxes, uses items. */
export function drivePlayerProxy(car, brain, world, { turbo = true } = {}) {
  driveSimple(car, world.track, branchPlan(car, brain, world, avoidAndCollect(car, brain, world, 0)));
  driveItems(car, brain, world);
  if (turbo) driveTurbo(car, brain, world, true); else car.input.turbo = false;
}
