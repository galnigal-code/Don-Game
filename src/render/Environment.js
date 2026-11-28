import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { createRng } from '../sim/rng.js';
import { createTerrain } from './terrainMath.js';
import { applySurface } from './textures.js';
import { buildCityEnvironment } from './CityEnvironment.js';

const SAND = new THREE.Color(0xc99458), DRY = new THREE.Color(0xe0b878), RED = new THREE.Color(0xb4532a), DEEP = new THREE.Color(0x9a6a3a);

function sunTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,250,225,1)'); grad.addColorStop(0.16, 'rgba(255,238,190,1)');
  grad.addColorStop(0.2, 'rgba(255,200,120,.55)'); grad.addColorStop(0.5, 'rgba(255,160,80,.18)'); grad.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function cactusGeometry() {
  const parts = [];
  const cyl = (rt, rb, h, x, y, z, rz = 0) => { const g = new THREE.CylinderGeometry(rt, rb, h, 7); g.rotateZ(rz); g.translate(x, y, z); parts.push(g); };
  cyl(0.32, 0.4, 4.2, 0, 2.1, 0);                      // trunk
  const cap = new THREE.SphereGeometry(0.32, 7, 5); cap.translate(0, 4.2, 0); parts.push(cap);
  cyl(0.22, 0.22, 1.1, 0.85, 2.0, 0, Math.PI / 2);     // right arm: out, then up
  cyl(0.2, 0.2, 1.3, 1.4, 2.6, 0);
  cyl(0.22, 0.22, 0.9, -0.7, 2.8, 0, Math.PI / 2);     // left arm
  cyl(0.2, 0.2, 1.0, -1.15, 3.3, 0);
  return mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));
}

export function buildEnvironment(track, scene) {
  if (track.style === 'city') return buildCityEnvironment(track, scene);
  const rng = createRng(11);
  const terrain = createTerrain(track);
  const group = new THREE.Group();
  const SE = CONFIG.track.SAND_EXTRA;

  /* ---- terrain: coarse low-poly grid; the band close to the road is left out (covered by the road ribbons) ---- */
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of track.samples) { minX = Math.min(minX, s.px); maxX = Math.max(maxX, s.px); minZ = Math.min(minZ, s.pz); maxZ = Math.max(maxZ, s.pz); }
  const M = 520, CELL = 26;
  minX -= M; maxX += M; minZ -= M; maxZ += M;
  const nx = Math.ceil((maxX - minX) / CELL) + 1, nz = Math.ceil((maxZ - minZ) / CELL) + 1;
  const uvs = new Float32Array(nx * nz * 2), pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), dist = new Float32Array(nx * nz);
  const tmp = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = minX + i * CELL, z = minZ + j * CELL, k = j * nx + i;
    const t = terrain.sample(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = t.y; pos[k * 3 + 2] = z; dist[k] = t.d;
    uvs[k * 2] = x / 14; uvs[k * 2 + 1] = z / 14;
    const rel = t.y - (t.py - 2);
    tmp.copy(SAND).lerp(DRY, terrain.noise(x / 60, z / 60) * 0.7);
    tmp.lerp(DEEP, Math.max(0, Math.min(1, -rel / 12)) * 0.6);
    tmp.lerp(RED, Math.max(0, Math.min(1, (rel - 6) / 26)) * 0.85 * Math.min(1, t.mesa / 6 + 0.25));
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
  }
  const idx = [];
  const HOLE = 105;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (Math.min(dist[a], dist[b], dist[c], dist[d]) < HOLE && Math.max(dist[a], dist[b], dist[c], dist[d]) < HOLE + 4) continue;
    idx.push(a, c, b, b, c, d);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  tg.setIndex(idx); tg.computeVertexNormals();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(tg, terrainMat));

  /* ---- decorations on the shoulders: cacti and rock clusters ---- */
  const dummy = new THREE.Object3D();
  const placeAlong = (count, latMin, latMax, fn) => {
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 30) {
      const sm = track.samples[Math.floor(rng() * track.samples.length)];
      const side = rng() < 0.5 ? -1 : 1;
      const edge = side < 0 ? sm.edgeLeft : sm.edgeRight;
      if (edge !== 'sand' || track.inGap(sm.s) || sm.s < -30) continue;
      const lat = sm.halfWidth + SE + latMin + rng() * (latMax - latMin);
      const x = sm.px + sm.rx * side * lat, z = sm.pz + sm.rz * side * lat;
      fn(x, terrain.ribbonY(sm.py, lat, sm.halfWidth), z); placed++;
    }
  };

  const cacti = new THREE.InstancedMesh(cactusGeometry(), new THREE.MeshLambertMaterial({ color: 0x3f7d3a, flatShading: true }), 150);
  let ci = 0;
  placeAlong(150, 4, 85, (x, y, z) => {
    const s = 0.7 + rng() * 0.9;
    dummy.position.set(x, y, z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.set(s, s * (0.8 + rng() * 0.5), s);
    dummy.updateMatrix(); cacti.setMatrixAt(ci++, dummy.matrix);
  });
  cacti.count = ci; group.add(cacti);

  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 220);
  let ri = 0;
  const rockCol = [0x93502d, 0xa8643a, 0x7d4326, 0xb67a4a];
  placeAlong(70, 3, 95, (x, y, z) => {
    const n = 1 + Math.floor(rng() * 3);
    for (let q = 0; q < n && ri < 220; q++) {
      const s = 0.5 + rng() * (q === 0 ? 2.4 : 1.1);
      dummy.position.set(x + (rng() - 0.5) * 3, y + s * 0.35, z + (rng() - 0.5) * 3);
      dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3); dummy.scale.set(s * 1.2, s * 0.8, s);
      dummy.updateMatrix(); rocks.setMatrixAt(ri, dummy.matrix); rocks.setColorAt(ri, tmp.setHex(rockCol[Math.floor(rng() * 4)])); ri++;
    }
  });
  rocks.count = ri; group.add(rocks);

  /* ---- the sun: a glowing disc that stays at a fixed direction around the camera ---- */
  const sunDir = new THREE.Vector3(-0.5, 0.2, -0.84).normalize();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTexture(), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  sun.scale.set(420, 420, 1); sun.renderOrder = -1;
  group.add(sun);
  scene.add(group);

  return {
    group, terrain, sunDir,
    update(camera) { sun.position.copy(camera.position).addScaledVector(sunDir, 700); },
    /** Fraction (0..1) of cacti and rocks to draw (quality control). */
    setDetail(f) { cacti.count = Math.floor(ci * f); rocks.count = Math.floor(ri * f); },
    /** Surface textures (see textures.js). The vertex colours stay as the tint, so the texture only adds grain and relief. */
    applySurfaces(tex, flags) { applySurface(terrainMat, tex?.sand, flags, { tint: 0xffffff, flat: 0xffffff, normalScale: 0.8 }); if (terrainMat.map) terrainMat.color.setRGB(1.7, 1.7, 1.7); },
    stats: { terrainTris: idx.length / 3, cacti: ci, rocks: ri },
  };
}
