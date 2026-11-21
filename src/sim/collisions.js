// Car-to-car collisions in track space (V2-B). Pure logic.
//  - cars are ellipses (long axis along the track); overlapping cars are pushed apart
//  - an approaching pair exchanges an impulse along the contact normal (with mass: a turbo car is heavier):
//    the car hit from the side is THROWN sideways (lateral velocity `vd`, decays), from behind it is pushed forward
//  - a hard hit (relative speed > SHOVE_REL) makes the LIGHTER car slide for a moment ("shove")
import { CONFIG } from '../config.js';
import { applyHit } from './items.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const massOf = (car) => (car.turboT > 0 ? CONFIG.bump.TURBO_MASS : 1);

/**
 * @param cars   all cars
 * @param ctx    { world } when called from the world (collision events and shoves are reported there); tests may omit it
 */
export function resolveCarCollisions(cars, ctx = {}) {
  const K = CONFIG.bump;
  const A = K.CONTACT_A, B = K.CONTACT_B;       // contact ellipse of a PAIR of cars (their half-sizes added)
  const world = ctx.world || { events: [], stats: { bumps: 0, hits: 0 } };
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.state !== 'driving') continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.state !== 'driving') continue;
      const ds = b.s - a.s, dd = b.d - a.d;
      const sx = ds / A, sy = dd / B;
      const r = Math.hypot(sx, sy);
      if (r >= 1) continue;

      // contact normal (from a to b): gradient of the ellipse
      let nx = sx / A, ny = sy / B;
      const nl = Math.hypot(nx, ny);
      if (nl < 1e-9) { nx = 0; ny = a.id < b.id ? 1 : -1; } else { nx /= nl; ny /= nl; }

      // 1. positional separation
      const push = (1 - r) / 2;
      const sep = r < 1e-6 ? { s: 0, d: (a.id < b.id ? 1 : -1) * B } : { s: sx / r * A, d: sy / r * B };
      a.s -= sep.s * push; a.d -= sep.d * push;
      b.s += sep.s * push; b.d += sep.d * push;

      // 2. impulse (only for a pair that is approaching, and not twice in a row)
      const cd = (a.bumpCd[b.id] || 0) > 0 || (b.bumpCd[a.id] || 0) > 0;
      const va = { s: a.speed * Math.cos(a.yaw), d: a.speed * Math.sin(a.yaw) + a.vd };
      const vb = { s: b.speed * Math.cos(b.yaw), d: b.speed * Math.sin(b.yaw) + b.vd };
      const vrel = (vb.s - va.s) * nx + (vb.d - va.d) * ny;       // < 0: closing
      if (vrel >= 0 || cd) continue;

      const ma = massOf(a), mb = massOf(b);
      const J = -(1 + K.RESTITUTION) * vrel / (1 / ma + 1 / mb);
      const apply = (car, sign, m) => {
        const dvs = sign * J / m * nx, dvd = sign * J / m * ny;
        car.speed += clamp(dvs, -K.MAX_DSPEED, K.MAX_DSPEED);
        car.vd = clamp(car.vd + dvd, -K.MAX_VD, K.MAX_VD);
        car.yaw = clamp(car.yaw + clamp(dvd * K.YAW_GAIN, -K.YAW_MAX, K.YAW_MAX), -CONFIG.car.MAX_YAW, CONFIG.car.MAX_YAW);
      };
      apply(a, -1, ma); apply(b, +1, mb);
      a.bumpCd[b.id] = K.PAIR_COOLDOWN; b.bumpCd[a.id] = K.PAIR_COOLDOWN;

      // 3. a hard hit: the lighter car (if equal: the one that was driven INTO) slides for a moment
      const strength = -vrel;
      if (strength > K.SHOVE_REL) {
        let victim;
        if (ma !== mb) victim = ma < mb ? a : b;
        else { const towardB = va.s * nx + va.d * ny, towardA = -(vb.s * nx + vb.d * ny); victim = towardB >= towardA ? b : a; }
        applyHit(victim, 'shove', world);
      }
      if (strength >= K.EVENT_MIN) {
        world.stats.bumps = (world.stats.bumps || 0) + 1;
        world.events.push({ type: 'collide', a: a.id, b: b.id, strength, s: (a.s + b.s) / 2, d: (a.d + b.d) / 2, aSide: ny });
      }
    }
  }
}
