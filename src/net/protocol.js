// Wire protocol between the game (client) and the room server. JSON messages: { t: <type>, ... }.
export const PROTOCOL_VERSION = 2;       // 2: the room has a track (V5)
export const MAX_MESSAGE_BYTES = 1024;     // the biggest message is `bots` (3 cars, about 200 bytes)
export const EMOJIS = ['😂', '🔥', '😡', '👋'];

import { isCarArray } from './carState.js';
import { isTrackId } from '../sim/tracks/index.js';
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, max) => typeof v === 'string' && v.length <= max;

/** Client -> server messages the room accepts, with their field checks. */
const CLIENT = {
  hello: (m) => num(m.v) && str(m.token, 64) && m.token.length >= 8 && str(m.name, 40) && Number.isInteger(m.color),
  ping: (m) => num(m.c),
  calibrated: () => true,
  start_now: () => true,
  leave: () => true,
  emoji: (m) => EMOJIS.includes(m.e),
  st: (m) => isCarArray(m.a),
  bots: (m) => Array.isArray(m.a) && m.a.length >= 1 && m.a.length <= 5 && m.a.every(isCarArray),
  item: (m) => ['mine', 'oil', 'barrel', 'missile', 'gun'].includes(m.k) && Number.isInteger(m.c) && (m.k === 'gun' || (str(m.id, 16) && num(m.s) && num(m.d) && Number.isInteger(m.tg))) && (m.rt === undefined || num(m.rt)),
  ehit: (m) => str(m.e, 16) && m.e.length > 0,
  box_take: (m) => Number.isInteger(m.b) && Number.isInteger(m.c),
  track: (m) => isTrackId(m.id),
  prog: (m) => num(m.s),
  finish: (m) => num(m.raceTime) && m.raceTime >= 0 && m.raceTime < 3600,
};

/** Parse + validate a raw client message. Returns the message object, or null if it must be ignored. */
export function parseClientMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return null;
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  const check = CLIENT[m.t];
  return check && check(m) ? m : null;
}
export const CLIENT_TYPES = Object.keys(CLIENT);
