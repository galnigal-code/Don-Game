import { CONFIG } from '../config.js';
import { DEG, wrapPi, rollFromMotion, smoothAngle, steerFromRoll } from './tiltMath.js';

const KEY = 'dongame.calib';

export function detectIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Phone-as-steering-wheel input. steer: -1 (left) .. +1 (right). */
export class TiltInput {
  constructor() {
    this.isIOS = detectIOS();
    this.sensitivity = 'normal';
    this.invert = CONFIG.tilt.INVERT;
    this.roll = 0; this.hasSample = false; this.lastEventMs = 0;
    this.zero = 0; this.calibrated = false;
    this.neutral = null; this.stableRef = 0; this.stableSince = 0;
    this.raw = { x: 0, y: 0, angle: 0, planar: 0 };
    this.started = false;
    this.dirTest = false; this.dirLearned = false; this.dirRef = 0;
    this.onMotion = this.onMotion.bind(this);
    this.load();
  }

  load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j) {
        if (['low', 'normal', 'high'].includes(j.sensitivity)) this.sensitivity = j.sensitivity;
        if (typeof j.invert === 'boolean') this.invert = j.invert;
      }
    } catch { /* storage unavailable */ }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ sensitivity: this.sensitivity, invert: this.invert })); } catch { /* ignore */ }
  }

  /** iOS 13+ needs an explicit permission, requested from a tap. Elsewhere it resolves true. */
  async requestPermission() {
    const DM = window.DeviceMotionEvent;
    if (DM && typeof DM.requestPermission === 'function') {
      try { return (await DM.requestPermission()) === 'granted'; } catch { return false; }
    }
    return true;
  }

  start() {
    if (this.started || !('DeviceMotionEvent' in window)) return;
    this.started = true;
    window.addEventListener('devicemotion', this.onMotion);
  }

  onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null) return;
    const angle = globalThis.screen?.orientation?.angle ?? globalThis.window?.orientation ?? 0;
    const r = rollFromMotion(a, angle, this.isIOS);
    this.raw = { x: a.x, y: a.y, angle, planar: r.planar };
    if (r.planar < CONFIG.tilt.PLANAR_MIN) return;   // phone is lying flat: wheel angle is undefined
    const now = performance.now();
    // time-based smoothing so the feel does not depend on the sensor's event rate
    const dt = Math.min(0.2, Math.max(0.001, (now - this.lastEventMs) / 1000));
    const alpha = 1 - Math.exp(-dt / CONFIG.tilt.SMOOTH_TAU);
    this.lastEventMs = now;
    if (!this.hasSample) {
      this.hasSample = true; this.roll = r.roll;
      if (!this.calibrated) this.zero = r.roll;
      this.stableRef = r.roll; this.stableSince = now;
    } else {
      this.roll = smoothAngle(this.roll, r.roll, alpha);
    }
    // remember the last pose that was held still for 0.6 s: that is the "straight" the player means
    if (Math.abs(wrapPi(this.roll - this.stableRef)) > 1.5 * DEG) { this.stableRef = this.roll; this.stableSince = now; }
    else if (now - this.stableSince > 600) this.neutral = this.stableRef;
  }

  get active() { return this.hasSample && performance.now() - this.lastEventMs < 1500; }

  get options() {
    return {
      deadZone: CONFIG.tilt.DEAD_ZONE_DEG * DEG,
      maxAngle: CONFIG.tilt.MAX_ANGLE_DEG[this.sensitivity] * DEG,
      invert: this.invert,
    };
  }
  get steer() { return this.active ? steerFromRoll(this.roll, this.zero, this.options) : 0; }

  /** Steering relative to the held-still pose; used by the calibration screen preview. */
  get previewSteer() { return this.active ? steerFromRoll(this.roll, this.neutral ?? this.zero, this.options) : 0; }
  get previewDeg() { return this.active ? wrapPi(this.roll - (this.neutral ?? this.zero)) / DEG * (this.invert ? -1 : 1) : 0; }

  /**
   * Direction test: the player is told to tilt RIGHT (like turning a wheel clockwise). Whatever sign the
   * sensor reports for that physical motion defines "right" on this device. Independent of platform and
   * screen orientation conventions.
   */
  beginDirectionTest() {
    this.dirTest = true; this.dirLearned = false;
    this.dirRef = this.neutral ?? this.roll;
  }
  updateDirectionTest() {
    if (!this.dirTest || !this.active) return;
    if (this.neutral != null && Math.abs(wrapPi(this.roll - this.dirRef)) < 2 * DEG) this.dirRef = this.neutral;
    const exc = wrapPi(this.roll - this.dirRef);
    if (Math.abs(exc) < CONFIG.tilt.DIRECTION_TEST_DEG * DEG) return;
    this.invert = exc < 0;           // tilted "right" but the sensor says negative -> flip
    this.dirTest = false; this.dirLearned = true;
    this.save();
  }
  /** Manual override from the "flip direction" button: stops the automatic test. */
  flipDirection() { this.invert = !this.invert; this.dirTest = false; this.dirLearned = false; this.save(); }

  calibrate() {
    if (this.hasSample) this.zero = this.neutral ?? this.roll;
    this.calibrated = true;
    this.save();
  }
}
