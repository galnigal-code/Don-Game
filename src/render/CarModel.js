import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Simple low-poly sports car (nose points to -Z). Replaced by a nicer model in M6.
function nameLabel(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 34px Rubik, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(name, 128, 34);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  sp.scale.set(3.4, 0.85, 1); sp.position.set(0, 2.9, 0);
  return sp;
}

// side-profile shapes are drawn in (x = along the car, +x = nose; y = height) and extruded across the width
export function profileGeometry(points, width, bevel = 0.06) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);      // +x (nose) -> -z (forward), extrusion axis -> x (width)
  return g;
}

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,.65)'); grad.addColorStop(0.6, 'rgba(0,0,0,.35)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

const IDENT = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4();

/** Bake a transform (and an optional vertex colour) into a geometry so many parts can be merged into one mesh. */
function bake(geo, { color = null, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s);
  g.applyMatrix4(_m);
  if (color !== null) {
    const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}
const merged = (list) => (list.length ? mergeGeometries(list) : null);

// Shared materials (one set for all cars; only the paint differs per car)
const PARTS_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.45 });
const LAMP_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const FLAME_GEO = new THREE.ConeGeometry(0.17, 1.4, 8);

/**
 * The car is built from only a handful of meshes (paint, parts, lamps, 4 wheels) because every mesh is a draw call and
 * four cars are on screen: ~40 loose parts per car cost 160+ draw calls, which is too much for a phone.
 */
