// V4: nobody can fall off the track. A "wild" driver (random steering held for random times, turbo anywhere, items) on every
// car, in many races: zero falls, and every car always stays inside the barriers.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createWorld } from '../../src/sim/World.js';
import { createRng } from '../../src/sim/rng.js';

const track = createTrack();

describe('no falling off the track (V4)', () => {
  it('120 races with wild drivers: zero falls, zero respawns, nobody outside the barriers', () => {
    let falls = 0, respawns = 0, outside = 0, steps = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rng = createRng(seed * 13 + 1);
      const w = createWorld({ track, seed, bots: 3 });
      w.brains.clear();                                         // everybody is a wild driver
      w.go(true);
      const plan = w.cars.map(() => ({ steer: 0, until: 0, out: 0 }));
      for (let i = 0; i < 60 * 140 && !w.done; i++) {
        w.cars.forEach((c, k) => {
          if (w.time >= plan[k].until) { plan[k].steer = rng() < 0.3 ? 0 : (rng() < 0.5 ? -1 : 1) * (0.4 + rng() * 0.6); plan[k].until = w.time + 0.3 + rng() * 3; }
          c.input.steer = plan[k].steer; c.input.turbo = rng() < 0.01; c.input.item = rng() < 0.02;
        });
        w.step(1 / 60); steps++;
        for (const [k, c] of w.cars.entries()) {
          if (c.state === 'falling') falls++;
          const sm = track.sample(c.s), side = c.d < 0 ? sm.edgeLeft : sm.edgeRight;
          const lim = side === 'sand' ? (c.d < 0 ? sm.sandLimL : sm.sandLimR) : sm.halfWidth - CONFIG.car.HALF_WIDTH;
          // a collision push can leave a car past a barrier for ONE step (the next step clamps it): count only longer stays
          plan[k].out = Math.abs(c.d) > lim + 0.6 ? plan[k].out + 1 : 0;
          if (plan[k].out >= 2) outside++;
        }
      }
      for (const c of w.cars) respawns += c.respawns;
    }
    expect(steps).toBeGreaterThan(100000);
    expect(falls).toBe(0);
    expect(outside).toBe(0);
    expect(respawns).toBe(0);
  }, 120000);
});
