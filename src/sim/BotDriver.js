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
  const limL = ahead.edgeLeft === 'cliff' ? hw - 3.5 : hw - 2;
  const limR = ahead.edgeRight === 'cliff' ? hw - 3.5 : hw - 2;
  target = clamp(target, -limL, limR);
  car.input.steer = steerTowards(car, track, target, here);

  // turbo: planned spots, or earlier when far behind
  car.input.turbo = false;
  if (car.state === 'driving' && brain.turboUsed < C.TURBOS_PER_RACE && car.turbosLeft > 0 && car.turboT <= 0) {
    const planned = car.s >= brain.turboAt[brain.turboUsed];
    const behind = car.rank === world.cars.length && car.s > 200 && world.leaderS - car.s > 60;
    if (planned || behind) { car.input.turbo = true; brain.turboUsed++; }
  }
}
