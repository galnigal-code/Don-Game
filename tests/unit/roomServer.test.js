// Integration: the real dev server (same RoomCore/RoomHost as production) with real WebSockets.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startDevServer } from '../../tools/dev-server.mjs';
import { PROTOCOL_VERSION } from '../../src/net/protocol.js';

let srv, base;
beforeAll(async () => { srv = await startDevServer({ port: 0 + 18800 + Math.floor(Math.random() * 500), lobbyTimerMs: 400, quiet: true }); base = `http://localhost:${srv.port}`; });
afterAll(async () => { await srv.close(); });

async function client(code, n, color = 0xd0201c) {
  const ws = new WebSocket(`ws://localhost:${srv.port}/rooms/${code}/ws`);
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const send = (o) => ws.send(JSON.stringify(o));
  send({ t: 'hello', v: PROTOCOL_VERSION, token: `token-${code}-${n}-xxxx`, name: 'P' + n, color });
  const wait = async (pred, ms = 3000) => { const t0 = Date.now(); for (;;) { const m = msgs.find(pred); if (m) return m; if (Date.now() - t0 > ms) throw new Error('timeout waiting; got ' + msgs.map((x) => x.t).join(',')); await new Promise((r) => setTimeout(r, 15)); } };
  return { ws, msgs, send, wait };
}
const create = async () => (await (await fetch(`${base}/rooms`, { method: 'POST' })).json()).code;

describe('room server (real sockets)', () => {
  it('creates a room, 4 friends join, the timer starts the race, results return to the lobby', async () => {
    const code = await create();
    expect(code).toMatch(/^[A-Z]{4}$/);
    expect((await (await fetch(`${base}/rooms/${code}`)).json()).exists).toBe(true);
    const cs = [];
    for (let i = 1; i <= 4; i++) cs.push(await client(code, i, [0xd0201c, 0xf5c400, 0x1e6fff, 0x18b04a][i - 1]));
    for (const c of cs) { await c.wait((m) => m.t === 'welcome'); c.send({ t: 'calibrated' }); }
    const start = await cs[3].wait((m) => m.t === 'race_start');
    expect(start.roster.length).toBe(4); expect(start.roster.every((c) => c.kind === 'human')).toBe(true);
    for (const [i, c] of cs.entries()) c.send({ t: 'finish', raceTime: 80 + i });
    const res = await cs[0].wait((m) => m.t === 'results');
    expect(res.order[0].points).toBe(10);
    for (const c of cs) c.ws.close();
  });
  it('unknown room: 404 info and refused socket', async () => {
    expect((await (await fetch(`${base}/rooms/ZZZZ`)).json()).exists).toBe(false);
    await expect(client('ZZZZ', 1)).rejects.toBeTruthy();
  });
  it('7th player gets room_full', async () => {
    const code = await create(); const cs = [];
    for (let i = 1; i <= 6; i++) { const c = await client(code, i, 0xd0201c); await c.wait((m) => m.t === 'welcome'); cs.push(c); }
    const c7 = await client(code, 7); const err = await c7.wait((m) => m.t === 'error');
    expect(err.code).toBe('room_full');
    for (const c of [...cs, c7]) c.ws.close();
  });
  it('a dropped player reconnects as the same player', async () => {
    const code = await create(); const a = await client(code, 1), b = await client(code, 2);
    const wb = await b.wait((m) => m.t === 'welcome'); await a.wait((m) => m.t === 'welcome');
    b.ws.close(); await new Promise((r) => setTimeout(r, 100));
    const b2 = await client(code, 2); const w2 = await b2.wait((m) => m.t === 'welcome');
    expect(w2.you).toBe(wb.you);
    a.ws.close(); b2.ws.close();
  });
  it('garbage and oversized messages do not crash the room', async () => {
    const code = await create(); const a = await client(code, 1); await a.wait((m) => m.t === 'welcome');
    a.ws.send('not json'); a.ws.send('x'.repeat(5000)); a.send({ t: 'nope' });
    a.send({ t: 'ping', c: 5 }); await a.wait((m) => m.t === 'pong'); a.ws.close();
  });
});
