import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { applySurface } from './textures.js';

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#55504b'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 2500; i++) {
    const v = 70 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v - 4},${v - 8},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Lane markings on a transparent background, drawn as a thin overlay above the asphalt (so the asphalt photo can show through). */
function markingsTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe3';                       // edge lines
  g.fillRect(8, 0, 6, 512); g.fillRect(242, 0, 6, 512);
  g.fillStyle = '#f2d24a';                       // dashed centre line: 6 m dash, 4 m gap per 10 m tile
  g.fillRect(124, 0, 8, 307);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function checkerTexture(cols, rows) {
  const c = document.createElement('canvas');
  c.width = 32 * cols; c.height = 32 * rows;
  const g = c.getContext('2d');
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 32, y * 32, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}

function rampTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f2c200'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1b1b1b';
  for (let i = -128; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 32, 128); g.lineTo(i + 96, 0); g.lineTo(i + 64, 0); g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

class Strip {
  constructor() { this.pos = []; this.uv = []; this.idx = []; this.prev = -1; this.count = 0; }
  /** uvA/uvB: explicit [u, v] for the two vertices (surface textures); otherwise u runs 0..1 across and v is `v`. */
  row(a, b, v = 0, uvA = null, uvB = null) {
    this.pos.push(...a, ...b);
    if (uvA) this.uv.push(...uvA, ...uvB); else this.uv.push(0, v, 1, v);
    const i = this.count; this.count += 2;
    if (this.prev >= 0) { const p = this.prev; this.idx.push(p, p + 1, i, p + 1, i + 1, i); }
    this.prev = i;
  }
  end() { this.prev = -1; }
  mesh(material) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}

function kerbTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#e8323c'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#ffffff'; g.fillRect(0, 32, 64, 32);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** The city: asphalt, red-white kerbs, pavements and the start gate. The buildings are in CityEnvironment. */
function buildCityRoad(track) {
  const group = new THREE.Group();
  const road = new THREE.MeshLambertMaterial({ color: 0xffffff, map: roadTexture(), side: THREE.DoubleSide });
  const markings = new THREE.MeshLambertMaterial({ map: markingsTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const kerb = new THREE.MeshLambertMaterial({ map: kerbTexture(), side: THREE.DoubleSide });
  const walk = new THREE.MeshLambertMaterial({ color: 0x8a8090, side: THREE.DoubleSide });
  const roadFallback = road.map;
  const R = track.runoff, WALK = 5;
  const P = (sm, lat, y) => [sm.px + sm.rx * lat, sm.py + y, sm.pz + sm.rz * lat];
  const rows = { road: new Strip(), mark: new Strip(), kl: new Strip(), kr: new Strip(), wl: new Strip(), wr: new Strip() };
  for (let k = 0; k < track.samples.length; k += 2) {
    const sm = track.samples[k], hw = sm.halfWidth, v = k * track.step;
    rows.road.row(P(sm, -hw, 0), P(sm, hw, 0), v / 10);
    rows.mark.row(P(sm, -hw, 0.03), P(sm, hw, 0.03), v / 10);
    rows.kr.row(P(sm, hw, 0.02), P(sm, hw + R, 0.02), v * 0.5); rows.kl.row(P(sm, -hw - R, 0.02), P(sm, -hw, 0.02), v * 0.5);
    rows.wr.row(P(sm, hw + R, 0.14), P(sm, hw + R + WALK, 0.14)); rows.wl.row(P(sm, -hw - R - WALK, 0.14), P(sm, -hw - R, 0.14));
  }
  // the last row closes the loop on the first one
  const first = track.samples[0], hw0 = first.halfWidth;
  rows.road.row(P(first, -hw0, 0), P(first, hw0, 0), track.lapLength / 10); rows.mark.row(P(first, -hw0, 0.03), P(first, hw0, 0.03), track.lapLength / 10);
  rows.kr.row(P(first, hw0, 0.02), P(first, hw0 + R, 0.02), track.lapLength * 0.5); rows.kl.row(P(first, -hw0 - R, 0.02), P(first, -hw0, 0.02), track.lapLength * 0.5);
  rows.wr.row(P(first, hw0 + R, 0.14), P(first, hw0 + R + WALK, 0.14)); rows.wl.row(P(first, -hw0 - R - WALK, 0.14), P(first, -hw0 - R, 0.14));
  const mats = { road, mark: markings, kl: kerb, kr: kerb, wl: walk, wr: walk };
  for (const k in rows) { const m = rows[k].mesh(mats[k]); if (m) group.add(m); }

  // start / finish gate (a loop has one line: the start and the finish are the same place)
  const sm = track.sample(0), hw = sm.halfWidth, holder = new THREE.Group();
  holder.position.set(sm.px, sm.py, sm.pz); holder.rotation.set(Math.asin(sm.ty), -sm.heading, 0, 'YXZ');
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 3), new THREE.MeshBasicMaterial({ map: checkerTexture(16, 2) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.05; holder.add(floor);
  const pole = new THREE.MeshLambertMaterial({ color: 0xe8e2d6 });
  for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 8), pole); p.position.set(sd * (hw + R + 0.6), 3.5, 0); holder.add(p); }
  const banner = new THREE.Mesh(new THREE.BoxGeometry((hw + R + 0.6) * 2, 1.4, 0.4), new THREE.MeshBasicMaterial({ map: checkerTexture(24, 2) }));
  banner.position.set(0, 6.6, 0); holder.add(banner);
  group.add(holder);

  group.userData.applySurfaces = (tex, flags) => {
    const useTex = !!(flags.tex && tex?.road?.diff);
    if (useTex) { tex.road.diff.repeat.set(Math.max(1, (hw * 2) / 3.4), 3); if (tex.road.nor) tex.road.nor.repeat.set(Math.max(1, (hw * 2) / 3.4), 3); }
    road.map = useTex ? tex.road.diff : roadFallback;
    road.normalMap = useTex && flags.normal ? tex.road.nor : null;
    road.needsUpdate = true;
  };
  return group;
}

