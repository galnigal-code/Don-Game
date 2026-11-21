// Simulation world: owns cars and advances them. Pure logic, no three.js.
import { CONFIG } from '../config.js';
import { createRng } from './rng.js';
import { createCar, stepCar } from './Car.js';
import { createBrain, driveBot } from './BotDriver.js';
import { resolveCarCollisions } from './collisions.js';
import { computeRanks } from './race.js';

export const BOT_NAMES = ['טורבו-טל', 'רוני רוקט', 'מאיה מהירה', 'דני דיונה', 'שירה שמן', 'אבי אבק', 'נועה נייטרו', 'יוסי יעלון'];
export const BOT_COLORS = [0xf5c400, 0x1e6fff, 0x18b04a];
const GRID = [[-6, -3], [-6, 3], [-12, -3], [-12, 3]];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export function createWorld({ track, seed = 1, bots = 3 } = {}) {
  const rng = createRng(seed);
  const slots = shuffle(GRID.slice(), rng);
  const names = shuffle(BOT_NAMES.slice(), rng);

  const cars = [];
  const player = createCar({ id: 0, name: 'אתה', color: 0xd0201c, isPlayer: true, s: slots[0][0], d: slots[0][1] });
  cars.push(player);
  const brains = new Map();
  for (let i = 0; i < bots; i++) {
    const car = createCar({ id: i + 1, name: names[i], color: BOT_COLORS[i % BOT_COLORS.length], s: slots[i + 1][0], d: slots[i + 1][1] });
    cars.push(car);
    brains.set(car, createBrain(rng, track));
  }

  const world = {
    track, rng, time: 0, cars, player, brains,
    finishOrder: [], leaderS: 0, sincePlayerFinish: 0, ranked: computeRanks(cars),

    /** Race start: the player may get the start boost; some bots always may. */
    go(playerBoost = false) {
      const boost = (car) => { car.boostT = CONFIG.countdown.START_BOOST_TIME; car.speed = CONFIG.car.CRUISE_SPEED; };
      if (playerBoost) boost(player);
      for (const [car, brain] of brains) if (brain.startBoost) boost(car);
    },

    step(dt) {
      world.time += dt;
      world.ranked = computeRanks(cars);
      world.leaderS = world.ranked[0].s;
      for (const [car, brain] of brains) {
        if (car.state === 'finished') continue;
        driveBot(car, brain, world);
        // rubber band (friendly to the player): a bot that leads eases off strongly, one that trails
        // pushes only a little. Off once the player is done.
        let rb = 1;
        if (player.state !== 'finished') {
          const x = Math.max(-1, Math.min(1, (car.s - player.s) / CONFIG.bots.RUBBER_RANGE)); // + = bot ahead
          rb = x > 0 ? 1 - x * CONFIG.bots.RUBBER_SLOW_MAX : 1 - x * CONFIG.bots.RUBBER_BOOST_MAX;
        }
        car.input.speedMult = brain.skill * rb;
      }
      for (const car of cars) {
        stepCar(car, dt, track);
        if (car.state === 'finished' && car.finishTime == null) {
          car.finishTime = world.time;
          world.finishOrder.push(car);
          car.place = world.finishOrder.length;
        }
      }
      resolveCarCollisions(cars);
      world.ranked = computeRanks(cars);

      // safety net: nobody should be stuck for long after the player is done
      if (player.state === 'finished') {
        world.sincePlayerFinish += dt;
        if (world.sincePlayerFinish > CONFIG.race.FORCE_FINISH_AFTER) {
          for (const car of world.ranked) if (car.finishTime == null) {
            car.state = 'finished'; car.s = track.finishS; car.speed = 0; car.finishTime = world.time;
            world.finishOrder.push(car); car.place = world.finishOrder.length;
          }
        }
      }
    },
    get done() { return world.finishOrder.length === cars.length; },
  };
  return world;
}
