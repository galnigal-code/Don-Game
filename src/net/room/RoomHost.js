// Glue between sockets and RoomCore. Knows nothing about Cloudflare or Node: the caller supplies
//   io = { send(connId, text), close(connId, code, reason) }
// Used identically by the Durable Object and the local dev server.
import { parseClientMessage } from '../protocol.js';

const MAX_MSGS_PER_SEC = 60;

export class RoomHost {
  constructor(core, io) {
    this.core = core; this.io = io;
    this.conn = new Map();        // connId -> { playerId|null, count, windowStart }
    this.byPlayer = new Map();    // playerId -> connId
    this.changed = false;         // set when something worth persisting happened
  }

  /** Re-attach a connection after the Durable Object woke up from hibernation. */
  restore(connId, playerId) {
    this.conn.set(connId, { playerId, count: 0, windowStart: 0 });
    if (playerId != null) this.byPlayer.set(playerId, connId);
  }
  open(connId) { this.conn.set(connId, { playerId: null, count: 0, windowStart: 0 }); }

  message(connId, raw, now) {
    const c = this.conn.get(connId);
    if (!c) return;
    if (now - c.windowStart > 1000) { c.windowStart = now; c.count = 0; }
    if (++c.count > MAX_MSGS_PER_SEC) { this.io.close(connId, 1008, 'rate'); return; }
    const m = parseClientMessage(raw);
    if (!m) return;                                   // garbage is ignored, never fatal
    if (c.playerId == null) {
      if (m.t !== 'hello') return;
      const res = this.core.join(m, now);
      if (res.error) { this.io.send(connId, JSON.stringify({ t: 'error', code: res.error })); this.io.close(connId, 1000, res.error); this.flush(); return; }
      const prevConn = this.byPlayer.get(res.playerId);
      c.playerId = res.playerId; this.byPlayer.set(res.playerId, connId);
      if (prevConn != null && prevConn !== connId) { this.conn.delete(prevConn); this.io.close(prevConn, 1000, 'replaced'); }
    } else if (m.t === 'hello') return;
    else this.core.onMessage(c.playerId, m, now);
    this.flush();
  }

  close(connId, now) {
    const c = this.conn.get(connId);
    this.conn.delete(connId);
    if (!c || c.playerId == null) return;
    if (this.byPlayer.get(c.playerId) !== connId) return;      // it was replaced by a newer connection
    this.byPlayer.delete(c.playerId);
    this.core.disconnect(c.playerId, now);
    this.flush();
  }

  tick(now) { this.core.tick(now); this.flush(); }

  flush() {
    for (const { to, msg } of this.core.drain()) {
      if (msg.t === 'room' || msg.t === 'results' || msg.t === 'race_start') this.changed = true;
      const text = JSON.stringify(msg);
      if (to === 'all') { for (const [, connId] of this.byPlayer) this.io.send(connId, text); }
      else if (to && typeof to === 'object') { for (const [pid, connId] of this.byPlayer) if (pid !== to.except) this.io.send(connId, text); }
      else { const connId = this.byPlayer.get(to); if (connId != null) this.io.send(connId, text); }
    }
  }
}
