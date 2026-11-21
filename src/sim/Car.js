// Arcade car physics in track space. Pure logic, no three.js.
import { CONFIG } from '../config.js';

const C = CONFIG.car;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const S = {}; // scratch track sample

export function createCar({ id = 0, name = 'Player', color = 0xd0201c, isPlayer = false, s = 0, d = 0 } = {}) {
  return {
    id, name, color, isPlayer,
    s, d, h: 0, vy: 0, yaw: 0, speed: 0, steer: 0,
    input: { steer: 0, turbo: false, item: false },
    prevTurboInput: false, turbosLeft: C.TURBOS_PER_RACE, turboT: 0, boostT: 0, collideCooldown: 0, rank: 0,
    item: null, gunShotsLeft: 0, gunCooldown: 0, shieldT: 0,
    hit: { kind: null, t: 0 }, gunSlow: 0,
    state: 'driving', // driving | falling | respawning | finished
    fallT: 0, respawnT: 0, invulnT: 0, lastCheckpointS: 0, stuckT: 0, wallCooldown: 0,
    respawns: 0, offroad: false, t: 0,
    finishTime: null, place: null,
  };
}

export function activateTurbo(car) {
  if (car.state !== 'driving' || car.turbosLeft <= 0 || car.turboT > 0) return false;
  car.turbosLeft--;
  car.turboT = C.TURBO_TIME;
  return true;
}

function respawn(car) {
  car.s = car.lastCheckpointS; car.d = 0; car.yaw = 0; car.h = 0; car.vy = 0;
  car.speed = C.CRUISE_SPEED * 0.5; car.steer = 0;
  car.hit.kind = null; car.hit.t = 0;
  car.state = 'driving'; car.invulnT = C.INVULN_AFTER_RESPAWN;
  car.stuckT = 0; car.wallCooldown = 0; car.respawns++;
}

function startFall(car) {
  car.state = 'falling'; car.fallT = CONFIG.track.FALL_TIME; car.vy = Math.min(car.vy, 0);
}

export function stepCar(car, dt, track) {
  car.t += dt;

  if (car.state === 'respawning') {
    car.respawnT -= dt;
    if (car.respawnT <= 0) respawn(car);
    return;
  }
  if (car.state === 'falling') {
    car.s += car.speed * Math.cos(car.yaw) * dt;
    car.d += car.speed * Math.sin(car.yaw) * dt;
    car.speed *= 1 - 0.5 * dt;
    car.vy -= C.GRAVITY * dt; car.h += car.vy * dt;
    car.fallT -= dt;
    if (car.fallT <= 0) { car.state = 'respawning'; car.respawnT = C.RESPAWN_TIME; }
    return;
  }

  const finished = car.state === 'finished';
  const input = car.input;

  // timers
  car.turboT = Math.max(0, car.turboT - dt);
  car.boostT = Math.max(0, car.boostT - dt);
  car.collideCooldown = Math.max(0, car.collideCooldown - dt);
  car.invulnT = Math.max(0, car.invulnT - dt);
  car.wallCooldown = Math.max(0, car.wallCooldown - dt);
  car.gunSlow = Math.max(0, car.gunSlow - CONFIG.items.GUN_SLOW_DECAY * dt);
  if (car.hit.kind) { car.hit.t -= dt; if (car.hit.t <= 0) car.hit.kind = null; }

  // turbo (rising edge of the input)
  const tp = !!input.turbo;
  if (tp && !car.prevTurboInput && !finished) activateTurbo(car);
  car.prevTurboInput = tp;

  const sm = track.sample(car.s, S);
  const hw = sm.halfWidth;
  const side0 = car.d < 0 ? -1 : 1;
  const edge0 = side0 < 0 ? sm.edgeLeft : sm.edgeRight;
  car.offroad = edge0 === 'sand' && Math.abs(car.d) > hw;
  const air = car.h > 0.001 || car.vy > 0;

  // speed
  let target = finished ? 0 : C.CRUISE_SPEED;
  if (car.turboT > 0) target *= C.TURBO_MULT;
  if (car.boostT > 0) target *= CONFIG.countdown.START_BOOST_MULT;
  if (car.offroad) target *= C.SAND_MULT;
  if (car.hit.kind) target *= C.HIT_SPEED_MULT[car.hit.kind];
  target *= 1 - car.gunSlow;
  if (input.speedMult) target *= input.speedMult;
  const accel = car.turboT > 0 ? C.TURBO_ACCEL : C.ACCEL;
  car.speed += clamp(target - car.speed, -C.DECEL * dt, accel * dt);

  // steering
  const raw = finished ? clamp(-car.d * 0.2 - car.yaw * 2, -1, 1) : clamp(input.steer || 0, -1, 1);
  car.steer += (raw - car.steer) * Math.min(1, dt * C.STEER_SMOOTH);
  let se = car.steer;
  if (car.hit.kind === 'slip') se = se * 0.3 + Math.sin(car.t * 9) * 0.6;
  if (car.hit.kind === 'spin') se = 0;

  let ds, dd;
  if (!air) {
    const sf = clamp(car.speed / C.CRUISE_SPEED, 0.25, 1);
    car.yaw += se * C.STEER_RATE * sf * dt;
    car.yaw -= car.yaw * C.YAW_RETURN * dt;
    car.yaw = clamp(car.yaw, -C.MAX_YAW, C.MAX_YAW);
    ds = car.speed * Math.cos(car.yaw) * dt;
    // centrifugal push towards the outside of the bend (right turn => curvature > 0 => push left)
    dd = car.speed * Math.sin(car.yaw) * dt - sm.curvature * car.speed * car.speed * C.DRIFT_K * dt;
  } else {
    ds = car.speed * Math.cos(car.yaw) * dt;
    dd = car.speed * Math.sin(car.yaw) * dt;
  }
  car.s += ds; car.d += dd;
  if (car.s > track.maxS) { car.s = track.maxS; car.speed = 0; }

  // vertical
  if (air) {
    car.vy -= C.GRAVITY * dt; car.h += car.vy * dt;
    if (car.h <= 0) { car.h = 0; car.vy = 0; }
  }

  // edges
  const side = car.d < 0 ? -1 : 1;
  const edge = side < 0 ? sm.edgeLeft : sm.edgeRight;
  const absd = Math.abs(car.d);
  if (edge === 'cliff') {
    if (absd > hw && !finished) { startFall(car); return; }
  } else {
    const limit = edge === 'wall' ? hw : hw + CONFIG.track.SAND_EXTRA;
    if (absd > limit) {
      car.d = side * limit;
      if (car.yaw * side > 0) car.yaw = -car.yaw * 0.4;
      if (car.wallCooldown <= 0) { car.speed *= 0.85; car.wallCooldown = CONFIG.track.WALL_PUSH_COOLDOWN; car.wallHit = true; }
    }
  }

  // checkpoints & stuck detection
  if (car.state === 'driving') {
    if (!air && Math.abs(car.d) <= hw) {
      car.lastCheckpointS = Math.max(car.lastCheckpointS, Math.floor(Math.max(0, car.s) / CONFIG.track.CHECKPOINT_EVERY) * CONFIG.track.CHECKPOINT_EVERY);
    }
    car.stuckT = car.speed < 3 ? car.stuckT + dt : 0;
    if (car.stuckT > C.STUCK_TIME) { car.state = 'respawning'; car.respawnT = C.RESPAWN_TIME; return; }
    if (car.s >= track.finishS) car.state = 'finished';
  }
}
