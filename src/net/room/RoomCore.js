// The room state machine. PURE: no sockets, no timers, no DOM. The Cloudflare Durable Object, the local dev server and the
// unit tests all drive this same class:   join / message / disconnect / tick(now)  ->  outbox of { to, msg }.
// Times are milliseconds (the caller passes `now`).
import { PROTOCOL_VERSION } from '../protocol.js';
import { cleanName } from '../nameFilter.js';
import { createRng } from '../../sim/rng.js';
import { BOT_NAMES } from '../../sim/botNames.js';
import { awardPoints, scoreTable } from './scoring.js';

export const ROOM = {
  MAX_PLAYERS: 6, MIN_FOR_TIMER: 4, TARGET_CARS: 4,
  LOBBY_TIMER_MS: 30000, RECONNECT_MS: 30000, EMPTY_CLOSE_MS: 600000,
  FIRST_FINISH_GRACE_MS: 25000, RACE_MAX_MS: 150000, RESULTS_MS: 8000, GO_DELAY_MS: 4000, CALIB_RETRY_MS: 10000,
  EMOJI_COOLDOWN_MS: 2500, BOX_LOCK_MS: 2800,
};
export const PLAYER_COLORS = [0xd0201c, 0xf5c400, 0x1e6fff, 0x18b04a, 0xff7a00, 0x9b3dff, 0x00b7c2, 0xff4fa3];

export class RoomCore {
  constructor({ code, now = 0, lobbyTimerMs = ROOM.LOBBY_TIMER_MS } = {}) {
    this.code = code;
    this.lobbyTimerMs = lobbyTimerMs;
    this.phase = 'lobby';                 // lobby | racing | results
    this.hostId = null; this.nextId = 1; this.raceNo = 0;
    this.seed = 0; this.goAt = 0; this.timerEnd = null; this.resultsEnd = null; this.firstFinishAt = null;
    this.emptySince = now; this.closed = false;
    this.players = new Map();             // playerId -> player
    this.roster = [];                     // cars of the current race
    this.boxLock = new Map();             // boxId -> time until which it is taken (not persisted: a race lasts minutes)
    this.scores = new Map();              // token -> { name, color, points, wins, races }
    this.outbox = [];
  }

  /* ---------- helpers ---------- */
  send(to, msg) { this.outbox.push({ to, msg }); }
  drain() { const o = this.outbox; this.outbox = []; return o; }
  byToken(token) { for (const p of this.players.values()) if (p.token === token) return p; return null; }
  connected() { return [...this.players.values()].filter((p) => p.connected); }

  freeColor(want, except = null) {
    const used = new Set([...this.players.values()].filter((p) => p !== except).map((p) => p.color));
    if (PLAYER_COLORS.includes(want) && !used.has(want)) return want;
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  }

  /* ---------- connections ---------- */

  /** A socket said hello. Returns { playerId } or { error } (the caller sends the error and closes). */
  join(hello, now) {
    if (this.closed) return { error: 'no_room' };
    if (hello.v !== PROTOCOL_VERSION) return { error: 'update' };
    let p = this.byToken(hello.token);
    if (p) { p.connected = true; p.lastSeen = now; p.goneAt = null; }
    else {
      if (this.players.size >= ROOM.MAX_PLAYERS) return { error: 'room_full' };
      p = { id: this.nextId++, token: hello.token, name: cleanName(hello.name), color: 0, joinedAt: now, connected: true, lastSeen: now, goneAt: null,
        calibrated: false, inRace: false, finish: null, progress: 0, lastEmoji: -1e9 };
      p.color = this.freeColor(hello.color);
      this.players.set(p.id, p);
      if (!this.scores.has(p.token)) this.scores.set(p.token, { name: p.name, color: p.color, points: 0, wins: 0, races: 0 });
    }
    this.emptySince = null;
    if (this.hostId == null || !this.players.get(this.hostId)?.connected) this.hostId = p.id;
    this.send(p.id, { t: 'welcome', you: p.id, code: this.code, serverNow: now });
    if (this.phase === 'racing' && p.inRace) this.send(p.id, this.raceStartMsg());
    else if (this.phase === 'racing') this.send(p.id, { ...this.raceStartMsg(), spectator: true });
    this.refreshTimer(now);
    this.pushRoom();
    return { playerId: p.id };
  }

