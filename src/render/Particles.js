import * as THREE from 'three';

// One draw call for all dust, flames and debris: a pool of soft round points.
const VERT = `
  attribute float size; attribute float alpha; attribute vec3 pcolor;
  uniform float uScale; varying float vAlpha; varying vec3 vColor;
  void main() {
    vAlpha = alpha; vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, size * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  varying float vAlpha; varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.15, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }`;

export class Particles {
  constructor(scene, max = 360) {
    this.max = max; this.n = 0; this.next = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max); this.size0 = new Float32Array(max);
    this.a0 = new Float32Array(max); this.grow = new Float32Array(max); this.drag = new Float32Array(max); this.up = new Float32Array(max);
    this.life.fill(0); this.age.fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tmp = new THREE.Color();
  }

  /** Spawn one particle. */
  emit(x, y, z, vx, vy, vz, { size = 1, life = 0.6, color = 0xd9b27a, alpha = 0.4, grow = 1.2, drag = 1.5, up = 0 } = {}) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size0[i] = size; this.life[i] = life; this.age[i] = 0; this.a0[i] = alpha; this.grow[i] = grow; this.drag[i] = drag; this.up[i] = up;
    this.tmp.setHex(color); this.col[i * 3] = this.tmp.r; this.col[i * 3 + 1] = this.tmp.g; this.col[i * 3 + 2] = this.tmp.b;
  }

  update(dt, camera, viewportHeightPx) {
    this.uniforms.uScale.value = (viewportHeightPx * 0.5) / Math.tan((camera.fov * Math.PI / 180) / 2);
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.age[i] += dt;
      const k = Math.min(1, this.age[i] / this.life[i]);
      const f = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= f; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * f + this.up[i] * dt; this.vel[i * 3 + 2] *= f;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.size0[i] * (1 + this.grow[i] * k);
      this.alpha[i] = this.a0[i] * (1 - k) * (1 - k * 0.3);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.size.needsUpdate = g.attributes.alpha.needsUpdate = g.attributes.pcolor.needsUpdate = true;
  }
}
