// Local room server: the same RoomCore/RoomHost as the Cloudflare Durable Object, over plain Node + ws.
//   npm run dev:server           (port 8787)
//   PORT=9000 DELAY_MS=120 LOBBY_TIMER_MS=3000 node tools/dev-server.mjs   (test options)
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { RoomCore } from '../src/net/room/RoomCore.js';
import { RoomHost } from '../src/net/room/RoomHost.js';
import { generateCode, isValidCode } from '../src/net/room/codes.js';

export function startDevServer({ port = Number(process.env.PORT) || 8787, delayMs = Number(process.env.DELAY_MS) || 0, lobbyTimerMs = Number(process.env.LOBBY_TIMER_MS) || undefined, quiet = false } = {}) {
  const rooms = new Map();                        // code -> { core, host, sockets: Map(connId -> ws) }
  let nextConn = 1;
  const later = (fn) => (delayMs ? setTimeout(fn, Math.max(0, delayMs + (Math.random() - 0.5) * delayMs / 2)) : fn());

  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
    const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.url === '/rooms' && req.method === 'POST') {
      let code; do { code = generateCode(); } while (rooms.has(code));
      create(code); return json({ code });
    }
    const m = req.url.match(/^\/rooms\/([A-Z]{4})$/);
    if (m && req.method === 'GET') { const r = rooms.get(m[1]); return json(r && !r.core.closed ? { exists: true, players: r.core.players.size, phase: r.core.phase, full: r.core.players.size >= 6 } : { exists: false }); }
    res.writeHead(404, cors); res.end('not found');
  });

  function create(code) {
    const core = new RoomCore({ code, now: Date.now(), lobbyTimerMs });
    const sockets = new Map();
    const host = new RoomHost(core, {
      send: (id, text) => { const ws = sockets.get(id); if (ws && ws.readyState === 1) later(() => ws.readyState === 1 && ws.send(text)); },
      close: (id, c, why) => { const ws = sockets.get(id); if (ws) try { ws.close(c, why); } catch { /* closed */ } },
    });
    rooms.set(code, { core, host, sockets });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const m = req.url.match(/^\/rooms\/([A-Z]{4})\/ws/);
    const r = m && isValidCode(m[1]) ? rooms.get(m[1]) : null;
    if (!r || r.core.closed) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const id = `c${nextConn++}`;
      r.sockets.set(id, ws); r.host.open(id);
      ws.on('message', (d) => later(() => r.host.message(id, d.toString(), Date.now())));
      ws.on('close', () => { r.sockets.delete(id); r.host.close(id, Date.now()); });
    });
  });

  const timer = setInterval(() => {
    for (const [code, r] of rooms) { r.host.tick(Date.now()); if (r.core.closed) rooms.delete(code); }
  }, 200);

  return new Promise((resolve) => server.listen(port, () => {
    if (!quiet) console.log(`room server on http://localhost:${port}${delayMs ? ` (latency ~${delayMs} ms)` : ''}`);
    resolve({ port, rooms, close: () => new Promise((done) => { clearInterval(timer); for (const r of rooms.values()) for (const ws of r.sockets.values()) ws.terminate(); wss.close(); server.close(() => done()); }) });
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) startDevServer();
