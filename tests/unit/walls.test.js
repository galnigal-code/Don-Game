import { describe, it, expect } from 'vitest';
import { createWorld } from '../../src/sim/World.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { CONFIG } from '../../src/config.js';

describe('walls', () => {
  const track = createTrack();
  const wall = track.samples.filter((sm) => sm.edgeLeft === 'wall' && sm.edgeRight === 'wall');
  it('there is a walled canyon section', () => expect(wall.length).toBeGreaterThan(50));
  for (const dir of [-1, 1]) {
    it(`a car pushed into the ${dir < 0 ? 'left' : 'right'} wall never has its body inside the wall`, () => {
      const w = createWorld({ track, seed: 1 });
      const car = w.player;
      car.s = wall[0].s - 5; car.d = 0;
      const hw = wall[0].halfWidth;
      let worst = 0, speedMin = 99;
      for (let i = 0; i < 60 * 8; i++) {
        car.input.steer = dir; w.step(1 / 60);
        const sm = track.sample(car.s);
        if (sm.edgeLeft === 'wall' && car.state === 'driving') { worst = Math.max(worst, Math.abs(car.d) + CONFIG.car.HALF_WIDTH - sm.halfWidth); if (car.s > wall[0].s + 10) speedMin = Math.min(speedMin, car.speed); }
      }
      expect(worst).toBeLessThan(0.1);                // side of the body at most touches the wall
      expect(speedMin).toBeGreaterThan(8);            // grinding along the wall slows down but never traps the car
      void hw;
    });
  }
});
