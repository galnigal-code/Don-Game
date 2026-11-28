import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';

/** The boost pads: a green square with white arrows on the road (one merged mesh for the whole track, every pad of one lap). */
export function buildPadMesh(track) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#17c964'; g.fillRect(0, 0, 128, 192);
  g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(8, 8, 112, 176);
  g.strokeStyle = '#0b7a3d'; g.lineWidth = 9; g.strokeRect(5, 5, 118, 182);
  g.fillStyle = '#ffffff';
  for (let k = 0; k < 3; k++) { const y = 168 - k * 56; g.beginPath(); g.moveTo(24, y); g.lineTo(64, y - 38); g.lineTo(104, y); g.lineTo(84, y); g.lineTo(64, y - 18); g.lineTo(44, y); g.closePath(); g.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const P = CONFIG.pads, tmp = {}, geos = [];
  for (const p of track.pads) {
    if (p.s >= track.lapLength && track.loop) continue;                  // every lap has the same pads
    const sm = track.sample(p.s, tmp, p.route);
    const w = P.HALF_W * 2, l = P.HALF_LEN * 2;
    const geo = new THREE.PlaneGeometry(w, l); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(sm.tx, sm.tz) + Math.PI);
    m.setPosition(sm.px + sm.rx * p.d, sm.py + 0.1, sm.pz + sm.rz * p.d);
    geo.applyMatrix4(m); geos.push(geo);
  }
  if (!geos.length) return null;
  return new THREE.Mesh(mergeGeometries(geos, false), mat);
}
