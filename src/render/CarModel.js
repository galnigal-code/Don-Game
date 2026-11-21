import * as THREE from 'three';

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
function profileGeometry(points, width, bevel = 0.06) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);     // +x (nose) -> -z (forward), extrusion axis -> x (width)
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

export function createCarModel(color, name = null) {
  const root = new THREE.Group();       // positioned/oriented by the game
  const body = new THREE.Group();       // tilts (roll/pitch/spin) on top of root
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.1, roughness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x27323f, metalness: 0.2, roughness: 0.12 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.95 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xd5d8de, metalness: 0.4, roughness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe8a0, emissiveIntensity: 1.3 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1c1c, emissiveIntensity: 1.1 });
  const add = (geo, m, x, y, z, parent = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };

  // lower body: low wedge with a sloping nose and a raised tail
  add(profileGeometry([[-2.15, 0.3], [-2.15, 0.82], [-1.5, 0.9], [-0.2, 0.84], [1.2, 0.74], [1.95, 0.5], [2.2, 0.38], [2.15, 0.3]], 1.9), paint, 0, 0, 0);
  // cabin: glass greenhouse with a body-coloured roof
  add(profileGeometry([[-1.15, 0.82], [-0.75, 1.3], [0.35, 1.32], [1.0, 0.84]], 1.46, 0.05), glass, 0, 0, 0);
  add(profileGeometry([[-0.78, 1.3], [-0.7, 1.36], [0.3, 1.38], [0.36, 1.31]], 1.4, 0.03), paint, 0, 0, 0);
  // racing stripes
  for (const x of [-0.17, 0.17]) add(new THREE.BoxGeometry(0.13, 0.03, 3.0), white, x, 0.86, -0.4).rotation.x = 0.045;
  // wheel arches (dark discs hint at the cut-outs)
  for (const [x, z] of [[-0.97, -1.38], [0.97, -1.38], [-0.97, 1.4], [0.97, 1.4]]) {
    const arch = add(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 14), dark, x * 1.0, 0.45, z); arch.rotation.z = Math.PI / 2;
  }
  // rear wing, front splitter, lights, mirrors, exhausts
  add(new THREE.BoxGeometry(2.0, 0.07, 0.55), dark, 0, 1.15, 1.95);
  for (const x of [-0.75, 0.75]) add(new THREE.BoxGeometry(0.08, 0.38, 0.4), dark, x, 0.95, 1.95);
  for (const x of [-1.0, 1.0]) add(new THREE.BoxGeometry(0.06, 0.28, 0.6), paint, x, 1.18, 1.95);
  add(new THREE.BoxGeometry(2.05, 0.1, 0.55), dark, 0, 0.3, -2.1);
  for (const x of [-0.62, 0.62]) add(new THREE.BoxGeometry(0.42, 0.13, 0.1), lamp, x, 0.62, -2.18);
  add(new THREE.BoxGeometry(1.5, 0.1, 0.08), tail, 0, 0.74, 2.17);
  for (const x of [-0.98, 0.98]) add(new THREE.BoxGeometry(0.2, 0.12, 0.2), paint, x, 1.0, -0.55);
  const flames = [];
  for (const x of [-0.45, 0.45]) {
    add(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 8), rim, x, 0.42, 2.2).rotation.x = Math.PI / 2;
    const f = add(new THREE.ConeGeometry(0.17, 1.4, 8), new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.9, toneMapped: false }), x, 0.42, 2.95);
    f.rotation.x = Math.PI / 2; f.visible = false; flames.push(f);
  }

  const wheels = [];
  for (const [x, z] of [[-1.0, -1.38], [1.0, -1.38], [-1.0, 1.4], [1.0, 1.4]]) {
    const w = new THREE.Group(); w.position.set(x, 0.42, z);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.4, 16), tire); t.rotation.z = Math.PI / 2; w.add(t);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.42, 10), rim); r.rotation.z = Math.PI / 2; w.add(r);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.5), dark); w.add(hub);   // spokes: shows the spin
    root.add(w); wheels.push(w);
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
  return { root, body, wheels, label, shield, flames, blob: blobHolder };
}
