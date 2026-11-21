// Car-to-car collisions in track space: cars are ellipses (long axis along the track).
// Overlapping cars are pushed apart; the car behind loses a little speed. Not a "hit": no spin.
import { CONFIG } from '../config.js';

export function resolveCarCollisions(cars) {
  const { COLLIDE_A: A, COLLIDE_B: B, COLLIDE_SLOW, COLLIDE_COOLDOWN } = CONFIG.race;
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
      let nx, ny;
      if (r < 1e-6) { nx = 0; ny = (a.id < b.id) ? 1 : -1; } else { nx = sx / r; ny = sy / r; }
      const push = (1 - r) / 2;
      a.s -= nx * push * A; a.d -= ny * push * B;
      b.s += nx * push * A; b.d += ny * push * B;
      const rear = a.s <= b.s ? a : b;
      if (rear.collideCooldown <= 0) { rear.speed *= COLLIDE_SLOW; rear.collideCooldown = COLLIDE_COOLDOWN; }
    }
  }
}