export function buildTrackMesh(track) {
  if (track.style === 'city') return buildCityRoad(track);
  const group = new THREE.Group();
  const SE = CONFIG.track.SAND_EXTRA;
  const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...extra });   // no specular needed: much cheaper than Standard on phones
  const materials = {
    road: mat(0xffffff, { map: roadTexture() }),
    markings: new THREE.MeshLambertMaterial({ map: markingsTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    sand: mat(0xd9b27a), ground: mat(0xc99458), wood: mat(0x8a5a30),
    rail: new THREE.MeshLambertMaterial({ color: 0xc9ced6, side: THREE.DoubleSide, emissive: 0x222428 }), railPost: mat(0x6d7178),
    rock: mat(0xa04a2a), rockTop: mat(0xb8643a), cliff: mat(0x8f4426),
  };
  const roadFallback = materials.road.map;
  const strips = {};
  const S = (name, side = 0) => (strips[name + side] ||= { name, strip: new Strip() }).strip;

  const P = (sm, lat, y) => [sm.px + sm.rx * lat, sm.py + y, sm.pz + sm.rz * lat];
  // surface-texture coordinates: floors use world x/z, walls use along-track and height (about 8 m per tile)
  const TS = 1 / 8;
  const flat = (p) => [p[0] * TS, p[2] * TS];
  const wall = (sm, p) => [sm.s * TS, p[1] * TS];

  function side(sm, sd, edge) {
    const hw = sm.halfWidth;
    if (edge === 'sand') {
      const out = (sd < 0 ? sm.sandLimL : sm.sandLimR) ?? hw + SE;   // the shoulder narrows into a following wall / guard rail (V4)
      const a = P(sm, sd * hw, -0.02), b = P(sm, sd * out, -0.05);
      S('sand', sd).row(a, b, 0, flat(a), flat(b));
      S('wood', sd).row(P(sm, sd * out, -0.3), P(sm, sd * out, 1.2));
      const c = P(sm, sd * out, -0.2), d = P(sm, sd * (out + 100), -2.0);   // slopes down to meet the terrain
      S('ground', sd).row(c, d, 0, flat(c), flat(d));
    } else if (edge === 'wall') {
      const a = P(sm, sd * hw, -0.3), b = P(sm, sd * hw, 8), c = P(sm, sd * (hw + 100), 6);
      S('rock', sd).row(a, b, 0, wall(sm, a), wall(sm, b));
      S('rockTop', sd).row(b, c, 0, flat(b), flat(c));
    } else { // cliff
      const a = P(sm, sd * hw, -0.3), b = P(sm, sd * hw, -30), c = P(sm, sd * (hw + 100), -30);
      S('cliff', sd).row(a, b, 0, wall(sm, a), wall(sm, b));
      S('rail', sd).row(P(sm, sd * (hw + 0.1), 0.35), P(sm, sd * (hw + 0.1), 0.95));        // V4: metal guard rail, nobody falls
      S('railPost', sd).row(P(sm, sd * (hw + 0.15), -0.1), P(sm, sd * (hw + 0.15), 0.35));
      S('ground', sd).row(b, c, 0, flat(b), flat(c));
    }
  }

  let key = null, prevSm = null, prevEdges = null;
  const endAll = () => { for (const k in strips) strips[k].strip.end(); };
  const n = track.samples.length;
  const gapFrom = new Set(track.gaps.map((g) => g.from));
  for (let k = 0; k < n; k += 2) {
    const sm = track.samples[k];
    if (track.inGap(sm.s)) continue;                  // the road is missing here (trench below)
    S('road').row(P(sm, -sm.halfWidth, 0), P(sm, sm.halfWidth, 0), sm.s / 10);
    S('markings').row(P(sm, -sm.halfWidth, 0.03), P(sm, sm.halfWidth, 0.03), sm.s / 10);
    const kk = sm.edgeLeft + '|' + sm.edgeRight;
    if (key !== null && kk !== key) {           // close the previous run on this row, then start a new one
      side(sm, -1, prevEdges[0]); side(sm, 1, prevEdges[1]);
      endAll();
    }
    side(sm, -1, sm.edgeLeft); side(sm, 1, sm.edgeRight);
    key = kk; prevEdges = [sm.edgeLeft, sm.edgeRight]; prevSm = sm;
    if (gapFrom.has(sm.s)) { endAll(); key = null; }  // road ends at the lip; the next run starts after the gap
  }
  void prevSm;
  for (const k in strips) {
    const m = strips[k].strip.mesh(materials[strips[k].name]);
    if (m) group.add(m);
  }

  // start & finish lines + gates
  const lineTex = checkerTexture(16, 2);
  const bannerTex = checkerTexture(24, 2);
  function line(s) {
    const sm = track.sample(s);
    const hw = sm.halfWidth;
    const holder = new THREE.Group();
    holder.position.set(sm.px, sm.py, sm.pz);
    holder.rotation.set(Math.asin(sm.ty), -sm.heading, 0, 'YXZ');
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 3), new THREE.MeshBasicMaterial({ map: lineTex }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.04;
    holder.add(floor);
    const pole = new THREE.MeshStandardMaterial({ color: 0xe8e2d6 });
    for (const sd of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 8), pole);
      p.position.set(sd * (hw + 0.6), 3.5, 0); holder.add(p);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry((hw + 0.6) * 2, 1.4, 0.4), new THREE.MeshBasicMaterial({ map: bannerTex }));
    banner.position.set(0, 6.6, 0); holder.add(banner);
    group.add(holder);
  }
  line(0);
  line(track.finishS);

  // ramps (a wedge the car drives up) and the trench under every gap
  const rampMat = new THREE.MeshLambertMaterial({ map: rampTexture(), side: THREE.DoubleSide });
  const trenchMat = new THREE.MeshLambertMaterial({ color: 0x5c2a16, side: THREE.BackSide });
  for (const r of track.ramps) {
    const a = track.sample(r.s - r.len), b = track.sample(r.s), hw = a.halfWidth;
    const pts = [
      [a.px - a.rx * hw, a.py + 0.02, a.pz - a.rz * hw], [a.px + a.rx * hw, a.py + 0.02, a.pz + a.rz * hw],
      [b.px - b.rx * hw, b.py + r.rise, b.pz - b.rz * hw], [b.px + b.rx * hw, b.py + r.rise, b.pz + b.rz * hw],
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, hw / 2, 0, 0, 1.5, hw / 2, 1.5], 2));
    geo.setIndex([0, 1, 2, 1, 3, 2]); geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, rampMat));
    if (r.gap) {
      const mid = track.sample((r.gap.from + r.gap.to) / 2), len = r.gap.to - r.gap.from;
      const w = (mid.halfWidth + SE + 3) * 2, depth = 16;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, depth, len), trenchMat);
      box.position.set(mid.px, mid.py - depth / 2 - 0.05, mid.pz);
      box.rotation.set(0, -mid.heading, 0);
      group.add(box);
    }
  }

  // surface textures (loaded later); each material falls back to its flat colour until / unless they are applied
  group.userData.applySurfaces = (tex, flags) => {
    const road = materials.road;
    if (tex?.road?.diff) { tex.road.diff.repeat.set(Math.max(1, (CONFIG.track.HALF_WIDTH * 2) / 3.4), 3); }
    if (tex?.road?.nor) tex.road.nor.repeat.set(Math.max(1, (CONFIG.track.HALF_WIDTH * 2) / 3.4), 3);
    const swap = flags.tex && tex?.road?.diff;
    road.map = swap ? tex.road.diff : roadFallback;
    road.normalMap = swap && flags.normal ? tex.road.nor : null;
    road.needsUpdate = true;
    applySurface(materials.sand, tex?.sand, flags, { tint: 0xf0dcc0, flat: 0xd9b27a, boost: 1.7 });
    applySurface(materials.ground, tex?.sand, flags, { tint: 0xe4c9a0, flat: 0xc99458, boost: 1.7 });
    applySurface(materials.rock, tex?.rock, flags, { tint: 0xe6a58a, flat: 0xa04a2a, boost: 1.5 });
    applySurface(materials.rockTop, tex?.sand, flags, { tint: 0xf0b890, flat: 0xb8643a, boost: 1.6 });
    applySurface(materials.cliff, tex?.rock, flags, { tint: 0xd8957a, flat: 0x8f4426, boost: 1.5 });
  };

  return group;
}