  disconnect(playerId, now) {
    const p = this.players.get(playerId);
    if (!p || !p.connected) return;
    p.connected = false; p.goneAt = now;
    if (this.hostId === playerId) this.pickHost();
    this.checkEmpty(now);
    this.refreshTimer(now);
    this.pushRoom();
  }

  /** Remove the player for good (explicit leave, or the reconnect window passed). */
  remove(playerId, now) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    if (this.hostId === playerId) this.pickHost();
    this.send('all', { t: 'player_left', id: playerId });
    this.checkEmpty(now);
    this.refreshTimer(now);
    this.pushRoom();
  }

  pickHost() {
    const c = this.connected().sort((a, b) => a.joinedAt - b.joinedAt || a.id - b.id)[0];
    const prev = this.hostId;
    this.hostId = c ? c.id : null;
    if (this.hostId !== prev && this.hostId != null) this.send('all', { t: 'host', id: this.hostId });
  }
  checkEmpty(now) { if (this.connected().length === 0 && this.emptySince == null) this.emptySince = now; }

  /** Does this player run that car? A human drives their own; the host runs the bots. */
  ownsCar(playerId, carId) {
    if (this.phase !== 'racing') return false;
    const c = this.roster.find((x) => x.carId === carId);
    return !!c && (c.kind === 'human' ? c.playerId === playerId : playerId === this.hostId);
  }

  /* ---------- messages from a joined player ---------- */
  onMessage(playerId, m, now) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.lastSeen = now;
    switch (m.t) {
      case 'ping': this.send(playerId, { t: 'pong', c: m.c, s: now }); break;
      case 'calibrated':
        if (this.phase === 'lobby') { p.calibrated = true; this.pushRoom(); }
        break;
      case 'start_now':
        if (playerId === this.hostId && this.phase === 'lobby') this.startRace(now, true);
        break;
      case 'leave': this.remove(playerId, now); break;
      case 'emoji':
        if (now - p.lastEmoji >= ROOM.EMOJI_COOLDOWN_MS) { p.lastEmoji = now; this.send('all', { t: 'emoji', from: playerId, e: m.e }); }
        break;
      case 'st': {       // a phone reports its own car: relay to everybody else (only for the car that belongs to it)
        const mine = this.phase === 'racing' && this.roster.find((c) => c.playerId === playerId);
        if (mine && m.a[0] === mine.carId) this.send({ except: playerId }, { t: 'st', a: m.a });
        break;
      }
      case 'bots': {     // the host reports the bots
        if (this.phase !== 'racing' || playerId !== this.hostId) break;
        const botIds = new Set(this.roster.filter((c) => c.kind === 'bot').map((c) => c.carId));
        const list = m.a.filter((a) => botIds.has(a[0]));
        if (list.length) this.send({ except: playerId }, { t: 'bots', a: list });
        break;
      }
      case 'item': {      // an item used by a car this phone owns (a human's own car, or a bot when it is the host): relay it
        if (this.ownsCar(playerId, m.c)) this.send({ except: playerId }, { t: 'item', ...m });
        break;
      }
      case 'ehit': if (this.phase === 'racing') this.send({ except: playerId }, { t: 'ehit', e: m.e }); break;
      case 'box_take': {  // first come, first served: the room decides who got the box
        if (this.phase !== 'racing' || !this.ownsCar(playerId, m.c)) break;
        if (now < (this.boxLock.get(m.b) || 0)) { this.send(playerId, { t: 'box', b: m.b, c: m.c, ok: false }); break; }
        this.boxLock.set(m.b, now + ROOM.BOX_LOCK_MS);
        this.send('all', { t: 'box', b: m.b, c: m.c, ok: true });
        break;
      }
      case 'prog': if (p.inRace && this.phase === 'racing') p.progress = Math.max(p.progress, m.s); break;
      case 'finish':
        if (p.inRace && this.phase === 'racing' && !p.finish) {
          p.finish = { raceTime: m.raceTime };
          if (this.firstFinishAt == null) this.firstFinishAt = now;
          this.maybeEndRace(now);
        }
        break;
      default: break;
    }
  }

  /* ---------- timers ---------- */
  /** The lobby countdown runs while 4+ people are connected in the lobby. */
  refreshTimer(now) {
    if (this.phase !== 'lobby') { this.timerEnd = null; return; }
    const enough = this.connected().length >= ROOM.MIN_FOR_TIMER;
    if (enough && this.timerEnd == null) this.timerEnd = now + this.lobbyTimerMs;
    else if (!enough) this.timerEnd = null;
  }

  tick(now) {
    if (this.closed) return;
    for (const p of [...this.players.values()]) {
      if (!p.connected && p.goneAt != null && now - p.goneAt >= ROOM.RECONNECT_MS) this.remove(p.id, now);
    }
    if (this.phase === 'lobby' && this.timerEnd != null && now >= this.timerEnd) this.startRace(now, false);
    else if (this.phase === 'racing') this.maybeEndRace(now);
    else if (this.phase === 'results' && now >= this.resultsEnd) this.backToLobby(now);
    if (this.connected().length === 0) {
      if (this.emptySince == null) this.emptySince = now;
      if (now - this.emptySince >= ROOM.EMPTY_CLOSE_MS) { this.closed = true; this.players.clear(); }
    }
  }

  /** Next time tick() has something to do (the Durable Object sets an alarm for it). null = nothing scheduled. */
  nextWakeup() {
    const t = [];
    if (this.phase === 'lobby' && this.timerEnd != null) t.push(this.timerEnd);
    if (this.phase === 'results') t.push(this.resultsEnd);
    if (this.phase === 'racing') {
      t.push(this.goAt + ROOM.RACE_MAX_MS);
      if (this.firstFinishAt != null) t.push(this.firstFinishAt + ROOM.FIRST_FINISH_GRACE_MS);
    }
    for (const p of this.players.values()) if (!p.connected && p.goneAt != null) t.push(p.goneAt + ROOM.RECONNECT_MS);
    if (this.connected().length === 0 && this.emptySince != null) t.push(this.emptySince + ROOM.EMPTY_CLOSE_MS);
    return t.length ? Math.min(...t) : null;
  }

  /* ---------- race ---------- */
  startRace(now, forced) {
    const humans = this.connected().filter((p) => p.calibrated).sort((a, b) => a.joinedAt - b.joinedAt || a.id - b.id).slice(0, ROOM.MAX_PLAYERS);
    if (!humans.length) {                       // nobody is ready (still calibrating): wait a little
      this.timerEnd = forced ? null : now + ROOM.CALIB_RETRY_MS;
      if (forced) this.send(this.hostId, { t: 'error', code: 'nobody_ready' });
      return;
    }
    this.raceNo++;
    this.seed = ((Math.random() * 1e9) | 0) + 1;
    const rng = createRng(this.seed);
    const slots = [0, 1, 2, 3, 4, 5];
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    this.roster = humans.map((p, i) => ({ carId: i, kind: 'human', playerId: p.id, name: p.name, color: p.color, slot: slots[i] }));
    const usedColors = new Set(humans.map((p) => p.color));
    const colors = PLAYER_COLORS.filter((c) => !usedColors.has(c));
    const names = [...BOT_NAMES]; for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    const bots = Math.max(0, ROOM.TARGET_CARS - humans.length);
    for (let b = 0; b < bots; b++) {
      const i = humans.length + b;
      this.roster.push({ carId: i, kind: 'bot', name: names[b], color: colors[b % colors.length], slot: slots[i] });
    }
    for (const p of this.players.values()) { p.inRace = humans.includes(p); p.finish = null; p.progress = 0; }
    this.phase = 'racing'; this.timerEnd = null; this.firstFinishAt = null; this.boxLock = new Map();
    this.goAt = now + ROOM.GO_DELAY_MS;
    for (const p of this.players.values()) this.send(p.id, p.inRace ? this.raceStartMsg() : { ...this.raceStartMsg(), spectator: true });
    this.pushRoom();
  }

  raceStartMsg() {
    return { t: 'race_start', raceNo: this.raceNo, seed: this.seed, roster: this.roster, goAt: this.goAt, hostId: this.hostId };
  }

  maybeEndRace(now) {
    if (this.phase !== 'racing') return;
    const racers = [...this.players.values()].filter((p) => p.inRace);
    const waiting = racers.filter((p) => p.connected && !p.finish);
    const timeUp = now >= this.goAt + ROOM.RACE_MAX_MS || (this.firstFinishAt != null && now >= this.firstFinishAt + ROOM.FIRST_FINISH_GRACE_MS);
    if (waiting.length === 0 || timeUp) this.endRace(now);
  }

  endRace(now) {
    const racers = [...this.players.values()].filter((p) => p.inRace);
    const fin = racers.filter((p) => p.finish).sort((a, b) => a.finish.raceTime - b.finish.raceTime);
    const rest = racers.filter((p) => !p.finish).sort((a, b) => b.progress - a.progress);
    const order = [...fin.map((p) => ({ p, finished: true })), ...rest.map((p) => ({ p, finished: false }))];
    const pts = awardPoints(order.map((o) => ({ token: o.p.token, finished: o.finished })));
    order.forEach((o, i) => {
      const s = this.scores.get(o.p.token) || { name: o.p.name, color: o.p.color, points: 0, wins: 0, races: 0 };
      s.name = o.p.name; s.color = o.p.color; s.points += pts.get(o.p.token); s.races++; if (i === 0 && o.finished) s.wins++;
      this.scores.set(o.p.token, s);
    });
    this.phase = 'results'; this.resultsEnd = now + ROOM.RESULTS_MS;
    this.send('all', { t: 'results', raceNo: this.raceNo, order: order.map((o, i) => ({ id: o.p.id, name: o.p.name, color: o.p.color, raceTime: o.finished ? o.p.finish.raceTime : null, points: pts.get(o.p.token), place: i + 1 })), scores: scoreTable(this.scores) });
    this.pushRoom();
  }

  backToLobby(now) {
    this.phase = 'lobby'; this.resultsEnd = null; this.roster = [];
    for (const p of this.players.values()) { p.inRace = false; p.finish = null; p.calibrated = false; }   // the direction is measured again before every race (direction contract)
    this.refreshTimer(now);
    this.pushRoom();
  }

  /* ---------- broadcast + persistence ---------- */
  pushRoom() {
    this.send('all', {
      t: 'room', code: this.code, phase: this.phase, hostId: this.hostId, raceNo: this.raceNo, timerEnd: this.timerEnd,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, calibrated: p.calibrated, inRace: p.inRace })),
      scores: scoreTable(this.scores),
    });
  }

  snapshot() {
    const { code, lobbyTimerMs, phase, hostId, nextId, raceNo, seed, goAt, timerEnd, resultsEnd, firstFinishAt, emptySince, closed, roster } = this;
    return { code, lobbyTimerMs, phase, hostId, nextId, raceNo, seed, goAt, timerEnd, resultsEnd, firstFinishAt, emptySince, closed, roster,
      players: [...this.players.values()], scores: [...this.scores.entries()] };
  }
  static restore(s) {
    const r = new RoomCore({ code: s.code, lobbyTimerMs: s.lobbyTimerMs });
    Object.assign(r, { phase: s.phase, hostId: s.hostId, nextId: s.nextId, raceNo: s.raceNo, seed: s.seed, goAt: s.goAt, timerEnd: s.timerEnd, resultsEnd: s.resultsEnd, firstFinishAt: s.firstFinishAt, emptySince: s.emptySince, closed: s.closed, roster: s.roster });
    r.players = new Map(s.players.map((p) => [p.id, p]));
    r.scores = new Map(s.scores);
    return r;
  }
}
