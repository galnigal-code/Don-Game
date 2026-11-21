import * as THREE from 'three';

function boxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#ffb300'); grad.addColorStop(0.5, '#ff4d8d'); grad.addColorStop(1, '#6a5cff');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 8; g.strokeRect(6, 6, 116, 116);
  g.fillStyle = '#fff'; g.font = '700 92px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('?', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAT = {
  red: new THREE.MeshStandardMaterial({ color: 0xd0201c, roughness: 0.5 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  oil: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.93, polygonOffset: true, polygonOffsetFactor: -2 }),
  bullet: new THREE.MeshBasicMaterial({ color: 0xffe94a }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffa31a }),
};

function makeMine() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.3, 16), MAT.red); disc.position.y = 0.15; g.add(disc);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe94a, emissive: 0xffd000, emissiveIntensity: 1 }));
  light.position.y = 0.42; g.add(light); g.userData.light = light;
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 6), MAT.dark);
    const a = i / 6 * Math.PI * 2; sp.position.set(Math.cos(a) * 0.7, 0.45, Math.sin(a) * 0.7); g.add(sp);
  }
  return g;
}
function makeOil() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(2.1, 24), MAT.oil);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.07;
  const g = new THREE.Group(); g.add(m); return g;
}
function makeBarrel() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 1.2, 14), MAT.orange); b.position.y = 0.6; g.add(b);
  for (const y of [0.35, 0.85]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.67, 0.67, 0.14, 14), MAT.white); r.position.y = y; g.add(r); }
  return g;
}
function makeMissile() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.0, 10), MAT.white);
  body.rotation.x = Math.PI / 2; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 10), MAT.red); nose.rotation.x = -Math.PI / 2; nose.position.z = -1.35; g.add(nose);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.5), MAT.red);
    fin.position.z = 0.8; fin.rotation.z = i * Math.PI / 2; fin.translateY(0.3); g.add(fin);
  }
  const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 8), MAT.flame); fl.rotation.x = Math.PI / 2; fl.position.z = 1.6; g.add(fl); g.userData.flame = fl;
  g.position.y = 0.9;
  const wrap = new THREE.Group(); wrap.add(g); return wrap;
}
function makeBullet() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.1), MAT.bullet);
  const g = new THREE.Group(); m.position.y = 0.9; g.add(m); return g;
}
const MAKERS = { mine: makeMine, oil: makeOil, barrel: makeBarrel, missile: makeMissile, bullet: makeBullet };

export class EntityViews {
  constructor(scene, track) {
    this.scene = scene; this.track = track;
    this.group = new THREE.Group(); scene.add(this.group);
    this.boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    this.boxMat = new THREE.MeshStandardMaterial({ map: boxTexture(), emissive: 0x442266, emissiveIntensity: 0.6, roughness: 0.4 });
    this.boxes = []; this.meshes = new Map();
    this.tmp = {}; this.smp = {};
  }

  setWorld(world) {
    for (const b of this.boxes) this.group.remove(b.mesh);
    for (const m of this.meshes.values()) this.group.remove(m);
    this.boxes = []; this.meshes.clear();
    for (const box of world.boxes) {
      const mesh = new THREE.Mesh(this.boxGeo, this.boxMat);
      this.group.add(mesh);
      this.boxes.push({ box, mesh });
    }
  }

  place(obj, s, d, h, withPitch = true) {
    const T = this.track;
    const sm = T.sample(s, this.smp);
    T.toWorld(s, d, h, this.tmp);
    obj.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
    obj.rotation.set(withPitch ? Math.atan2(sm.ty, Math.hypot(sm.tx, sm.tz)) : 0, -sm.heading, 0, 'YXZ');
  }

  update(time, world) {
    for (const { box, mesh } of this.boxes) {
      mesh.visible = box.t <= 0;
      if (!mesh.visible) continue;
      this.place(mesh, box.s, box.d, 1.3 + Math.sin(time * 2.2 + box.id) * 0.18, false);
      mesh.rotation.y = time * 1.6 + box.id;
      mesh.rotation.x = 0.35;
    }
    const seen = new Set();
    for (const e of world.entities) {
      if (!e.alive) continue;
      seen.add(e.id);
      let m = this.meshes.get(e.id);
      if (!m) { m = MAKERS[e.type](); this.meshes.set(e.id, m); this.group.add(m); }
      this.place(m, e.s, e.d, 0);
      if (e.type === 'mine') m.children[1].material.emissiveIntensity = 0.3 + 0.7 * (Math.sin(time * 12) > 0 ? 1 : 0);
      if (e.type === 'missile') m.children[0].userData.flame.scale.setScalar(0.8 + 0.4 * Math.sin(time * 40));
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.group.remove(m); this.meshes.delete(id); }
  }
}
