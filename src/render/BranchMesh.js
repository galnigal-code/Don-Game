import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Branch roads of the city (V5-B): alleys, the long elevated track, the short floating track and the secret door. Elevated tracks
// share one futuristic look: a dark glass deck with glowing cyan edges, glass rails, a blue under-glow and slim pylons that stand
// ONLY beside the roads (never on one). Everything is merged per material: a handful of draw calls.

const UP = new THREE.Vector3(0, 1, 0);
const canvasTex = (w, h, draw, repeat = true) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
};

class Ribbon {
  constructor() { this.pos = []; this.uv = []; this.idx = []; this.n = 0; }
  row(a, b, u0, u1, v) { this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); this.uv.push(u0, v, u1, v); if (this.n) { const k = this.n * 2; this.idx.push(k - 2, k - 1, k, k - 1, k + 1, k); } this.n++; }
  mesh(mat) {
    if (this.n < 2) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setIndex(this.idx); g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
}

/** samples: the branch's samples (px,py,pz,rx,rz). Returns the flat strip between lateral a and b (metres), lifted by y. */
function strip(samples, a, b, mat, { vScale = 0.1, y = 0, from = 0, to = samples.length, tile = 1 } = {}) {
  const R = new Ribbon(); let dist = 0;
  for (let i = from; i < to; i++) {
    const p = samples[i]; if (i > from) dist += Math.hypot(p.px - samples[i - 1].px, p.pz - samples[i - 1].pz);
    R.row([p.px + p.rx * a, p.py + y, p.pz + p.rz * a], [p.px + p.rx * b, p.py + y, p.pz + p.rz * b], 0, tile, dist * vScale);
  }
  return R.mesh(mat);
}
/** A vertical wall along the side of the branch at lateral `side`, from height y0 up h. */
function wall(samples, side, h, mat, { y0 = 0, from = 0, to = samples.length, tile = 8, skip = null } = {}) {
  const pos = [], uv = [], idx = []; let dist = 0, k = 0;
  for (let i = from; i < to; i++) {
    const p = samples[i]; if (i > from) dist += Math.hypot(p.px - samples[i - 1].px, p.pz - samples[i - 1].pz);
    if (skip && skip(i)) { k = 0; continue; }
    const x = p.px + p.rx * side, z = p.pz + p.rz * side;
    pos.push(x, p.py + y0, z, x, p.py + y0 + h, z); uv.push(dist / tile, 0, dist / tile, h / tile);
    if (k) { const j = pos.length / 3 - 2; idx.push(j - 2, j - 1, j, j - 1, j + 1, j); }
    k++;
  }
  if (idx.length < 3) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export function buildBranchMeshes(track, group, roadMat) {
  // everything is collected per material and merged at the end: the whole network of branches costs a dozen draw calls
  const buckets = new Map();
  const put = (obj) => {
    if (!obj) return obj;
    obj.updateWorldMatrix(true, true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(g);
    });
    return obj;
  };
  const add = (m) => put(m);
  const flush = () => { for (const [mat, list] of buckets) { const merged = list.length === 1 ? list[0] : mergeGeometries(list, false); if (merged) group.add(new THREE.Mesh(merged, mat)); } buckets.clear(); };
  const mainPts = track.samples.filter((_, i) => i % 3 === 0);
  const hwMain = track.samples[0].halfWidth, roadEdge = hwMain + track.runoff + 5;     // road + kerb + pavement
  const distToRoad = (p) => { let d = 1e9; for (const q of mainPts) d = Math.min(d, Math.hypot(p.px - q.px, p.pz - q.pz)); return d; };

  const neoTex = canvasTex(128, 128, (g) => { g.fillStyle = '#13213a'; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(56,232,255,.55)'; g.lineWidth = 3;
    for (let y = 0; y < 128; y += 64) { g.beginPath(); g.moveTo(20, y + 50); g.lineTo(64, y + 20); g.lineTo(108, y + 50); g.stroke(); } });
  const deckNeo = new THREE.MeshBasicMaterial({ map: neoTex, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ color: 0x38e8ff, side: THREE.DoubleSide });
  const glass = new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const under = new THREE.MeshBasicMaterial({ color: 0x1aa6ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
  const rampTex = canvasTex(64, 64, (g) => { g.fillStyle = '#f2c200'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#1b1b1b'; for (let i = -64; i < 128; i += 32) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 16, 64); g.lineTo(i + 48, 0); g.lineTo(i + 32, 0); g.closePath(); g.fill(); } });
  const chevron = new THREE.MeshBasicMaterial({ map: rampTex, side: THREE.DoubleSide });
  const concrete = new THREE.MeshLambertMaterial({ color: 0xcfc6d6, side: THREE.DoubleSide });
  const pylonM = new THREE.MeshLambertMaterial({ color: 0x24283a });
  const alleyWall = new THREE.MeshLambertMaterial({ color: 0xb98d78, side: THREE.DoubleSide });
  const alleyKerb = new THREE.MeshLambertMaterial({ color: 0xd9d3dd, side: THREE.DoubleSide });
  const arrowTex = canvasTex(64, 64, (g) => { g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 64, 64); g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(32, 4); g.lineTo(54, 30); g.lineTo(40, 30); g.lineTo(40, 60); g.lineTo(24, 60); g.lineTo(24, 30); g.lineTo(10, 30); g.closePath(); g.fill(); });
  const arrowM = new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  const pylonG = new THREE.CylinderGeometry(0.5, 0.7, 1, 8), ringG = new THREE.TorusGeometry(0.85, 0.11, 6, 14);
  const allGround = [];       // low parts of every branch: a pylon must stay clear of these too
  for (const b of track.branches) for (let i = 0; i < b.samples.length; i += 2) if (b.samples[i].py < 3.5) allGround.push([b.samples[i], b.hw + 2.5]);
  const clearOfRoads = (x, z, own) => {
    for (const q of mainPts) if ((q.px - x) ** 2 + (q.pz - z) ** 2 < (hwMain + track.runoff + 3.5) ** 2) return false;
    for (const [q, r] of allGround) if ((q.px - x) ** 2 + (q.pz - z) ** 2 < r * r) return false;
    void own; return true;
  };
  const stats = { pylons: 0, pylonsSkipped: 0 };

  function futuristic(b, from = 0, to = b.samples.length, pylons = true) {
    const S = b.samples, hw = b.hw;
    add(strip(S, -hw, hw, deckNeo, { vScale: 0.08, y: 0.06, from, to }));
    add(strip(S, hw, hw + 0.7, glow, { y: 0.08, from, to })); add(strip(S, -hw - 0.7, -hw, glow, { y: 0.08, from, to }));
    const hi = []; for (let i = from; i < to; i++) if (S[i].py > 0.5) hi.push(i);
    if (hi.length > 2) {
      add(wall(S, hw + 0.6, 0.9, glass, { from: hi[0], to: hi[hi.length - 1] + 1 })); add(wall(S, -hw - 0.6, 0.9, glass, { from: hi[0], to: hi[hi.length - 1] + 1 }));
      add(strip(S, -hw + 1, hw - 1, under, { y: -0.7, from: hi[0], to: hi[hi.length - 1] + 1 }));
    }
    if (pylons) for (let i = from; i < to; i += 14) {
      const p = S[i]; if (p.py < 3 || !clearOfRoads(p.px, p.pz, b)) { if (p.py >= 3) stats.pylonsSkipped++; continue; }
      const m = new THREE.Mesh(pylonG, pylonM); m.scale.y = p.py - 0.6; m.position.set(p.px, (p.py - 0.6) / 2, p.pz); put(m);
      const r = new THREE.Mesh(ringG, glow); r.rotation.x = Math.PI / 2; r.position.set(p.px, p.py * 0.55, p.pz); put(r); stats.pylons++;
    }
  }
  const lip = (b) => { const p = b.samples[b.samples.length - 1], m = new THREE.Mesh(new THREE.PlaneGeometry(2 * b.hw, 1.2), chevron); m.rotation.x = -Math.PI / 2;
    const h = new THREE.Group(); h.add(m); h.position.set(p.px, p.py + 0.1, p.pz); h.rotation.y = Math.atan2(p.tx, p.tz); put(h); };
  // the climbing part of an elevated track: yellow-black stripes
  const climb = (b) => { const S = b.samples; let i0 = S.findIndex((p) => p.py > 0.25), i1 = S.findIndex((p) => p.py > b.exitH + 7.5 && b.kind !== 'secret'); if (i0 < 0) return; if (i1 < 0) i1 = Math.min(S.length, i0 + 90); add(strip(S, -b.hw, b.hw, chevron, { vScale: 0.25, y: 0.1, from: Math.max(0, i0 - 1), to: i1 })); };

  for (const b of track.branches) {
    const S = b.samples;
    if (b.kind === 'alley') {
      // asphalt lane + kerbs, and walls of the blocks on both sides once the alley is off the road
      add(strip(S, -b.hw, b.hw, roadMat, { vScale: 0.1, y: 0.045 }));
      add(strip(S, b.hw, b.hw + 0.7, alleyKerb, { y: 0.05 })); add(strip(S, -b.hw - 0.7, -b.hw, alleyKerb, { y: 0.05 }));
      const off = S.map((p) => distToRoad(p) > roadEdge + b.hw);
      const skip = (i) => !off[i];
      add(wall(S, b.hw + 0.8, 11, alleyWall, { skip })); add(wall(S, -b.hw - 0.8, 11, alleyWall, { skip }));
      // a white arrow on the road marks the mouth of the alley
      const p = S[Math.min(S.length - 1, 4)], m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), arrowM); m.rotation.x = -Math.PI / 2;
      const h = new THREE.Group(); h.add(m); h.position.set(p.px - p.rx * 0, p.py + 0.07, p.pz); h.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI; put(h);
    } else if (b.kind === 'elevated') {
      futuristic(b); climb(b);
    } else if (b.kind === 'neo') {
      futuristic(b, 0, S.length, false); climb(b); lip(b);
    } else if (b.kind === 'secret') secretRoute(b);
  }

  /* ---- the secret route: a driveway to a garage door, a dark tunnel climbing inside a building, a floating track out of the top ---- */
  function secretRoute(b) {
    const S = b.samples, B = b.building, tmp = {};
    const at = (sv, d) => { const p = track.sample(sv, tmp); return [p.px + p.rx * d, p.py, p.pz + p.rz * d]; };
    const sOf = (i) => { let best = 0, bd = 1e9; for (let sv = b.sa - 10; sv <= b.sb + 60; sv += 2) { const q = at(sv, 0); const e = (q[0] - S[i].px) ** 2 + (q[2] - S[i].pz) ** 2; if (e < bd) { bd = e; best = sv; } } return best; };
    const sIdx = S.map((_, i) => (i % 3 === 0 ? sOf(i) : null)); for (let i = 0; i < S.length; i++) if (sIdx[i] == null) sIdx[i] = sIdx[i - (i % 3)] ?? 0;
    const inDoor = (i) => sIdx[i] >= B.s0 - 6, inBld = (i) => sIdx[i] >= B.s0 + 2 && sIdx[i] <= B.s1 + 1;
    const first = 0, drv = S.findIndex((_, i) => inDoor(i)), tun0 = S.findIndex((_, i) => inBld(i)); let tun1 = S.length - 1; while (tun1 > 0 && !inBld(tun1)) tun1--;
    // the driveway from the road to the door (plain asphalt; tyre marks on the pavement are the tell)
    add(strip(S, -b.hw, b.hw, roadMat, { vScale: 0.1, y: 0.045, from: first, to: Math.max(first + 2, tun0) }));
    const marks = new THREE.MeshBasicMaterial({ color: 0x15111a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    for (const off of [-1.1, 1.1]) add(strip(S, off - 0.25, off + 0.25, marks, { y: 0.16, from: first, to: Math.max(first + 2, tun0) }));
    // the tunnel
    const dark = new THREE.MeshLambertMaterial({ color: 0x1b1622, side: THREE.DoubleSide }), floor = new THREE.MeshLambertMaterial({ color: 0x2a2433, side: THREE.DoubleSide });
    if (tun0 >= 0 && tun1 > tun0) {
      add(strip(S, -b.hw - 0.4, b.hw + 0.4, floor, { y: 0.05, from: tun0, to: tun1 + 1 }));
      add(wall(S, b.hw + 0.5, 6.5, dark, { from: tun0, to: tun1 + 1 })); add(wall(S, -b.hw - 0.5, 6.5, dark, { from: tun0, to: tun1 + 1 }));
      add(strip(S, -b.hw - 0.5, b.hw + 0.5, dark, { y: 6.5, from: tun0, to: tun1 + 1 }));
      const deep = S.map((_, i) => i).filter((i) => i >= tun0 + 20 && i <= tun1);
      if (deep.length > 2) { add(wall(S, b.hw + 0.4, 0.25, glow, { y0: 1.0, from: deep[0], to: deep[deep.length - 1] + 1 })); add(wall(S, -b.hw - 0.4, 0.25, glow, { y0: 1.0, from: deep[0], to: deep[deep.length - 1] + 1 })); }
    }
    futuristic(b, Math.max(0, tun1), S.length, false); lip(b);

    // the building: facade walls with the real door open and four closed decoys, the end wall with the exit hole, the roof
    const fac = canvasTex(256, 256, (g) => { g.fillStyle = '#efe2d2'; g.fillRect(0, 0, 256, 256); for (let fy = 0; fy < 2; fy++) for (let cx = 0; cx < 2; cx++) { const x = cx * 128, y = fy * 128; g.fillStyle = '#3c2f33'; g.fillRect(x + 30, y + 24, 68, 74); g.fillStyle = Math.random() < 0.4 ? '#ffcf8a' : '#5a6a8a'; g.fillRect(x + 35, y + 29, 58, 64); g.fillStyle = '#3c2f33'; g.fillRect(x + 62, y + 29, 4, 64); } });
    const facM = new THREE.MeshLambertMaterial({ map: fac, side: THREE.DoubleSide, color: 0xf3e6da });
    const bs = []; for (let sv = B.s0; sv <= B.s1; sv += 2) bs.push(sv);
    const wallAlong = (d, h, y0, s0, s1, mat, tile = [8, 7]) => {
      const pos = [], uv = [], idx = []; const n = Math.max(1, Math.ceil((s1 - s0) / 2));
      for (let i = 0; i <= n; i++) { const sv = s0 + ((s1 - s0) * i) / n, p = at(sv, d); pos.push(p[0], y0, p[2], p[0], y0 + h, p[2]); uv.push(((sv - s0) * 1) / tile[0], y0 / tile[1], ((sv - s0) * 1) / tile[0], (y0 + h) / tile[1]); if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); put(new THREE.Mesh(g, mat));
    };
    const [d0, d1] = B.door;
    wallAlong(B.dIn, B.height, 0, B.s0, d0, facM); wallAlong(B.dIn, B.height, 0, d1, B.s1, facM); wallAlong(B.dIn, B.height - B.doorH, B.doorH, d0, d1, facM);
    wallAlong(B.dOut, B.height, 0, B.s0, B.s1, facM);
    const shutter = new THREE.MeshLambertMaterial({ map: canvasTex(64, 64, (g) => { g.fillStyle = '#7d7682'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#5f5866'; for (let y = 0; y < 64; y += 6) g.fillRect(0, y, 64, 2); }), side: THREE.DoubleSide });
    for (const sv of [B.door[1] + 14, B.door[1] + 36, B.door[1] + 58, B.door[1] + 80]) wallAlong(B.dIn + 0.15, B.doorH, 0, sv, sv + 9, shutter, [4.5, 4.5]);          // closed decoy doors
    wallAlong(B.dIn + 0.15, 0.5, 0, d0, d1, shutter, [4.5, 4.5]);                                                                                                     // the real one is rolled up: only its bottom edge shows
    wallAlong(B.dIn + 0.25, 0.14, B.doorH + 0.15, d0, d1, glow);                                                                                                     // the tell: a thin cyan line above it
    // end walls, with the exit opening in the far one
    const endWall = (sv, hole) => {
      const seg = (l0, l1, y0, y1) => { const P0 = at(sv, l0), P1 = at(sv, l1), g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([P0[0], y0, P0[2], P1[0], y0, P1[2], P1[0], y1, P1[2], P0[0], y1, P0[2]], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, y0 / 7, Math.abs(l1 - l0) / 8, y0 / 7, Math.abs(l1 - l0) / 8, y1 / 7, 0, y1 / 7], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); put(new THREE.Mesh(g, facM)); };
      if (!hole) { seg(B.dIn, B.dOut, 0, B.height); return; }
      const [h0, h1, y0, y1] = hole; seg(B.dIn, h1, 0, B.height); seg(h0, B.dOut, 0, B.height); seg(h1, h0, 0, y0); seg(h1, h0, y1, B.height);
    };
    endWall(B.s0, null); endWall(B.s1, B.exit);
    const roof = new THREE.Group(); const rp = []; for (const sv of [B.s0, B.s1]) for (const d of [B.dIn, B.dOut]) rp.push(at(sv, d));
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute([rp[0][0], B.height, rp[0][2], rp[1][0], B.height, rp[1][2], rp[3][0], B.height, rp[3][2], rp[2][0], B.height, rp[2][2]], 3)); rg.setIndex([0, 1, 2, 0, 2, 3]); rg.computeVertexNormals();
    roof.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: 0x5a5060, side: THREE.DoubleSide }))); put(roof);
    void drv; void bs;
  }
  flush();
  group.userData.branchStats = stats;
  return stats;
}
