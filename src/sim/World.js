// Simulation world: owns cars and advances them. Pure logic, no three.js.
import { CONFIG } from '../config.js';
import { createRng } from './rng.js';
import { createCar, stepCar } from './Car.js';
import { createBrain, driveBot } from './BotDriver.js';
import { resolveCarCollisions } from './collisions.js';
import { computeRanks } from './race.js';
import { createRoller, stepRoller, placeAheadOfRoller } from './roller.js';
import { generateBoxes } from './boxLayout.js';
import { useItem, stepGun, stepBoxes } from './items.js';
import { stepEntities } from './entities.js';

import { BOT_NAMES, BOT_COLORS } from './botNames.js';
export { BOT_NAMES, BOT_COLORS };
const GRID = [[-6, -3], [-6, 3], [-12, -3], [-12, 3]];
export const GRID6 = [...GRID, [-18, -3], [-18, 3]];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/** roller: the giant roller is shelved (CONFIG.roller.ENABLED = false); pass true to run it (its own tests do). */
/**
 * roster (online races): [{ carId, kind: 'human'|'bot', name, color, slot }] - cars are built in carId order (car.id === index).
 * myCarId: the car this phone drives. hostsBots: this phone runs the bots (the room host). Every other car is `owner: 'remote'`:
 * the simulation does not step it, the game feeds it from the network.
 */
