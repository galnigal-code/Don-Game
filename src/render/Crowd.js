import * as THREE from 'three';
import { createRng } from '../sim/rng.js';

// The crowd of an illegal street race: people on the pavements (dancing, waving, some with chequered flags), red flares along the kerb.
// A few instanced meshes; only the people near the camera are animated; the number shown follows the quality level.

const HOODIES = [0x1b1b1f, 0xb3202a, 0x23324f, 0x4a5530, 0xe8e4dc, 0xff7a00, 0x3ad1ff, 0x6b2a7a];
const SKINS = [0xf1c7a5, 0xd9a27a, 0xa86a45, 0x6e4126];
const FLAGS = [0xffffff, 0xff3b3b, 0xffd23f, 0x3ad1ff];

/** Where people may stand: on the pavements of the main road, thick near the start line, never near a branch (alley mouths, door, ramps). */
export function crowdPlaces(track, rng = createRng(21)) {
  const hw = track.samples[0].halfWidth, R = track.runoff, lat0 = hw + R + 0.8, lat1 = hw + R + 4.2;
  const avoid = [];
  for (const b of track.branches || []) for (let i = 0; i < b.samples.length; i += 2) { const p = b.samples[i]; if (p.py < 3) avoid.push(p); }
  for (const b of track.branches || []) if (b.building) for (let sv = b.building.s0 - 14; sv <= b.building.s1 + 14; sv += 6) { const q = track.sample(sv); avoid.push({ px: q.px + q.rx * b.building.dIn, pz: q.pz + q.rz * b.building.dIn }); }
  const places = [];
  for (let i = 0; i < track.samples.length - 1; i += 3) {
    const sm = track.samples[i], distStart = Math.min(sm.s, track.lapLength - sm.s);
    const dens = distStart < 90 ? 0.95 : distStart < 250 ? 0.4 : 0.26;
    for (const side of [-1, 1]) {
      if (rng() > dens) continue;
      const lat = side * (lat0 + rng() * (lat1 - lat0)), x = sm.px + sm.rx * lat, z = sm.pz + sm.rz * lat;
      if (avoid.some((q) => (q.px - x) ** 2 + (q.pz - z) ** 2 < 15 * 15)) continue;
      places.push({ x, y: sm.py + 0.14, z, face: Math.atan2(-side * sm.rx, -side * sm.rz), ph: rng() * 6.28, sp: 4 + rng() * 5, flag: rng() < 0.12, wave: rng() < 0.6, side });
    }
  }
  for (let i = places.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [places[i], places[j]] = [places[j], places[i]]; }     // random order: any prefix is an even thinning
  return places;
}

export function createCrowd(track) {
  const rng = createRng(33), places = crowdPlaces(track, rng), N = places.length, group = new THREE.Group();
  const col = new THREE.Color(), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const mk = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.frustumCulled = false; group.add(m); return m; };
  const body = mk(new THREE.CylinderGeometry(0.26, 0.32, 1.15, 7), new THREE.MeshLambertMaterial(), N);
  const head = mk(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshLambertMaterial(), N);
  const arms = mk(new THREE.BoxGeometry(0.11, 0.7, 0.11).translate(0, 0.35, 0), new THREE.MeshLambertMaterial(), N * 2);
  const nFlags = places.filter((p) => p.flag).length;
  const flagTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 40; const g = c.getContext('2d'); for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 8, j * 8, 8, 8); } return new THREE.CanvasTexture(c); })();
  const poles = mk(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 5).translate(0, 1.1, 0), new THREE.MeshLambertMaterial({ color: 0x222222 }), nFlags);
  const cloth = mk(new THREE.PlaneGeometry(1.1, 0.7).translate(0.55, 0, 0), new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }), nFlags);
  let fi = 0;
  places.forEach((p, i) => {
    body.setColorAt(i, col.setHex(HOODIES[i % HOODIES.length])); head.setColorAt(i, col.setHex(SKINS[(i * 7) % SKINS.length]));
    arms.setColorAt(i * 2, col.setHex(HOODIES[i % HOODIES.length])); arms.setColorAt(i * 2 + 1, col.setHex(HOODIES[i % HOODIES.length]));
    if (p.flag) { p.fi = fi; cloth.setColorAt(fi, col.setHex(FLAGS[fi % FLAGS.length])); fi++; }
  });
  // red road flares along the kerb (static)
  const flares = mk(new THREE.SphereGeometry(0.22, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff3b2f }), 120);
  { let nf = 0; const rr = createRng(5), hw = track.samples[0].halfWidth + track.runoff + 0.4;
    for (let i = 0; i < track.samples.length - 1 && nf < 120; i += 15) for (const side of [-1, 1]) { if (nf >= 120 || rr() < 0.5) continue; const sm = track.samples[i];
      mtx.makeTranslation(sm.px + sm.rx * side * hw, sm.py + 0.35, sm.pz + sm.rz * side * hw); flares.setMatrixAt(nf++, mtx); }
    flares.count = nf; flares.instanceMatrix.needsUpdate = true; }

  let shown = N, lastFrame = -1;
  const setPose = (p, i, t) => {
    const hop = Math.max(0, Math.sin(t * p.sp + p.ph)) * 0.25;
    e.set(0, p.face, 0); q.setFromEuler(e);
    mtx.compose(v.set(p.x, p.y + 0.58 + hop, p.z), q, sc); body.setMatrixAt(i, mtx);
    mtx.compose(v.set(p.x, p.y + 1.38 + hop, p.z), q, sc); head.setMatrixAt(i, mtx);
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1, swing = p.wave ? 2.4 + Math.sin(t * p.sp * 1.4 + p.ph + k) * 0.5 : 0.2;
      e.set(0, p.face, s * swing); q.setFromEuler(e);
      mtx.compose(v.set(p.x + Math.cos(p.face) * 0.3 * s, p.y + 1.1 + hop, p.z - Math.sin(p.face) * 0.3 * s), q, sc); arms.setMatrixAt(i * 2 + k, mtx);
    }
    if (p.flag) {
      e.set(0, p.face, 0); q.setFromEuler(e); mtx.compose(v.set(p.x, p.y + 0.9 + hop, p.z), q, sc); poles.setMatrixAt(p.fi, mtx);
      e.set(0, p.face + Math.sin(t * 3 + p.ph) * 0.6, 0); q.setFromEuler(e); mtx.compose(v.set(p.x, p.y + 2.75 + hop, p.z), q, sc); cloth.setMatrixAt(p.fi, mtx);
    }
  };
  places.forEach((p, i) => setPose(p, i, 0));
  for (const m of [body, head, arms, poles, cloth]) m.instanceMatrix.needsUpdate = true;
  const apply = () => { body.count = head.count = shown; arms.count = shown * 2; };
  apply();

  return {
    group, count: N,
    /** Fraction of the crowd to show (quality level). Flags are only drawn for the people that are shown. */
    setDetail(f) { shown = Math.floor(N * Math.max(0, Math.min(1, f))); apply(); group.visible = shown > 0; },
    /** Animate the people within 110 m of the camera (the rest keep their last pose). */
    update(camera, t) {
      if (!group.visible) return;
      const cx = camera.position.x, cz = camera.position.z; let any = false;
      for (let i = 0; i < shown; i++) { const p = places[i]; if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > 110 * 110) continue; setPose(p, i, t); any = true; }
      if (any) for (const m of [body, head, arms, poles, cloth]) m.instanceMatrix.needsUpdate = true;
      void lastFrame;
    },
    places,
  };
}
