import * as THREE from 'three';
import { createRng } from '../sim/rng.js';
import { applySurface } from './textures.js';

// The city at sunset: facades with real window grids, shops on the ground floor, roof props, a dark ground and a low sun.
// Everything is merged into a handful of meshes (one per material), so a whole city costs ~8 draw calls.

const canvasTex = (w, h, draw, repeat = true) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
};

function sunSprite() {
  const t = canvasTex(256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,245,215,1)'); grad.addColorStop(0.18, 'rgba(255,214,150,1)'); grad.addColorStop(0.24, 'rgba(255,160,90,.55)');
    grad.addColorStop(0.55, 'rgba(255,110,70,.2)'); grad.addColorStop(1, 'rgba(255,90,60,0)'); g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  }, false);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  s.scale.set(520, 520, 1); s.renderOrder = -1; return s;
}

/** One facade tile = 2 window columns x 2 floors (8 m x 7 m), repeated by real metres. */
function facade(kind, rnd) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = { res: '#efe2d2', brick: '#b9674f', glass: '#5d6f9a' }[kind]; g.fillRect(0, 0, 256, 256);
    if (kind === 'brick') { g.fillStyle = 'rgba(60,20,10,.25)'; for (let y = 0; y < 256; y += 8) { for (let x = (y / 8) % 2 ? 0 : 10; x < 256; x += 20) g.fillRect(x, y, 1, 8); g.fillRect(0, y, 256, 1); } }
    for (let fy = 0; fy < 2; fy++) for (let cx = 0; cx < 2; cx++) {
      const x = cx * 128, y = fy * 128;
      if (kind === 'glass') {
        const lit = rnd() < 0.3, gr = g.createLinearGradient(x, y, x + 128, y + 128);
        gr.addColorStop(0, lit ? '#ffd7a0' : '#9fb2dc'); gr.addColorStop(1, lit ? '#f0a868' : '#46557e'); g.fillStyle = gr; g.fillRect(x + 4, y + 6, 120, 112);
        g.fillStyle = '#2b3350'; g.fillRect(x, y, 128, 6); g.fillRect(x, y, 4, 128);
      } else {
        const lit = rnd() < 0.38;
        g.fillStyle = '#3c2f33'; g.fillRect(x + 30, y + 24, 68, 74);
        g.fillStyle = lit ? '#ffcf8a' : '#5a6a8a'; g.fillRect(x + 35, y + 29, 58, 64);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 35, y + 29, 58, 10);
        g.fillStyle = '#3c2f33'; g.fillRect(x + 62, y + 29, 4, 64);
        if (rnd() < 0.45) { g.fillStyle = 'rgba(40,30,35,.85)'; g.fillRect(x + 22, y + 98, 84, 6); for (let k = 0; k < 9; k++) g.fillRect(x + 24 + k * 10, y + 104, 2, 16); g.fillRect(x + 22, y + 118, 84, 3); }
        if (rnd() < 0.18) { g.fillStyle = '#d9d4cf'; g.fillRect(x + 100, y + 60, 18, 14); }
      }
    }
  });
}

const geo = () => ({ pos: [], uv: [], col: [], idx: [] });
function quad(G, a, b, c, d, uvs, color) {
  const k = G.pos.length / 3; for (const v of [a, b, c, d]) G.pos.push(v[0], v[1], v[2]);
  G.uv.push(...uvs); for (let i = 0; i < 4; i++) G.col.push(...color); G.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
}
/** A rotated box: 4 walls (uv in metres / tile) and optionally a top, into the given geometries. */
function boxInto(G, top, cx, cz, w, d, h, rot, tile, color, y0 = 0) {
  const c = Math.cos(rot), sn = Math.sin(rot), P = (x, y, z) => [cx + x * c - z * sn, y, cz + x * sn + z * c];
  const cs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  if (G) for (let i = 0; i < 4; i++) {
    const [x0, z0] = cs[i], [x1, z1] = cs[(i + 1) % 4], len = Math.hypot(x1 - x0, z1 - z0);
    quad(G, P(x0, y0, z0), P(x1, y0, z1), P(x1, y0 + h, z1), P(x0, y0 + h, z0), tile ? [0, y0 / tile[1], len / tile[0], y0 / tile[1], len / tile[0], (y0 + h) / tile[1], 0, (y0 + h) / tile[1]] : [0, 0, 1, 0, 1, 1, 0, 1], color);
  }
  if (top) quad(top, P(-w / 2, y0 + h, d / 2), P(w / 2, y0 + h, d / 2), P(w / 2, y0 + h, -d / 2), P(-w / 2, y0 + h, -d / 2), [0, 0, 1, 0, 1, 1, 0, 1], color);
}
function toMesh(G, mat) {
  if (!G.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3));
  g.setIndex(G.idx); g.computeVertexNormals(); return new THREE.Mesh(g, mat);
}

