// Simulation world: owns cars and advances them. Pure logic, no three.js.
import { CONFIG } from '../config.js';
import { createRng } from './rng.js';
import { createCar, stepCar } from './Car.js';
import { createBrain, driveBot } from './BotDriver.js';
import { resolveCarCollisions } from './collisions.js';
import { computeRanks } from './race.js';
import { createRoller, stepRoller, placeAheadOfRoller } from './roller.js';
import { FIXED_OBSTACLES } from './trackData.js';
import { generateBoxes } from './boxLayout.js';
import { useItem, stepGun, stepBoxes } from './items.js';
import { stepEntities } from './entities.js';

import { BOT_NAMES, BOT_COLORS } from './botNames.js';
export { BOT_NAMES, BOT_COLORS };
const GRID = [[-6, -3], [-6, 3], [-12, -3], [-12, 3]];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/** roller: the giant roller is shelved (CONFIG.roller.ENABLED = false); pass true to run it (its own tests do). */
export function createWorld({ track, seed = 1, bots = 3, roller = CONFIG.roller.ENABLED } = {}) {
  const rng = createRng(seed);
  const slots = shuffle(GRID.slice(), rng);
  const names = shuffle(BOT_NAMES.slice(), rng);

  const shuffledLanes = shuffle([0, 1, 2], rng);
  const cars = [];
  const player = createCar({ id: 0, name: 'אתה', color: 0xd0201c, isPlayer: true, s: slots[0][0], d: slots[0][1] });
  cars.push(player);
  const brains = new Map();
  for (let i = 0; i < bots; i++) {
    const car = createCar({ id: i + 1, name: names[i], color: BOT_COLORS[i % BOT_COLORS.length], s: slots[i + 1][0], d: slots[i + 1][1] });
    cars.push(car);
    brains.set(car, createBrain(rng, track, shuffledLanes[i]));
  }

  const fixed = FIXED_OBSTACLES.map((o, i) => ({ id: i + 1, type: o.kind, s: o.s, d: o.d, ownerId: -1, age: 0, alive: true, travel: 0, fixed: true }));
  const world = {
    track, rng, time: 0, cars, player, brains,
    entities: fixed, boxes: generateBoxes(track, createRng(seed * 7919 + 13)),   // separate rng: the layout must not disturb the bots' randomness
    events: [], entityId: fixed.length, stats: { pickups: 0, uses: 0, hits: 0, bumps: 0 },
    roller: Object.assign(createRoller(), roller ? {} : { ended: true }), eliminated: [],
    finishOrder: [], leaderS: 0, sincePlayerOut: 0, ranked: computeRanks(cars),

    /** Race start: the player may get the start boost; some bots always may. */
    go(playerBoost = false) {
      // the boost is a strong push, not a teleport to full speed: cars on the grid are only 6 m apart
      const boost = (car) => { car.boostT = CONFIG.countdown.START_BOOST_TIME; car.speed = CONFIG.car.CRUISE_SPEED * 0.45; };
      if (playerBoost) boost(player);
      for (const [car, brain] of brains) if (brain.startBoost) boost(car);
    },

    step(dt) {
      world.time += dt;
      world.ranked = computeRanks(cars);
      world.leaderS = world.ranked[0].s;
      for (const [car, brain] of brains) {
        if (car.state === 'finished' || car.state === 'eliminated') continue;
        driveBot(car, brain, world);
        // rubber band (friendly to the player): a bot that leads eases off strongly, one that trails
        // pushes only a little. Off once the player is done.
        let rb = 1;
        const playerOut = player.state === 'finished' || player.state === 'eliminated';
        if (!playerOut) {
          const x = Math.max(-1, Math.min(1, (car.s - player.s) / CONFIG.bots.RUBBER_RANGE)); // + = bot ahead
          rb = x > 0 ? 1 - x * CONFIG.bots.RUBBER_SLOW_MAX : 1 - x * CONFIG.bots.RUBBER_BOOST_MAX;
          // never slow a bot down when the roller is right behind it
          if (world.roller.active && car.s - world.roller.s < CONFIG.roller.NO_SLOWDOWN_DIST) rb = Math.max(rb, 1);
        }
        car.input.speedMult = brain.skill * rb;
      }
      for (const car of cars) {
        const want = !!car.input.item;
        if (want && !car.prevItemInput) useItem(car, world);
        car.prevItemInput = want;
        stepGun(car, world, dt);
      }
      for (const car of cars) {
        stepCar(car, dt, track);
        if (car.state === 'finished' && car.finishTime == null) {
          car.finishTime = world.time;
          world.finishOrder.push(car);
          car.place = world.finishOrder.length;
        }
      }
      for (const car of cars) if (car.justRespawned) { car.justRespawned = false; placeAheadOfRoller(world, car); }
      stepRoller(world, dt);
      stepEntities(world, dt);
      stepBoxes(world, dt);
      resolveCarCollisions(cars, { world });
      world.ranked = computeRanks(cars);

      // safety net: nobody should be stuck for long after the player is done (finished or flattened)
      if (player.state === 'finished' || player.state === 'eliminated') {
        world.sincePlayerOut += dt;
        if (world.sincePlayerOut > CONFIG.race.FORCE_FINISH_AFTER) {
          for (const car of world.ranked) if (car.finishTime == null && car.state !== 'eliminated') {
            car.state = 'finished'; car.s = track.finishS; car.speed = 0; car.finishTime = world.time;
            world.finishOrder.push(car); car.place = world.finishOrder.length;
          }
        }
      }
    },
    get done() { return world.finishOrder.length + world.eliminated.length === cars.length; },
    /** Final standing: finishers by time, then the flattened (the later one is better). Sets `place` on everyone. */
    finalOrder() {
      const flat = [...world.eliminated].sort((a, b) => b.eliminatedAt - a.eliminatedAt);
      const all = [...world.finishOrder, ...flat];
      all.forEach((c, i) => { c.place = i + 1; });
      return all;
    },
  };
  return world;
}
