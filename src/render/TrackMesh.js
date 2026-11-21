import * as THREE from 'three';
import { CONFIG } from '../config.js';

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
  row(a, b, v = 0) {
    this.pos.push(...a, ...b); this.uv.push(0, v, 1, v);
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

export function buildTrackMesh(track) {
  const group = new THREE.Group();
  const SE = CONFIG.track.SAND_EXTRA;
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, ...extra });
  const materials = {
    road: mat(0xffffff, { map: roadTexture(), roughness: 0.85 }),
    sand: mat(0xd9b27a), ground: mat(0xc99458), wood: mat(0x8a5a30),
    rock: mat(0xa04a2a), rockTop: mat(0xb8643a), cliff: mat(0x8f4426),
  };
  const strips = {};
  const S = (name, side = 0) => (strips[name + side] ||= { name, strip: new Strip() }).strip;

  const P = (sm, lat, y) => [sm.px + sm.rx * lat, sm.py + y, sm.pz + sm.rz * lat];

  function side(sm, sd, edge) {
    const hw = sm.halfWidth;
    if (edge === 'sand') {
      S('sand', sd).row(P(sm, sd * hw, -0.02), P(sm, sd * (hw + SE), -0.05));
      S('wood', sd).row(P(sm, sd * (hw + SE), -0.3), P(sm, sd * (hw + SE), 1.2));
      S('ground', sd).row(P(sm, sd * (hw + SE), -0.2), P(sm, sd * (hw + SE + 100), -2.0));   // slopes down to meet the terrain
    } else if (edge === 'wall') {
      S('rock', sd).row(P(sm, sd * hw, -0.3), P(sm, sd * hw, 8));
      S('rockTop', sd).row(P(sm, sd * hw, 8), P(sm, sd * (hw + 100), 6));
    } else { // cliff
      S('cliff', sd).row(P(sm, sd * hw, -0.3), P(sm, sd * hw, -30));
      S('ground', sd).row(P(sm, sd * hw, -30), P(sm, sd * (hw + 100), -30));
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
  const rampMat = new THREE.MeshStandardMaterial({ map: rampTexture(), roughness: 0.7, side: THREE.DoubleSide });
  const trenchMat = new THREE.MeshStandardMaterial({ color: 0x5c2a16, roughness: 1, side: THREE.BackSide });
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

  return group;
}
