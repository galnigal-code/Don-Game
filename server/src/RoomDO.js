// One Durable Object = one room. Uses the WebSocket Hibernation API, so a quiet room costs nothing.
import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from '../../src/net/room/RoomCore.js';
import { RoomHost } from '../../src/net/room/RoomHost.js';

let nextConn = 1;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = null; this.host = null;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const snap = await ctx.storage.get('room');
      if (snap) this.setup(RoomCore.restore(snap));
    });
  }

  setup(core) {
    this.core = core;
    this.socketIds = new Map();           // WebSocket -> connId
    this.host = new RoomHost(core, {
      send: (connId, text) => { const ws = this.sockOf(connId); if (ws) try { ws.send(text); } catch { /* closing */ } },
      close: (connId, code, reason) => { const ws = this.sockOf(connId); if (ws) try { ws.close(code, reason); } catch { /* closed */ } },
    });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      const id = a.connId ?? `c${nextConn++}`;
      this.socketIds.set(ws, id); this.host.restore(id, a.playerId ?? null);
    }
  }
  sockOf(connId) { for (const [ws, id] of this.socketIds) if (id === connId) return ws; return null; }

  /** RPC from the Worker: claim this code for a new room. */
  async init(code) {
    await this.ready;
    if (this.core && !this.core.closed) return false;
    this.setup(new RoomCore({ code, now: Date.now() }));
    await this.save();
    return true;
  }
  async info() {
    await this.ready;
    if (!this.core || this.core.closed) return { exists: false };
    return { exists: true, players: this.core.players.size, phase: this.core.phase, full: this.core.players.size >= 6 };
  }

  async fetch(request) {
    await this.ready;
    if (!this.core || this.core.closed) return new Response('no room', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const id = `c${nextConn++}`;
    server.serializeAttachment({ connId: id, playerId: null });
    this.socketIds.set(server, id); this.host.open(id);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    await this.ready;
    if (!this.core) return;
    const id = this.socketIds.get(ws);
    if (!id) return;
    this.host.message(id, typeof data === 'string' ? data : '', Date.now());
    const c = this.host.conn.get(id);
    if (c) ws.serializeAttachment({ connId: id, playerId: c.playerId });
    await this.after();
  }
  async webSocketClose(ws) { await this.ready; if (!this.core) return; const id = this.socketIds.get(ws); this.socketIds.delete(ws); if (id) this.host.close(id, Date.now()); await this.after(); }
  async webSocketError(ws) { await this.webSocketClose(ws); }
  async alarm() { await this.ready; if (!this.core) return; this.host.tick(Date.now()); await this.after(); }

  /** Persist if needed and schedule the next alarm. */
  async after() {
    if (this.core.closed) { await this.ctx.storage.deleteAll(); this.core = null; return; }
    if (this.host.changed) { this.host.changed = false; await this.save(); }
    const at = this.core.nextWakeup();
    if (at != null) await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 50));
  }
  async save() { await this.ctx.storage.put('room', this.core.snapshot()); }
}
