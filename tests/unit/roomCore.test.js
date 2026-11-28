import { describe, it, expect } from 'vitest';
import { RoomCore, ROOM, PLAYER_COLORS } from '../../src/net/room/RoomCore.js';
import { PROTOCOL_VERSION } from '../../src/net/protocol.js';

const hello = (n, color = PLAYER_COLORS[0], v = PROTOCOL_VERSION) => ({ t: 'hello', v, token: 'token-' + n + '-xxxxxxxx', name: 'P' + n, color });
function room(n = 0, opts) {
  const r = new RoomCore({ code: 'KRTM', now: 0, ...opts });
  const ids = [];
  for (let i = 1; i <= n; i++) ids.push(r.join(hello(i, PLAYER_COLORS[i - 1]), i * 10).playerId);
  r.drain();
  return { r, ids };
}
const ready = (r, ids, now = 100) => { for (const id of ids) r.onMessage(id, { t: 'calibrated' }, now); r.drain(); };
const sent = (r, type) => r.drain().filter((o) => o.msg.t === type);

describe('RoomCore: joining', () => {
  it('first player is the host', () => { const { r, ids } = room(2); expect(r.hostId).toBe(ids[0]); });
  it('duplicate colour is replaced by a free one', () => {
    const r = new RoomCore({ code: 'KRTM' });
    const a = r.join(hello(1, PLAYER_COLORS[2]), 0).playerId, b = r.join(hello(2, PLAYER_COLORS[2]), 1).playerId;
    expect(r.players.get(a).color).toBe(PLAYER_COLORS[2]);
    expect(r.players.get(b).color).not.toBe(PLAYER_COLORS[2]);
    expect(PLAYER_COLORS).toContain(r.players.get(b).color);
  });
  it('bad names are cleaned', () => { const r = new RoomCore({ code: 'KRTM' }); const id = r.join({ ...hello(1), name: '  fuck  ' }, 0).playerId; expect(r.players.get(id).name).toBe('שחקן'); });
  it('the 7th player is refused', () => {
    const { r } = room(6);
    expect(r.join(hello(7), 99)).toEqual({ error: 'room_full' });
  });
  it('wrong protocol version asks for an update', () => { const r = new RoomCore({ code: 'KRTM' }); expect(r.join(hello(1, 1, 999), 0)).toEqual({ error: 'update' }); });
  it('the same token reconnects as the same player', () => {
    const { r, ids } = room(2);
    r.disconnect(ids[1], 1000);
    const back = r.join(hello(2), 5000).playerId;
    expect(back).toBe(ids[1]); expect(r.players.size).toBe(2); expect(r.players.get(back).connected).toBe(true);
  });
  it('reconnecting after the window means the player was removed (new player, same scores token)', () => {
    const { r, ids } = room(2);
    r.disconnect(ids[1], 1000); r.tick(1000 + ROOM.RECONNECT_MS);
    expect(r.players.has(ids[1])).toBe(false);
  });
});

describe('RoomCore: host', () => {
  it('moves to the oldest connected player when the host leaves', () => {
    const { r, ids } = room(3);
    r.onMessage(ids[0], { t: 'leave' }, 500);
    expect(r.hostId).toBe(ids[1]);
  });
  it('moves when the host disconnects', () => { const { r, ids } = room(3); r.disconnect(ids[0], 500); expect(r.hostId).toBe(ids[1]); });
  it('only the host can start now', () => {
    const { r, ids } = room(2); ready(r, ids);
    r.onMessage(ids[1], { t: 'start_now' }, 200); expect(r.phase).toBe('lobby');
    r.onMessage(ids[0], { t: 'start_now' }, 200); expect(r.phase).toBe('racing');
  });
});

