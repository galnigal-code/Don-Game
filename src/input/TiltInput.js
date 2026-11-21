import { CONFIG } from '../config.js';
import { DEG, wrapPi, rollFromMotion, smoothAngle, steerFromRoll } from './tiltMath.js';

const KEY = 'dongame.calib';

export function detectIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Calibration protocol steps, in order. */
export const STEPS = ['neutral', 'right', 'left', 'center', 'done'];

const P = {
  HOLD_TOL: 2.0 * DEG,          // "held still" = stays within this of the reference
  NEUTRAL_MS: 900,              // hold straight this long
  TILT_MS: 500,                 // hold a tilt this long
  CENTER_MS: 700,               // hold the middle this long
  TILT_MIN: 14 * DEG,           // a real tilt
  CENTER_TOL: 10 * DEG,         // "back in the middle"
  REPOSITION: 55 * DEG,         // a hold this far from "straight" is re-positioning the phone (e.g. portrait -> landscape), not steering
  JUMP: 20 * DEG,               // a one-sample jump right after the screen rotated = a frame change, not motion
  JUMP_WINDOW_MS: 600,
};

/**
 * Phone-as-steering-wheel input. steer: -1 (left) .. +1 (right).
 *
 * THE DIRECTION CONTRACT: turning the phone clockwise (right edge down) steers right, counter-clockwise steers left.
 * The calibration protocol (neutral -> right -> left -> centre) measures this on the actual device, so it holds on every
 * phone/browser, and it only reacts to poses that are HELD, so picking the phone up, rotating the screen or fidgeting
 * can never set the direction by accident. Covered by tests/unit/tilt.test.js and tests/real-sensor.mjs.
 */
export class TiltInput {
  constructor() {
    this.isIOS = detectIOS();
    this.sensitivity = 'normal';
    this.invert = CONFIG.tilt.INVERT;
    this.roll = 0; this.rawRoll = 0; this.hasSample = false; this.lastEventMs = 0;
    this.zero = 0; this.calibrated = false;
    this.raw = { x: 0, y: 0, angle: 0, planar: 0 };
    this.started = false;
    this.lastAngle = null; this.angleChangeAt = -1e9; this.jumps = 0;
    this.holdRef = 0; this.holdSince = 0; this.neutral = null;
    this.step = 'neutral'; this.base = null; this.rightSign = 0; this.protocolOn = false;
    this.learned = null;           // diagnostics: what the last calibration measured
    this.onMotion = this.onMotion.bind(this);
    this.load();
  }