export function buildCityEnvironment(track, scene) {
  const rnd = createRng(7);
  const group = new THREE.Group();

  // ground: dark asphalt-coloured city floor (the roads and pavements are drawn on top)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.samples) { minX = Math.min(minX, p.px); maxX = Math.max(maxX, p.px); minZ = Math.min(minZ, p.pz); maxZ = Math.max(maxZ, p.pz); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x4a3f4f }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.06, cz); group.add(ground);

  const mats = ['res', 'brick', 'glass'].map((k) => new THREE.MeshLambertMaterial({ map: facade(k, rnd), vertexColors: true }));
  const shopTex = canvasTex(256, 64, (g) => {
    g.fillStyle = '#2a2230'; g.fillRect(0, 0, 256, 64); const cols = ['#ff5a5a', '#3ad1ff', '#ffd23f', '#7dff8c', '#ff8af0', '#ff9a4d'];
    for (let i = 0; i < 4; i++) { const x = i * 64; g.fillStyle = '#ffd9a8'; g.fillRect(x + 6, 26, 52, 34); g.fillStyle = cols[(rnd() * 6) | 0]; g.fillRect(x + 4, 8, 56, 12); g.fillStyle = 'rgba(0,0,0,.35)'; for (let k = 0; k < 6; k++) g.fillRect(x + 4 + k * 10, 20, 5, 5); }
  });
  const shopM = new THREE.MeshLambertMaterial({ map: shopTex, emissive: 0x2a1a10 });
  const roofM = new THREE.MeshLambertMaterial({ color: 0x5a5060 }), propM = new THREE.MeshLambertMaterial({ color: 0x9c96a4 }), tankM = new THREE.MeshLambertMaterial({ color: 0x6e4b3a });

  const road = [];
  for (let i = 0; i < track.samples.length; i += 3) road.push(track.samples[i]);
  const nearest = (x, z) => { let best = road[0], bd = Infinity; for (const p of road) { const d = (p.px - x) ** 2 + (p.pz - z) ** 2; if (d < bd) { bd = d; best = p; } } return { p: best, d: Math.sqrt(bd) }; };
  const [fRes, fBrick, fGlass] = [geo(), geo(), geo()], F = [fRes, fBrick, fGlass], shopG = geo(), roofG = geo(), propG = geo(), tankG = geo();
  const tints = [[1, 0.96, 0.92], [0.95, 0.88, 0.9], [1, 0.9, 0.8], [0.9, 0.92, 1], [1, 1, 1]];
  let count = 0;
  const hw = track.samples[0].halfWidth, clear = hw + track.runoff + 6.5;     // buildings stand behind the pavement
  for (let x = minX - 160; x <= maxX + 160; x += 28) for (let z = minZ - 160; z <= maxZ + 160; z += 28) {
    const jx = x + (rnd() - 0.5) * 8, jz = z + (rnd() - 0.5) * 8, w = 14 + rnd() * 12, d = 14 + rnd() * 12;
    const { p, d: dist } = nearest(jx, jz);
    if (dist < clear + Math.max(w, d) * 0.6) continue;
    const street = dist < clear + 28, far = Math.hypot(jx - cx, jz - cz) > 420;
    const kind = far ? (rnd() < 0.7 ? 2 : 0) : (rnd() < 0.55 ? 0 : 1);
    const floors = far ? 10 + ((rnd() * 22) | 0) : 3 + ((rnd() * 6) | 0), h = floors * 3.5;
    const rot = Math.atan2(p.pz - jz, p.px - jx), tint = tints[(rnd() * tints.length) | 0], y0 = street ? 4.5 : 0;
    boxInto(F[kind], roofG, jx, jz, w, d, h, rot, [8, 7], tint, y0);
    if (street) boxInto(shopG, null, jx, jz, w + 0.3, d + 0.3, 4.5, rot, [16, 4.5], [1, 1, 1]);
    if (rnd() < 0.55) boxInto(tankG, tankG, jx + (rnd() - 0.5) * w * 0.5, jz + (rnd() - 0.5) * d * 0.5, 2.2, 2.2, 2.4, rot, null, [1, 1, 1], h + y0);
    if (rnd() < 0.7) boxInto(propG, propG, jx + (rnd() - 0.5) * w * 0.4, jz + (rnd() - 0.5) * d * 0.4, 3, 2, 1.2, rot, null, [1, 1, 1], h + y0);
    count++;
  }
  const buildings = new THREE.Group();
  [[fRes, mats[0]], [fBrick, mats[1]], [fGlass, mats[2]], [shopG, shopM], [roofG, roofM], [propG, propM], [tankG, tankM]].forEach(([G, m]) => { const mesh = toMesh(G, m); if (mesh) buildings.add(mesh); });
  group.add(buildings);

  const sunDir = new THREE.Vector3(-0.75, 0.1, -0.65).normalize();
  const sun = sunSprite(); group.add(sun);
  scene.add(group);

  return {
    group, terrain: null, sunDir, buildings: count,
    update(camera) { sun.position.copy(camera.position).addScaledVector(sunDir, 1500); },
    setDetail() { /* the whole city is a few merged meshes: nothing to thin out */ },
    applySurfaces() { /* the city keeps its own colours */ },
    stats: { buildings: count },
  };
}
