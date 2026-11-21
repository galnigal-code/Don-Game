// Simulation world: owns cars and advances them. Pure logic, no three.js.
import { createRng } from './rng.js';
import { createCar, stepCar } from './Car.js';

export function createWorld({ track, seed = 1 } = {}) {
  const rng = createRng(seed);
  const player = createCar({ id: 0, name: 'אתה', color: 0xd0201c, isPlayer: true, s: -6, d: 0 });
  const world = {
    track, rng, time: 0,
    cars: [player], player,
    finishOrder: [],
    step(dt) {
      world.time += dt;
      for (const car of world.cars) {
        stepCar(car, dt, track);
        if (car.state === 'finished' && car.finishTime == null) {
          car.finishTime = world.time;
          world.finishOrder.push(car);
          car.place = world.finishOrder.length;
        }
      }
    },
    get done() { return world.finishOrder.length === world.cars.length; },
  };
  return world;
}
