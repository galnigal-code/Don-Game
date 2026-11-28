import { describe, it, expect } from 'vitest';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createWorld } from '../../src/sim/World.js';
import { createCar } from '../../src/sim/Car.js';
import { resolveCarCollisions } from '../../src/sim/collisions.js';
import { drivePlayerProxy, createBrain } from '../../src/sim/BotDriver.js';
import { createRng } from '../../src/sim/rng.js';
import { packCar, unpackCar, isCarArray } from '../../src/net/carState.js';
import { RemoteTrack, DELAY } from '../../src/net/interp.js';
import { RoomCore, PLAYER_COLORS } from '../../src/net/room/RoomCore.js';
import { PROTOCOL_VERSION, parseClientMessage } from '../../src/net/protocol.js';

const track = createTrack();
const roster4 = (humans = 2) => Array.from({ length: 4 }, (_, i) => ({ carId: i, kind: i < humans ? 'human' : 'bot', name: 'N' + i, color: PLAYER_COLORS[i], slot: i }));

describe('car state packing', () => {
  it('round trips within the wire precision', () => {
    const car = createCar({ id: 3, s: 123.456, d: -4.321 }); car.h = 1.234; car.yaw = -0.3141; car.speed = 31.87; car.steer = 0.55; car.turboT = 1; car.hit = { kind: 'spin', t: 0.77 };
    const a = packCar(car, 12.3456), u = unpackCar(a);
    expect(isCarArray(a)).toBe(true);
    expect(u).toMatchObject({ id: 3, state: 'driving', hitKind: 'spin' });
    for (const [k, v, tol] of [['s', 123.456, 0.01], ['d', -4.321, 0.01], ['h', 1.234, 0.01], ['yaw', -0.3141, 0.001], ['speed', 31.87, 0.05], ['steer', 0.55, 0.01], ['t', 12.3456, 0.001], ['hitT', 0.77, 0.01]]) expect(Math.abs(u[k] - v)).toBeLessThan(tol);
    expect(u.fx & 1).toBe(1);
    expect(JSON.stringify({ t: 'st', a }).length).toBeLessThan(110);
  });
  it('the bots message of 3 cars fits the 1 KB limit and validates', () => {
    const cars = [1, 2, 3].map((i) => packCar(createCar({ id: i, s: 1000.55, d: -3.2 }), 99.9));
    const raw = JSON.stringify({ t: 'bots', a: cars });
    expect(raw.length).toBeLessThan(400); expect(parseClientMessage(raw)).toBeTruthy();
  });
  it('garbage arrays are rejected', () => {
    for (const bad of [[1, 2, 3], new Array(12).fill('x'), new Array(12).fill(NaN)]) expect(parseClientMessage(JSON.stringify({ t: 'st', a: bad }))).toBeNull();
  });
});

describe('interpolation of a remote car', () => {
  const st = (t, s, extra = {}) => ({ id: 1, t, s, d: 0, h: 0, yaw: 0, speed: 30, steer: 0, state: 'driving', fx: 0, hitKind: null, hitT: 0, ...extra });
  it('interpolates between samples and is smooth with ±50 ms jitter (streamed, like the real game)', () => {
    const tr = new RemoteTrack(); const rng = createRng(5);
    const inbox = []; for (let i = 0; i < 60; i++) inbox.push({ at: i / 15 + 0.1 + (rng() - 0.5) * 0.1, st: st(i / 15, 30 * i / 15) });
    let prev = null, n = 0;
    for (let now = 0; now < 3.8; now += 1 / 60) {
      for (const m of inbox) if (m.at <= now && !m.done) { m.done = true; tr.push(m.st); }
      if (now < 0.6) continue;
      const v = tr.sample(now - 0.1 - DELAY).s;             // the sender's clock = our clock minus the 0.1 s transit
      expect(Math.abs(v - 30 * (now - 0.1 - DELAY))).toBeLessThan(0.3);
      if (prev != null) expect(v - prev).toBeGreaterThanOrEqual(-0.001);
      prev = v; n++;
    }
    expect(n).toBeGreaterThan(150);
  });
  it('out of order samples are ordered, duplicates ignored, very old ones dropped', () => {
    const tr = new RemoteTrack();
    for (const t of [0, 0.2, 0.1, 0.1, 0.3]) tr.push(st(t, t * 30));
    expect(tr.buf.map((x) => x.t)).toEqual([0, 0.1, 0.2, 0.3]);
    for (let i = 0; i < 40; i++) tr.push(st(1 + i / 15, 30 + 2 * i)); tr.push(st(0.05, 1));
    expect(tr.buf[0].t).toBeGreaterThan(0.05);
  });
  it('predicts at most 0.25 s ahead, then reports the car as stale', () => {
    const tr = new RemoteTrack(); tr.push(st(0, 0)); tr.push(st(0.1, 3));
    expect(tr.sample(0.2).stale).toBe(false);
    const late = tr.sample(5); expect(late.stale).toBe(true); expect(late.s).toBeCloseTo(3 + 30 * 0.25, 1);
  });
  it('a stopped car (finished / falling) is not extrapolated', () => {
    const tr = new RemoteTrack(); tr.push(st(0, 100, { state: 'finished' })); tr.push(st(0.1, 100, { state: 'finished' }));
    expect(tr.sample(0.3).s).toBe(100);
  });
  it('empty track gives null; the yaw blends the short way around', () => {
    expect(new RemoteTrack().sample(1)).toBeNull();
    const tr = new RemoteTrack(); tr.push(st(0, 0, { yaw: 3.0 })); tr.push(st(1, 30, { yaw: -3.0 }));
    expect(Math.abs(Math.abs(tr.sample(0.5).yaw) - Math.PI)).toBeLessThan(0.2);
  });
  it('shows the car DELAY in the past', () => { expect(DELAY).toBeGreaterThan(0.05); expect(DELAY).toBeLessThan(0.25); });
});