export function createWorld({ track, seed = 1, bots = 3, roller = CONFIG.roller.ENABLED, roster = null, myCarId = 0, hostsBots = true } = {}) {
  const rng = createRng(seed);
  const slots = shuffle(GRID.slice(), rng);
  const names = shuffle(BOT_NAMES.slice(), rng);

  const shuffledLanes = shuffle([0, 1, 2], rng);
  const cars = [];
  const brains = new Map();
  let player;
  if (roster) {
    for (const r of [...roster].sort((a, b) => a.carId - b.carId)) {
      const [gs, gd] = GRID6[r.slot];
      const car = createCar({ id: r.carId, name: r.name, color: r.color, isPlayer: r.carId === myCarId, s: gs, d: gd });
      car.kind = r.kind; car.owner = (r.carId === myCarId || (r.kind === 'bot' && hostsBots)) ? 'local' : 'remote';
      car.isPlayer = r.carId === myCarId;
      cars.push(car);
      if (r.carId === myCarId) player = car;
      else if (r.kind === 'bot' && hostsBots) brains.set(car, createBrain(createRng(seed * 31 + r.carId), track, r.carId % 3));
    }
    if (!player) player = cars.find((c) => c.kind === 'human') || cars[0];     // spectator (myCarId -1): the camera starts on a human, nothing is driven here
  } else {
    player = createCar({ id: 0, name: 'אתה', color: 0xd0201c, isPlayer: true, s: slots[0][0], d: slots[0][1] });
    player.kind = 'human'; player.owner = 'local';
    cars.push(player);
    for (let i = 0; i < bots; i++) {
      const car = createCar({ id: i + 1, name: names[i], color: BOT_COLORS[i % BOT_COLORS.length], s: slots[i + 1][0], d: slots[i + 1][1] });
      car.kind = 'bot'; car.owner = 'local';
      cars.push(car);
      brains.set(car, createBrain(rng, track, shuffledLanes[i]));
    }
  }

  const fixed = (track.obstacles || []).map((o, i) => ({ id: i + 1, type: o.kind, s: o.s, d: o.d, ownerId: -1, age: 0, alive: true, travel: 0, fixed: true }));
  const world = {
    track, rng, time: 0, cars, player, brains,
    entities: fixed, boxes: generateBoxes(track, createRng(seed * 7919 + 13)),   // separate rng: the layout must not disturb the bots' randomness
    events: [], entityId: fixed.length, stats: { pickups: 0, uses: 0, hits: 0, bumps: 0 },
    roller: Object.assign(createRoller(), roller ? {} : { ended: true }), eliminated: [],
    finishOrder: [], leaderS: 0, sincePlayerOut: 0, ranked: computeRanks(cars),

    online: !!roster,
    netOut: [],                                   // things this phone must announce to the room (items used, entities hit); the game drains it
    /** A box was taken (confirmed by the room): hide it for everybody. */
    takeBox(boxId, seconds = CONFIG.items.BOX_RESPAWN) { const b = world.boxes[boxId]; if (b) b.t = Math.max(b.t, seconds); },
    /** An item another phone used: create the same entity here, advanced by the time it spent on the wire. */
    spawnRemoteItem(m, raceTime) {
      const owner = cars.find((c) => c.id === m.c);
      if (!owner || owner.owner !== 'remote' || world.entities.some((e) => e.id === m.id)) return false;
      const age = Math.max(0, Math.min(1, raceTime - (m.rt ?? raceTime)));
      const e = { id: m.id, type: m.k, ownerId: m.c, age, alive: true, travel: 0, s: m.s, d: m.d };
      if (m.k === 'missile') { e.targetId = m.tg >= 0 ? m.tg : null; e.s += CONFIG.items.MISSILE_SPEED * age; e.travel = CONFIG.items.MISSILE_SPEED * age; }
      world.entities.push(e);
      return true;
    },
    /** Another phone says this entity hit one of its cars: remove it here too. */
    killEntity(id) {
      const e = world.entities.find((x) => x.id === id);
      if (!e || !e.alive) return false;
      e.alive = false; world.events.push({ type: 'explosion', s: e.s, d: e.d, kind: e.type });
      return true;
    },
    /** Another phone's gun burst: this remote car shoots here as well. */
    remoteGun(carId) { const c = cars.find((x) => x.id === carId); if (c && c.owner === 'remote') { c.gunShotsLeft = CONFIG.items.GUN_SHOTS; c.gunCooldown = 0; } },
    /** The room host changed to this phone: take over the bots (they keep their last position). */
    adoptBots() {
      for (const car of cars) {
        if (car.kind !== 'bot' || car.owner === 'local') continue;
        car.owner = 'local'; car.input = { steer: 0, turbo: false, item: false };
        brains.set(car, createBrain(createRng(seed * 31 + car.id + 7), track, car.id % 3));
      }
    },
    /** Hand the bots over (this phone is no longer the host): they become remote again. */
    releaseBots() { for (const [car] of [...brains]) { car.owner = 'remote'; brains.delete(car); } },

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
        // the rubber band compares a bot with the nearest HUMAN (online: the pack of friends; never applied to humans)
        let ref = player;
        if (world.online) { ref = null; for (const c of cars) if (c.kind === 'human' && c.state !== 'finished' && (!ref || Math.abs(c.s - car.s) < Math.abs(ref.s - car.s))) ref = c; }
        const playerOut = !ref || ref.state === 'finished' || ref.state === 'eliminated';
        if (!playerOut) {
          const x = Math.max(-1, Math.min(1, (car.s - ref.s) / CONFIG.bots.RUBBER_RANGE)); // + = bot ahead
          rb = x > 0 ? 1 - x * CONFIG.bots.RUBBER_SLOW_MAX : 1 - x * CONFIG.bots.RUBBER_BOOST_MAX;
          // never slow a bot down when the roller is right behind it
          if (world.roller.active && car.s - world.roller.s < CONFIG.roller.NO_SLOWDOWN_DIST) rb = Math.max(rb, 1);
        }
        car.input.speedMult = brain.skill * rb;
      }
      for (const car of cars) {
        if (car.owner === 'remote') continue;
        const want = !!car.input.item;
        if (want && !car.prevItemInput) useItem(car, world);
        car.prevItemInput = want;
      }
      for (const car of cars) stepGun(car, world, dt);        // other phones' guns fire here too (their burst is announced, the bullets are simulated everywhere)
      for (const car of cars) {
        if (car.owner === 'remote') continue;
        stepCar(car, dt, track);
        if (car.state === 'finished' && car.finishTime == null) {
          car.finishTime = world.time;
          world.finishOrder.push(car);
          car.place = world.finishOrder.length;
        }
      }
      for (const car of cars) if (car.owner !== 'remote' && car.justRespawned) { car.justRespawned = false; placeAheadOfRoller(world, car); }
      stepRoller(world, dt);
      stepEntities(world, dt);
      stepBoxes(world, dt);
      resolveCarCollisions(cars, { world });
      world.ranked = computeRanks(cars);

      // safety net: nobody should be stuck for long after the player is done (finished or flattened)
      if (!world.online && (player.state === 'finished' || player.state === 'eliminated')) {
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