export function createCarModel(color, name = null) {
  const root = new THREE.Group();       // positioned/oriented by the game
  const body = new THREE.Group();       // tilts (roll/pitch/spin) on top of root
  root.add(body);

  const PAINT_SHADOW = 0x3a3a40, GLASS = 0x27323f, DARK = 0x15161a, WHITE = 0xf4f1ea, RIM = 0xd5d8de, TIRE = 0x181818;
  const paint = [], parts = [], lamps = [];
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // lower body: low wedge with a sloping nose and a raised tail
  paint.push(bake(profileGeometry([[-2.15, 0.3], [-2.15, 0.82], [-1.5, 0.9], [-0.2, 0.84], [1.2, 0.74], [1.95, 0.5], [2.2, 0.38], [2.15, 0.3]], 1.9)));
  // cabin: glass greenhouse with a body-coloured roof
  parts.push(bake(profileGeometry([[-1.15, 0.82], [-0.75, 1.3], [0.35, 1.32], [1.0, 0.84]], 1.46, 0.05), { color: GLASS }));
  paint.push(bake(profileGeometry([[-0.78, 1.3], [-0.7, 1.36], [0.3, 1.38], [0.36, 1.31]], 1.4, 0.03)));
  // racing stripes
  for (const x of [-0.17, 0.17]) parts.push(bake(box(0.13, 0.03, 3.0), { color: WHITE, x, y: 0.86, z: -0.4, rx: 0.045 }));
  // wheel arches: dark cut-out discs plus a raised flare over each wheel
  for (const [x, z] of [[-0.97, -1.38], [0.97, -1.38], [-0.97, 1.4], [0.97, 1.4]]) {
    parts.push(bake(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 16), { color: DARK, x, y: 0.45, z, rz: Math.PI / 2 }));
    paint.push(bake(new THREE.TorusGeometry(0.58, 0.07, 5, 14, Math.PI), { x: x * 1.02, y: 0.45, z, ry: Math.PI / 2 }));
  }
  // side skirts, door shut lines, bonnet vents, grille, headlight housings, rear diffuser
  for (const x of [-0.97, 0.97]) {
    parts.push(bake(box(0.07, 0.1, 1.5), { color: DARK, x, y: 0.34, z: 0.0 }));
    for (const z of [-0.62, 0.55]) parts.push(bake(box(0.02, 0.4, 0.025), { color: DARK, x: x * 1.005, y: 0.62, z }));
  }
  for (const x of [-0.3, 0.3]) for (const z of [-1.25, -1.1, -0.95]) parts.push(bake(box(0.34, 0.02, 0.07), { color: DARK, x, y: 0.79, z }));
  parts.push(bake(box(0.9, 0.2, 0.06), { color: DARK, y: 0.48, z: -2.17 }));
  for (const x of [-0.62, 0.62]) parts.push(bake(box(0.5, 0.2, 0.08), { color: DARK, x, y: 0.62, z: -2.16 }));
  parts.push(bake(box(1.4, 0.16, 0.5), { color: DARK, y: 0.34, z: 2.05 }));
  for (const x of [-0.4, 0, 0.4]) parts.push(bake(box(0.04, 0.14, 0.5), { color: PAINT_SHADOW, x, y: 0.34, z: 2.1 }));
  // rear wing, front splitter, mirrors, exhaust tips
  parts.push(bake(box(2.0, 0.07, 0.55), { color: DARK, y: 1.15, z: 1.95 }));
  for (const x of [-0.75, 0.75]) parts.push(bake(box(0.08, 0.38, 0.4), { color: DARK, x, y: 0.95, z: 1.95 }));
  for (const x of [-1.0, 1.0]) paint.push(bake(box(0.06, 0.28, 0.6), { x, y: 1.18, z: 1.95 }));
  parts.push(bake(box(2.05, 0.1, 0.55), { color: DARK, y: 0.3, z: -2.1 }));
  for (const x of [-0.98, 0.98]) paint.push(bake(box(0.2, 0.12, 0.2), { x, y: 1.0, z: -0.55 }));
  for (const x of [-0.45, 0.45]) parts.push(bake(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 8), { color: RIM, x, y: 0.42, z: 2.2, rx: Math.PI / 2 }));
  // lights (unlit, always bright)
  for (const x of [-0.62, 0.62]) lamps.push(bake(box(0.42, 0.13, 0.1), { color: 0xfff2c0, x, y: 0.62, z: -2.18 }));
  lamps.push(bake(box(1.5, 0.1, 0.08), { color: 0xff3030, y: 0.74, z: 2.17 }));

  const paintMat = new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.32, clearcoat: 0, clearcoatRoughness: 0.08 });
  const paintMesh = new THREE.Mesh(merged(paint), paintMat);
  body.add(paintMesh, new THREE.Mesh(merged(parts), PARTS_MAT), new THREE.Mesh(merged(lamps), LAMP_MAT));

  // turbo flames (toggled by the game)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.9, toneMapped: false });
  const flames = [];
  for (const x of [-0.45, 0.45]) {
    const f = new THREE.Mesh(FLAME_GEO, flameMat);
    f.position.set(x, 0.42, 2.95); f.rotation.x = Math.PI / 2; f.visible = false; body.add(f); flames.push(f);
  }

  // wheels: tyre, tread, rim lip, hub and 5 spokes merged into one mesh per wheel. Each wheel = pivot (steering, front only) > spin group
  const spokes = [];
  for (let i = 0; i < 5; i++) spokes.push(bake(box(0.44, 0.07, 0.5), { color: RIM, rx: (i * Math.PI) / 5 }));
  const wheelGeo = merged([
    bake(new THREE.CylinderGeometry(0.42, 0.42, 0.4, 20), { color: TIRE, rz: Math.PI / 2 }),
    bake(new THREE.CylinderGeometry(0.425, 0.425, 0.28, 20), { color: 0x0e0e0e, rz: Math.PI / 2 }),
    bake(new THREE.CylinderGeometry(0.3, 0.3, 0.42, 14), { color: DARK, rz: Math.PI / 2 }),
    bake(new THREE.CylinderGeometry(0.29, 0.29, 0.43, 14), { color: RIM, rz: Math.PI / 2 }),
    bake(new THREE.CylinderGeometry(0.2, 0.2, 0.44, 12), { color: DARK, rz: Math.PI / 2 }),
    bake(new THREE.CylinderGeometry(0.09, 0.09, 0.46, 8), { color: RIM, rz: Math.PI / 2 }),
    ...spokes,
  ]);
  const wheels = [], frontPivots = [];
  for (const [x, z] of [[-1.0, -1.38], [1.0, -1.38], [-1.0, 1.4], [1.0, 1.4]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.42, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(wheelGeo, PARTS_MAT));
    pivot.add(spin); root.add(pivot);
    wheels.push(spin);
    if (z < 0) frontPivots.push(pivot);
  }

  const shield = new THREE.Mesh(new THREE.SphereGeometry(2.7, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }));
  shield.position.y = 0.9; shield.visible = false; root.add(shield);

  // soft blob shadow on the ground (lives in the scene, positioned by the game)
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.6), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true }));
  blob.rotation.x = -Math.PI / 2;
  const blobHolder = new THREE.Group(); blobHolder.add(blob);

  const label = name ? nameLabel(name, color) : null;
  if (label) root.add(label);
  void IDENT;
  /** High tier: glossy clear-coat on the paint (costs a bit more GPU). */
  const setGloss = (on) => { const v = on ? 0.9 : 0; if (paintMat.clearcoat !== v) { paintMat.clearcoat = v; paintMat.needsUpdate = true; } };
  const setEnv = (map) => { for (const m of [paintMat, PARTS_MAT]) { if (m.envMap !== map) { m.envMap = map; m.envMapIntensity = 0.5; m.needsUpdate = true; } } };
  return { root, body, wheels, frontPivots, label, shield, flames, blob: blobHolder, setGloss, setEnv };
}