describe('room relays car states', () => {
  const hello = (n, c) => ({ t: 'hello', v: PROTOCOL_VERSION, token: `token-${n}-xxxxxxxx`, name: 'P' + n, color: PLAYER_COLORS[c] });
  function started() {
    const r = new RoomCore({ code: 'KRTM', now: 0 }); const ids = [r.join(hello(1, 0), 1).playerId, r.join(hello(2, 1), 2).playerId];
    for (const id of ids) r.onMessage(id, { t: 'calibrated' }, 5);
    r.onMessage(ids[0], { t: 'start_now' }, 10); r.drain(); return { r, ids };
  }
  const carA = (id, s = 10) => packCar(createCar({ id, s }), 1);
  it('relays a car state to everybody except the sender, only for the sender’s own car', () => {
    const { r, ids } = started();
    r.onMessage(ids[1], { t: 'st', a: carA(1) }, 100);
    const out = r.drain(); expect(out.length).toBe(1); expect(out[0].to).toEqual({ except: ids[1] });
    r.onMessage(ids[1], { t: 'st', a: carA(0) }, 100); expect(r.drain().length).toBe(0);      // spoofing car 0 is ignored
    r.onMessage(ids[1], { t: 'st', a: carA(3) }, 100); expect(r.drain().length).toBe(0);      // so is a bot car
  });
  it('only the host may send the bots, and only bot cars pass', () => {
    const { r, ids } = started();
    r.onMessage(ids[1], { t: 'bots', a: [carA(2)] }, 100); expect(r.drain().length).toBe(0);
    r.onMessage(ids[0], { t: 'bots', a: [carA(2), carA(1)] }, 100);
    const out = r.drain(); expect(out.length).toBe(1); expect(out[0].msg.a.map((a) => a[0])).toEqual([2]);
  });
  it('nothing is relayed outside a race', () => {
    const r = new RoomCore({ code: 'KRTM', now: 0 }); const id = r.join(hello(1, 0), 1).playerId; r.drain();
    r.onMessage(id, { t: 'st', a: carA(0) }, 3); expect(r.drain().length).toBe(0);
  });
});