describe('RoomCore: lobby timer', () => {
  it('starts at 4 players, stops at 3, resumes at 4', () => {
    const { r, ids } = room(3);
    expect(r.timerEnd).toBeNull();
    const d = r.join(hello(4, PLAYER_COLORS[3]), 1000).playerId;
    expect(r.timerEnd).toBe(1000 + ROOM.LOBBY_TIMER_MS);
    r.disconnect(d, 2000); expect(r.timerEnd).toBeNull();
    r.join(hello(4), 3000); expect(r.timerEnd).toBe(3000 + ROOM.LOBBY_TIMER_MS);
  });
  it('starts the race when it runs out', () => {
    const { r, ids } = room(4); ready(r, ids);
    r.tick(r.timerEnd - 1); expect(r.phase).toBe('lobby');
    r.tick(r.timerEnd); expect(r.phase).toBe('racing');
  });
  it('waits when nobody finished calibrating', () => {
    const { r } = room(4);
    r.tick(r.timerEnd); expect(r.phase).toBe('lobby'); expect(r.timerEnd).toBeGreaterThan(0);
  });
});

describe('RoomCore: race start', () => {
  for (const humans of [1, 2, 3, 4, 5, 6]) {
    it(`${humans} human(s): ${Math.max(0, 4 - humans)} bot(s), ${Math.max(4, humans)} cars, unique slots and colours`, () => {
      const { r, ids } = room(humans); ready(r, ids);
      r.onMessage(ids[0], { t: 'start_now' }, 200);
      expect(r.roster.length).toBe(Math.max(4, humans));
      expect(r.roster.filter((c) => c.kind === 'bot').length).toBe(Math.max(0, 4 - humans));
      expect(new Set(r.roster.map((c) => c.slot)).size).toBe(r.roster.length);
      expect(new Set(r.roster.map((c) => c.color)).size).toBe(r.roster.length);
      const starts = sent(r, 'race_start'); expect(starts.length).toBe(humans);
      expect(starts[0].msg.goAt).toBe(200 + ROOM.GO_DELAY_MS);
    });
  }
  it('an uncalibrated player watches this race', () => {
    const { r, ids } = room(3); ready(r, ids.slice(0, 2));
    r.onMessage(ids[0], { t: 'start_now' }, 200);
    expect(r.roster.filter((c) => c.kind === 'human').length).toBe(2);
    const out = r.drain().filter((o) => o.msg.t === 'race_start' && o.to === ids[2]);
    expect(out[0].msg.spectator).toBe(true);
  });
  it('someone joining mid-race is a spectator and plays the next race', () => {
    const { r, ids } = room(2); ready(r, ids);
    r.onMessage(ids[0], { t: 'start_now' }, 200); r.drain();
    const late = r.join(hello(3, PLAYER_COLORS[2]), 5000).playerId;
    const out = r.drain().find((o) => o.msg.t === 'race_start' && o.to === late);
    expect(out.msg.spectator).toBe(true); expect(r.players.get(late).inRace).toBe(false);
  });
});