  load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j && ['low', 'normal', 'high'].includes(j.sensitivity)) this.sensitivity = j.sensitivity;
      // the learned direction is NOT restored: it is measured again on every calibration
    } catch { /* storage unavailable */ }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ sensitivity: this.sensitivity })); } catch { /* ignore */ }
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

  /* ---------------- sensor stream ---------------- */

  onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null) return;
    const angle = globalThis.screen?.orientation?.angle ?? globalThis.window?.orientation ?? 0;
    const r = rollFromMotion(a, this.isIOS);
    this.raw = { x: a.x, y: a.y, angle, planar: r.planar };
    if (r.planar < CONFIG.tilt.PLANAR_MIN) return;   // phone is lying flat: wheel angle is undefined
    const now = performance.now();
    if (this.lastAngle !== null && angle !== this.lastAngle) this.angleChangeAt = now;
    this.lastAngle = angle;
    const dt = Math.min(0.2, Math.max(0.001, (now - this.lastEventMs) / 1000));
    const alpha = 1 - Math.exp(-dt / CONFIG.tilt.SMOOTH_TAU);
    const wasActive = this.hasSample && now - this.lastEventMs < 1500;
    this.lastEventMs = now;

    if (!this.hasSample || !wasActive) {
      // first sample, or the sensor was silent for a while: start over from here
      this.hasSample = true; this.roll = r.roll; this.rawRoll = r.roll;
      if (!this.calibrated) this.zero = r.roll;
      this.holdRef = r.roll; this.holdSince = now; this.neutral = null;
      if (this.protocolOn) this.restartProtocol();
      return;
    }

    // Right after the screen rotated, some browsers re-express the axes in the new screen frame, which makes the angle
    // jump without the phone moving. Compensate so steering and the calibration are not disturbed.
    const jump = wrapPi(r.roll - this.rawRoll);
    if (now - this.angleChangeAt < P.JUMP_WINDOW_MS && Math.abs(jump) > P.JUMP) {
      this.jumps++;
      this.roll += jump; this.zero += jump; this.holdRef += jump;
      if (this.base != null) this.base += jump;
      if (this.neutral != null) this.neutral += jump;
    }
    this.rawRoll = r.roll;
    this.roll = smoothAngle(this.roll, r.roll, alpha);

    // "held still": track the last pose that stayed within a small tolerance
    if (Math.abs(wrapPi(this.roll - this.holdRef)) > P.HOLD_TOL) { this.holdRef = this.roll; this.holdSince = now; }
    else if (now - this.holdSince > 600) this.neutral = this.holdRef;
  }

  get active() { return this.hasSample && performance.now() - this.lastEventMs < 1500; }
  heldFor(ms) { return performance.now() - this.holdSince >= ms; }

  get options() {
    return { deadZone: CONFIG.tilt.DEAD_ZONE_DEG * DEG, maxAngle: CONFIG.tilt.MAX_ANGLE_DEG[this.sensitivity] * DEG, invert: this.invert };
  }
  get steer() { return this.active ? steerFromRoll(this.roll, this.zero, this.options) : 0; }

  /* ---------------- guided calibration ---------------- */

  /** Start the protocol (called when the calibration screen opens). */
  beginProtocol() { this.protocolOn = true; this.restartProtocol(); }
  endProtocol() { this.protocolOn = false; }
  restartProtocol() { this.step = 'neutral'; this.base = null; this.rightSign = 0; this.holdSince = performance.now(); this.holdRef = this.roll; }

  /** Where the preview gauge measures from. */
  get reference() { return this.step === 'done' ? this.zero : (this.base ?? this.neutral ?? this.zero); }
  get previewSteer() { return this.active ? steerFromRoll(this.roll, this.reference, this.options) : 0; }
  get previewDeg() { return this.active ? wrapPi(this.roll - this.reference) / DEG * (this.invert ? -1 : 1) : 0; }
  get stepIndex() { return STEPS.indexOf(this.step); }
  /** True when the calibration is finished (or there is no sensor to calibrate). */
  get ready() { return this.step === 'done' || !this.active; }
  /** Direction has been measured on this device (steps right + left passed). */
  get dirLearned() { return this.stepIndex >= STEPS.indexOf('center'); }

  /** Advance the protocol; call every frame while the calibration screen is open. */
  updateProtocol() {
    if (!this.protocolOn || !this.active || this.step === 'done') return;
    if (this.step === 'neutral') {
      if (this.heldFor(P.NEUTRAL_MS)) { this.base = this.holdRef; this.step = 'right'; this.holdSince = performance.now(); }
      return;
    }
    const exc = wrapPi(this.holdRef - this.base);
    const held = (ms) => this.heldFor(ms);
    if (Math.abs(exc) > P.REPOSITION && held(P.TILT_MS)) { this.restartProtocol(); return; }   // moved the whole phone: start over
    if (this.step === 'right') {
      if (held(P.TILT_MS) && Math.abs(exc) >= P.TILT_MIN) {
        this.rightSign = Math.sign(exc);
        this.invert = this.rightSign < 0;           // the pose the player calls "right" defines the direction
        this.learned = { rightExcDeg: exc / DEG, raw: { ...this.raw }, invert: this.invert };
        this.step = 'left';
      }
    } else if (this.step === 'left') {
      if (held(P.TILT_MS) && Math.abs(exc) >= P.TILT_MIN && Math.sign(exc) === -this.rightSign) this.step = 'center';
    } else if (this.step === 'center') {
      if (held(P.CENTER_MS) && Math.abs(exc) <= P.CENTER_TOL) {
        this.zero = this.holdRef; this.calibrated = true; this.step = 'done';
        this.save();
      }
    }
  }

  /** Manual override ("flip direction" button): keeps the calibration, just reverses the mapping. */
  flipDirection() { this.invert = !this.invert; this.save(); }

  /** Called by the Start button. With a finished protocol the zero is already set. */
  calibrate() {
    if (this.step !== 'done' && this.hasSample) { this.zero = this.base ?? this.neutral ?? this.roll; }
    this.calibrated = true;
    this.protocolOn = false;
    this.save();
  }
}
