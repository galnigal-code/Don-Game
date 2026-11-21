import * as THREE from 'three';

// Small pool of expanding, fading spheres (explosions, pickup sparkles, shield puffs).
export class Effects {
  constructor(scene, size = 14) {
    this.geo = new THREE.SphereGeometry(1, 12, 8);
    this.items = [];
    for (let i = 0; i < size; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
      m.visible = false; scene.add(m);
      this.items.push({ mesh: m, t: 0, life: 0, max: 1 });
    }
    this.next = 0;
  }
  spawn(x, y, z, color = 0xff8a1f, maxScale = 4, life = 0.5) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    it.t = 0; it.life = life; it.max = maxScale;
    it.mesh.material.color.setHex(color);
    it.mesh.position.set(x, y, z); it.mesh.visible = true;
  }
  explosion(x, y, z) { this.spawn(x, y, z, 0xff6a00, 5, 0.6); this.spawn(x, y + 0.3, z, 0xffe27a, 2.8, 0.4); }
  sparkle(x, y, z) { this.spawn(x, y, z, 0xffe27a, 2.2, 0.4); }
  puff(x, y, z) { this.spawn(x, y, z, 0x5fd6ff, 3, 0.35); }
  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) { it.mesh.visible = false; continue; }
      const sc = 0.4 + (it.max - 0.4) * Math.sqrt(k);
      it.mesh.scale.setScalar(sc);
      it.mesh.material.opacity = 0.9 * (1 - k);
    }
  }
}
