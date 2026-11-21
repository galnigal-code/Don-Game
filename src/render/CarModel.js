import * as THREE from 'three';

// Simple low-poly sports car (nose points to -Z). Replaced by a nicer model in M6.
export function createCarModel(color) {
  const root = new THREE.Group();       // positioned/oriented by the game
  const body = new THREE.Group();       // tilts (roll/pitch/spin) on top of root
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.2, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x20262e, metalness: 0.6, roughness: 0.15 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.7, roughness: 0.3 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe8a0, emissiveIntensity: 1.2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2020, emissiveIntensity: 1.0 });

  const add = (geo, m, x, y, z, parent = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };

  add(new THREE.BoxGeometry(1.9, 0.5, 4.3), paint, 0, 0.55, 0);
  add(new THREE.BoxGeometry(1.7, 0.3, 1.5), paint, 0, 0.62, -1.55).rotation.x = 0.12;   // hood
  add(new THREE.BoxGeometry(1.5, 0.5, 1.7), glass, 0, 0.98, 0.25);                       // cabin
  add(new THREE.BoxGeometry(2.0, 0.1, 0.6), dark, 0, 1.05, 2.0);                         // rear wing
  add(new THREE.BoxGeometry(0.12, 0.35, 0.3), dark, -0.7, 0.85, 2.0);
  add(new THREE.BoxGeometry(0.12, 0.35, 0.3), dark, 0.7, 0.85, 2.0);
  add(new THREE.BoxGeometry(2.0, 0.18, 0.5), dark, 0, 0.32, -2.15);                      // front splitter
  add(new THREE.BoxGeometry(0.4, 0.15, 0.1), lamp, -0.65, 0.62, -2.16);
  add(new THREE.BoxGeometry(0.4, 0.15, 0.1), lamp, 0.65, 0.62, -2.16);
  add(new THREE.BoxGeometry(0.45, 0.15, 0.1), tail, -0.6, 0.65, 2.16);
  add(new THREE.BoxGeometry(0.45, 0.15, 0.1), tail, 0.6, 0.65, 2.16);
  add(new THREE.BoxGeometry(0.15, 0.04, 3.2), dark, 0, 0.82, 0);                         // stripe

  const wheels = [];
  for (const [x, z] of [[-1.0, -1.35], [1.0, -1.35], [-1.0, 1.4], [1.0, 1.4]]) {
    const w = new THREE.Group(); w.position.set(x, 0.4, z);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.34, 14), tire); t.rotation.z = Math.PI / 2; w.add(t);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.36, 8), rim); r.rotation.z = Math.PI / 2; w.add(r);
    root.add(w); wheels.push(w);
  }
  return { root, body, wheels };
}
