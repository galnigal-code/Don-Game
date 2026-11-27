// Cloudflare Worker: creates rooms and hands WebSocket connections to the room's Durable Object.
import { generateCode, isValidCode } from '../../src/net/room/codes.js';
export { Room } from './RoomDO.js';

const ORIGINS = [/^https:\/\/galnigal-code\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const allowed = (origin) => !origin || ORIGINS.some((r) => r.test(origin));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (!allowed(origin)) return new Response('forbidden', { status: 403 });
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin' } : {};
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...cors } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/rooms' && request.method === 'POST') {
      for (let i = 0; i < 6; i++) {
        const code = generateCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (await stub.init(code)) return json({ code });
      }
      return json({ error: 'busy' }, 503);
    }
    const m = url.pathname.match(/^\/rooms\/([A-Z]{4})(\/ws)?$/);
    if (m && isValidCode(m[1])) {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      if (!m[2] && request.method === 'GET') return json(await stub.info());
      if (m[2] && request.headers.get('Upgrade') === 'websocket') return stub.fetch(request);
    }
    if (url.pathname === '/') return new Response('don-game rooms ok', { headers: cors });
    return new Response('not found', { status: 404, headers: cors });
  },
};