describe('RoomCore: finishing and scores', () => {
  function race(n) { const { r, ids } = room(n); ready(r, ids); r.onMessage(ids[0], { t: 'start_now' }, 200); r.drain(); return { r, ids }; }
  it('ends when every connected racer finished; points 10/7/5, bots not counted', () => {
    const { r, ids } = race(3);
    r.onMessage(ids[2], { t: 'finish', raceTime: 80 }, 90000);
    r.onMessage(ids[0], { t: 'finish', raceTime: 85 }, 91000);
    expect(r.phase).toBe('racing');
    r.onMessage(ids[1], { t: 'finish', raceTime: 99 }, 92000);
    expect(r.phase).toBe('results');
    const res = r.drain().find((o) => o.msg.t === 'results').msg;
    expect(res.order.map((o) => o.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(res.order.map((o) => o.points)).toEqual([10, 7, 5]);
    expect(res.scores[0].points).toBe(10);
  });
  it('ends 25 s after the first finish; unfinished players rank by progress and get 0', () => {
    const { r, ids } = race(3);
    r.onMessage(ids[1], { t: 'prog', s: 500 }, 1000); r.onMessage(ids[2], { t: 'prog', s: 900 }, 1000);
    r.onMessage(ids[0], { t: 'finish', raceTime: 80 }, 90000);
    r.tick(90000 + ROOM.FIRST_FINISH_GRACE_MS - 1); expect(r.phase).toBe('racing');
    r.tick(90000 + ROOM.FIRST_FINISH_GRACE_MS); expect(r.phase).toBe('results');
    const res = r.drain().find((o) => o.msg.t === 'results').msg;
    expect(res.order.map((o) => o.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect(res.order.map((o) => o.points)).toEqual([10, 0, 0]);
  });
  it('hard stop 150 s after GO', () => { const { r } = race(2); r.tick(200 + ROOM.GO_DELAY_MS + ROOM.RACE_MAX_MS); expect(r.phase).toBe('results'); });
  it('a racer who disconnected does not block the end', () => {
    const { r, ids } = race(2);
    r.disconnect(ids[1], 5000); r.onMessage(ids[0], { t: 'finish', raceTime: 80 }, 90000);
    expect(r.phase).toBe('results');
  });
  it('returns to the lobby with the same code, scores kept, calibration kept (nobody calibrates between races)', () => {
    const { r, ids } = race(2);
    r.onMessage(ids[0], { t: 'finish', raceTime: 80 }, 90000); r.onMessage(ids[1], { t: 'finish', raceTime: 85 }, 90000);
    r.tick(90000 + ROOM.RESULTS_MS);
    expect(r.phase).toBe('lobby'); expect(r.code).toBe('KRTM');
    expect([...r.players.values()].every((p) => p.calibrated)).toBe(true);
    expect(r.scores.get(r.players.get(ids[0]).token).points).toBe(10);
    r.onMessage(ids[0], { t: 'start_now' }, 100000);      // no `ready()` here: they are still calibrated
    expect(r.phase).toBe('racing'); expect(r.raceNo).toBe(2);
  });
  it('points add up over races', () => {
    const { r, ids } = race(2);
    for (let k = 0; k < 2; k++) {
      r.onMessage(ids[0], { t: 'finish', raceTime: 80 }, 90000 + k * 1e6); r.onMessage(ids[1], { t: 'finish', raceTime: 85 }, 90000 + k * 1e6);
      r.tick(90000 + k * 1e6 + ROOM.RESULTS_MS); ready(r, ids, 1e5 + k * 1e6); r.onMessage(ids[0], { t: 'start_now' }, 1e5 + k * 1e6);
    }
    expect(r.scores.get(r.players.get(ids[0]).token)).toMatchObject({ points: 20, wins: 2, races: 2 });
  });
});

describe('RoomCore: misc', () => {
  it('emoji is rate limited', () => {
    const { r, ids } = room(2);
    r.onMessage(ids[0], { t: 'emoji', e: '🔥' }, 1000); r.onMessage(ids[0], { t: 'emoji', e: '😂' }, 1500); r.onMessage(ids[0], { t: 'emoji', e: '👋' }, 1000 + ROOM.EMOJI_COOLDOWN_MS);
    expect(sent(r, 'emoji').length).toBe(2);
  });
  it('ping is answered with the server time', () => { const { r, ids } = room(1); r.onMessage(ids[0], { t: 'ping', c: 7 }, 1234); expect(sent(r, 'pong')[0].msg).toEqual({ t: 'pong', c: 7, s: 1234 }); });
  it('an empty room closes after 10 minutes', () => {
    const { r, ids } = room(2); r.disconnect(ids[0], 1000); r.disconnect(ids[1], 2000);
    r.tick(2000 + ROOM.EMPTY_CLOSE_MS - 1); expect(r.closed).toBe(false);
    r.tick(2000 + ROOM.EMPTY_CLOSE_MS); expect(r.closed).toBe(true);
    expect(r.join(hello(9), 3e6)).toEqual({ error: 'no_room' });
  });
  it('snapshot/restore round trips (Durable Object hibernation)', () => {
    const { r, ids } = room(4); ready(r, ids); r.onMessage(ids[0], { t: 'start_now' }, 200);
    const back = RoomCore.restore(JSON.parse(JSON.stringify(r.snapshot())));
    expect(back.snapshot()).toEqual(r.snapshot());
    back.onMessage(ids[0], { t: 'finish', raceTime: 70 }, 5000); expect(back.players.get(ids[0]).finish.raceTime).toBe(70);
  });
  it('nextWakeup points at the lobby timer', () => { const { r } = room(4); expect(r.nextWakeup()).toBe(r.timerEnd); });
});
