// Compact car-state messages: a car is sent as an array of 13 small integers (about 60 bytes of JSON).
//   [carId, timeMs, s*100, d*100, h*100, yaw*1000, speed*10, steer*100, stateCode, fxBits, hitCode, hitT*100, route]
export const STATES = ['driving', 'falling', 'respawning', 'finished', 'eliminated'];
export const HITS = [null, 'spin', 'launch', 'slip', 'bump', 'shove'];
export const FX = { turbo: 1, shield: 2, invuln: 4, gunSlow: 8, pad: 16 };

const r = Math.round;
export function packCar(car, raceTime) {
  const state = Math.max(0, STATES.indexOf(car.state));
  const fx = (car.turboT > 0 ? FX.turbo : 0) | (car.shieldT > 0 ? FX.shield : 0) | (car.invulnT > 0 ? FX.invuln : 0) | (car.padT > 0 ? FX.pad : 0);
  return [car.id, r(raceTime * 1000), r(car.s * 100), r(car.d * 100), r(car.h * 100), r(car.yaw * 1000), r(car.speed * 10), r(car.steer * 100),
    state, fx, Math.max(0, HITS.indexOf(car.hit.kind)), r((car.hit.t || 0) * 100), car.route || 0];
}

export function unpackCar(a) {
  return {
    id: a[0], t: a[1] / 1000, s: a[2] / 100, d: a[3] / 100, h: a[4] / 100, yaw: a[5] / 1000, speed: a[6] / 10, steer: a[7] / 100,
    state: STATES[a[8]] || 'driving', fx: a[9], hitKind: HITS[a[10]] || null, hitT: a[11] / 100, route: a[12] | 0,
  };
}

export const isCarArray = (a) => Array.isArray(a) && a.length === 13 && a.every((v) => typeof v === 'number' && Number.isFinite(v));
