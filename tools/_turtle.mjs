import { createTrack } from '../src/sim/TrackModel.js';
import { city } from '../src/sim/tracks/city.js';
import sharp from 'sharp';
const rad = (d) => (d * Math.PI) / 180;
// segments: ['S', len] | ['C', radius, turnDeg]  (positive = right turn = clockwise on the map with z down)
function walk(segs, step = 12) {
  let x = 0, z = 0, th = 0; const pts = [{ x, z }];   // th = heading, 0 = +x, turning right increases th (z down)
  for (const [k, a, b] of segs) {
    if (k === 'S') { const n = Math.max(1, Math.round(a / step)); for (let i = 1; i <= n; i++) { x += Math.cos(th) * a / n; z += Math.sin(th) * a / n; pts.push({ x, z }); } }
    else { const n = Math.max(2, Math.round((Math.abs(rad(b)) * a) / step)); const dth = rad(b) / n; for (let i = 1; i <= n; i++) { const mid = th + dth / 2; const ds = Math.abs(a * dth); x += Math.cos(mid) * ds; z += Math.sin(mid) * ds; th += dth; pts.push({ x, z }); } }
  }
  return { pts, x, z, th };
}
const P = { T1: 300, R1: 95, V1: 190, R2: 62, B1: 225, bendR: 260, bendA: 22, R3: 70, R4: 62 };
function make(V2, T2) {
  return [['S', P.T1], ['C', P.R1, 90], ['S', P.V1], ['C', P.R2, 90], ['S', P.B1], ['C', P.bendR, P.bendA], ['C', P.bendR, -P.bendA], ['S', 165], ['C', P.R3, 90], ['S', V2], ['C', P.R4, 90], ['S', T2]];
}
// closure: solve V2 and T2 so that the end returns to the start (x = z = 0, heading = 2*pi)
let V2 = 200, T2 = 200;
for (let it = 0; it < 6; it++) { const r = walk(make(V2, T2)); const ex = r.x, ez = r.z; const r2 = walk(make(V2 + 1, T2)), r3 = walk(make(V2, T2 + 1)); const ax = r2.x - ex, az = r2.z - ez, bx = r3.x - ex, bz = r3.z - ez; const det = ax * bz - bx * az; const dv = (-ex * bz + bx * ez) / det, dt = (-ax * ez + ez * 0 + az * ex) / det; V2 += dv; T2 += dt; }
const segs = make(V2, T2); const w = walk(segs, 14);
console.log('V2', V2.toFixed(1), 'T2', T2.toFixed(1), 'closure', w.x.toFixed(2), w.z.toFixed(2), 'heading deg', (w.th * 180 / Math.PI).toFixed(1));
const pts = w.pts.slice(0, -1);
const t = createTrack({ ...city, points: pts, branches: [] });
let kmax = 0; for (const s of t.samples) kmax = Math.max(kmax, Math.abs(s.curvature));
console.log('lap', t.lapLength.toFixed(0), 'minR', (1 / kmax).toFixed(0), 'turn', (t.headingTurn / Math.PI).toFixed(2));
let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; for (const p of t.samples) { minX = Math.min(minX, p.px); maxX = Math.max(maxX, p.px); minZ = Math.min(minZ, p.pz); maxZ = Math.max(maxZ, p.pz); }
const W = 1200, pad = 60, k = (W - 2 * pad) / (maxX - minX), H = Math.round((maxZ - minZ) * k + 2 * pad), X = (x) => pad + (x - minX) * k, Y = (z) => pad + (z - minZ) * k;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#222"/><polyline fill="none" stroke="#888" stroke-width="12" points="${t.samples.map((p) => `${X(p.px)},${Y(p.pz)}`).join(' ')}"/>`;
for (let s = 0; s < t.lapLength; s += 50) { const p = t.sample(s); svg += `<circle cx="${X(p.px)}" cy="${Y(p.pz)}" r="${s % 100 === 0 ? 5 : 3}" fill="${s === 0 ? '#0f0' : '#fc0'}"/>`; if (s % 100 === 0) svg += `<text x="${X(p.px) + 8}" y="${Y(p.pz) - 8}" font-size="18" fill="#fff">${s}</text>`; }
await sharp(Buffer.from(svg + '</svg>')).png().toFile('/tmp/claude-0/-home-user-don-game/aeb9e57b-f7b1-5c89-ab16-fcc54d7de9f6/scratchpad/loop2.png');
console.log(JSON.stringify(pts.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10])).length, 'bytes of points');
