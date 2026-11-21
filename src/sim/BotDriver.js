// Minimal driver: follows a lateral offset line, compensating for the bend drift.
// Used for ?autopilot=1 and tests. (M3 extends this with items, rubber band, avoidance.)
import { CONFIG } from '../config.js';

const C = CONFIG.car;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const S = {};

export function driveSimple(car, track, offset = 0) {
  const look = Math.max(10, car.speed * 0.7);
  const here = track.sample(car.s, S);
  const target = clamp(offset, -here.halfWidth + 2, here.halfWidth - 2);
  const ff = here.curvature * car.speed * C.DRIFT_K;
  const desiredYaw = clamp(Math.atan2(target - car.d, look) * 1.2 + ff, -C.MAX_YAW * 0.8, C.MAX_YAW * 0.8);
  const sf = clamp(car.speed / C.CRUISE_SPEED, 0.25, 1);
  car.input.steer = clamp(desiredYaw * (C.YAW_RETURN / C.STEER_RATE) / sf + (desiredYaw - car.yaw) * 2, -1, 1);
}
