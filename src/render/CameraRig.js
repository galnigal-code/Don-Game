import * as THREE from 'three';

// Chase camera: behind and above the car, smoothed. FOV widens and camera pulls back during turbo.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.wantPos = new THREE.Vector3(); this.wantLook = new THREE.Vector3();   // reused every frame (no garbage)
    this.snap = true; this.turbo = 0; this.shakeAmp = 0; this.t = 0;
  }
  reset() { this.snap = true; this.turbo = 0; this.shakeAmp = 0; }
  shake(a) { this.shakeAmp = Math.max(this.shakeAmp, a); }
  /** carPos: THREE.Vector3 world position of car, heading: world heading incl. yaw, turbo: bool */
  update(dt, carPos, heading, turboOn) {
    this.t += dt;
    this.turbo += ((turboOn ? 1 : 0) - this.turbo) * (1 - Math.exp(-5 * dt));
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    const back = 6.5 + 1.5 * this.turbo;
    const wantPos = this.wantPos.set(carPos.x - fx * back, carPos.y + 2.8, carPos.z - fz * back);
    const wantLook = this.wantLook.set(carPos.x + fx * 4, carPos.y + 1.0, carPos.z + fz * 4);
    if (this.snap) { this.pos.copy(wantPos); this.look.copy(wantLook); this.snap = false; }
    else {
      this.pos.lerp(wantPos, 1 - Math.exp(-8 * dt));
      this.look.lerp(wantLook, 1 - Math.exp(-6 * dt));
    }
    this.camera.position.copy(this.pos);
    if (this.shakeAmp > 0.001) {
      this.camera.position.x += Math.sin(this.t * 60) * this.shakeAmp;
      this.camera.position.y += Math.cos(this.t * 53) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-8 * dt);
    }
    this.camera.lookAt(this.look);
    const fov = (this.camera.userData.baseFov ?? 65) + 13 * this.turbo;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
}
