// Browser side of the room connection: WebSocket with automatic reconnect (same token = same player) and a server-clock offset.
import { PROTOCOL_VERSION } from './protocol.js';

/** Where the room server lives: ?server=... (testing) > VITE_ROOMS_URL (set by the deploy) > nothing (online play hidden). */
export function roomsUrl(params = new URLSearchParams(location.search)) {
  const u = params.get('server') || import.meta.env?.VITE_ROOMS_URL || '';
  return u.replace(/\/+$/, '');
}
const wsUrl = (http, code) => http.replace(/^http/, 'ws') + `/rooms/${code}/ws`;

export function tokenFor(code) {
  const key = 'dongame.tok.' + code;
  try {
    let t = sessionStorage.getItem(key);
    if (!t) { t = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()).replace(/-/g, ''); sessionStorage.setItem(key, t); }
    return t;
  } catch { return (crypto.randomUUID?.() || 'tok' + Math.random().toString(36).slice(2) + Date.now()).replace(/-/g, ''); }
}

export async function createRoom(base) {
  const r = await fetch(base + '/rooms', { method: 'POST' });
  if (!r.ok) throw new Error('create_failed');
  return (await r.json()).code;
}
export async function roomInfo(base, code) {
  try { return await (await fetch(`${base}/rooms/${code}`)).json(); } catch { return null; }
}

export class NetClient {
  /** handlers: onMessage(msg), onStatus('connecting'|'online'|'reconnecting'|'closed'), onFatal(code) */
  constructor({ base, code, profile, handlers }) {
    this.base = base; this.code = code; this.profile = profile; this.h = handlers;
    this.token = tokenFor(code); this.ws = null; this.attempt = 0; this.stopped = false; this.offset = 0; this.rtt = null; this.samples = [];
    this.you = null; this.pingN = 0;
    this.onVisible = () => { if (!document.hidden && !this.stopped && (!this.ws || this.ws.readyState > 1)) this.connect(); };
    document.addEventListener('visibilitychange', this.onVisible);
  }

  connect() {
    if (this.stopped) return;
    clearTimeout(this.retryT);
    this.h.onStatus(this.attempt ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket(wsUrl(this.base, this.code)); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.send({ t: 'hello', v: PROTOCOL_VERSION, token: this.token, name: this.profile.name, color: this.profile.color });
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') { this.you = m.you; this.h.onStatus('online'); this.startPing(); }
      else if (m.t === 'pong') this.onPong(m);
      else if (m.t === 'error') { this.stopped = true; this.h.onFatal(m.code); return; }
      this.h.onMessage(m);
    };
    ws.onclose = () => { clearInterval(this.pingT); if (!this.stopped) this.scheduleRetry(); };
    ws.onerror = () => { /* onclose follows */ };
  }

  scheduleRetry() {
    this.attempt++;
    this.h.onStatus('reconnecting');
    if (this.attempt > 12) { this.stopped = true; this.h.onFatal('lost'); return; }
    this.retryT = setTimeout(() => this.connect(), Math.min(4000, 500 * 2 ** (this.attempt - 1)));
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  /* clock sync: server time = Date.now() + offset (median of the lowest-RTT samples) */
  startPing() {
    clearInterval(this.pingT);
    this.samples = []; this.pingN = 0;
    for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 150);
    this.pingT = setInterval(() => this.ping(), 5000);
  }
  ping() { this.pingSent = this.pingSent || new Map(); const c = ++this.pingN; this.pingSent.set(c, Date.now()); this.send({ t: 'ping', c }); }
  onPong(m) {
    const t0 = this.pingSent?.get(m.c); if (t0 == null) return;
    const t1 = Date.now(), rtt = t1 - t0;
    this.samples.push({ rtt, offset: m.s - (t0 + rtt / 2) });
    if (this.samples.length > 12) this.samples.shift();
    this.setOffset(this.samples);
  }
  setOffset(samples) { const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5); this.rtt = best[0].rtt; this.offset = best.map((s) => s.offset).sort((a, b) => a - b)[Math.floor(best.length / 2)]; }
  serverNow() { return Date.now() + this.offset; }

  leave() { this.send({ t: 'leave' }); this.close(); }
  close() { this.stopped = true; clearInterval(this.pingT); clearTimeout(this.retryT); document.removeEventListener('visibilitychange', this.onVisible); try { this.ws?.close(); } catch { /* ignore */ } this.h.onStatus('closed'); }
}