describe('online world (two phones)', () => {
  it('builds cars from the roster; remote cars are not simulated, local bots only on the host', () => {
    const host = createWorld({ track, seed: 7, roster: roster4(2), myCarId: 0, hostsBots: true });
    const guest = createWorld({ track, seed: 7, roster: roster4(2), myCarId: 1, hostsBots: false });
    expect(host.cars.map((c) => c.owner)).toEqual(['local', 'remote', 'local', 'local']);
    expect(guest.cars.map((c) => c.owner)).toEqual(['remote', 'local', 'remote', 'remote']);
    expect(host.player.id).toBe(0); expect(guest.player.id).toBe(1);
    expect(host.brains.size).toBe(2); expect(guest.brains.size).toBe(0);
    expect(host.cars.map((c) => [c.s, c.d])).toEqual(guest.cars.map((c) => [c.s, c.d]));      // same grid on both phones
    const before = guest.cars[0].s; for (let i = 0; i < 120; i++) guest.step(1 / 60); expect(guest.cars[0].s).toBe(before);   // remote: untouched
  });
  it('six cars fit on the grid with unique spots', () => {
    const r = Array.from({ length: 6 }, (_, i) => ({ carId: i, kind: 'human', name: 'N' + i, color: PLAYER_COLORS[i], slot: i }));
    const w = createWorld({ track, seed: 1, roster: r, myCarId: 2, hostsBots: false });
    expect(new Set(w.cars.map((c) => `${c.s},${c.d}`)).size).toBe(6);
  });
  it('adoptBots makes the bots local and driving again (host changed)', () => {
    const w = createWorld({ track, seed: 3, roster: roster4(2), myCarId: 1, hostsBots: false });
    w.adoptBots(); expect(w.cars.filter((c) => c.kind === 'bot').every((c) => c.owner === 'local')).toBe(true); expect(w.brains.size).toBe(2);
    w.go(); for (let i = 0; i < 180; i++) w.step(1 / 60);
    expect(w.cars[2].s).toBeGreaterThan(0); expect(w.cars.every((c) => Number.isFinite(c.s + c.d))).toBe(true);
  });
  it('two phones exchanging states over a laggy link see each other, no NaN, no pass-through', () => {
    const rng = createRng(9);
    const A = createWorld({ track, seed: 5, roster: roster4(2), myCarId: 0, hostsBots: true });
    const B = createWorld({ track, seed: 5, roster: roster4(2), myCarId: 1, hostsBots: false });
    const brainA = createBrain(createRng(1), track), brainB = createBrain(createRng(2), track);
    const rem = { A: new Map(), B: new Map() };               // what each phone received: carId -> RemoteTrack
    for (const c of A.cars) if (c.owner === 'remote') rem.A.set(c.id, new RemoteTrack());
    for (const c of B.cars) if (c.owner === 'remote') rem.B.set(c.id, new RemoteTrack());
    const wire = [];                                          // [deliverAt, to, packed]
    const apply = (w, tracks) => { for (const c of w.cars) { if (c.owner !== 'remote') continue; const sm = tracks.get(c.id)?.sample(w.time - DELAY); if (sm) Object.assign(c, { s: sm.s, d: sm.d, h: sm.h, yaw: sm.yaw, speed: sm.speed, state: sm.state }); } };
    A.go(); B.go();
    let worstGap = 0;
    for (let i = 0; i < 60 * 40; i++) {
      apply(A, rem.A); apply(B, rem.B);
      drivePlayerProxy(A.player, brainA, A); drivePlayerProxy(B.player, brainB, B);
      A.step(1 / 60); B.step(1 / 60);
      if (i % 4 === 0) {                                      // 15 Hz, latency 80-200 ms
        for (const c of A.cars) if (c.owner === 'local') wire.push([A.time + 0.08 + rng() * 0.12, 'B', packCar(c, A.time)]);
        wire.push([B.time + 0.08 + rng() * 0.12, 'A', packCar(B.player, B.time)]);
      }
      for (let k = wire.length - 1; k >= 0; k--) if (wire[k][0] <= A.time) { const [, to, a] = wire.splice(k, 1)[0]; const u = unpackCar(a); rem[to].get(u.id)?.push(u); }
      worstGap = Math.max(worstGap, Math.abs(A.cars[1].s - B.player.s), Math.abs(B.cars[0].s - A.player.s));
      for (const w of [A, B]) for (const c of w.cars) if (!Number.isFinite(c.s + c.d + c.speed)) throw new Error('NaN');
    }
    expect(A.player.s).toBeGreaterThan(300); expect(B.player.s).toBeGreaterThan(300);
    expect(worstGap).toBeLessThan(12);                        // the other car is shown within about 0.3 s of where it really is
  });
});

describe('collisions with cars of other phones', () => {
  it('only my own car is pushed; two remote cars are ignored', () => {
    const a = createCar({ id: 0, s: 100, d: 0 }), b = createCar({ id: 1, s: 100.5, d: 0.5 });
    a.speed = 30; b.speed = 30; a.owner = 'local'; b.owner = 'remote';
    const bs = b.s, bd = b.d, bsp = b.speed;
    resolveCarCollisions([a, b]);
    expect([b.s, b.d, b.speed]).toEqual([bs, bd, bsp]); expect(a.d).not.toBe(0);
    const c = createCar({ id: 2, s: 100, d: 0 }), d = createCar({ id: 3, s: 100.5, d: 0.5 }); c.owner = d.owner = 'remote';
    resolveCarCollisions([c, d]); expect([c.s, c.d, d.s, d.d]).toEqual([100, 0, 100.5, 0.5]);
  });
});
