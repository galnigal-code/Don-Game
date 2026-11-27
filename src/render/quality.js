// Adaptive quality: watches the frame rate and steps the render quality down when the phone cannot keep up
// (and back up once, if it clearly can). Pure logic, unit-tested with synthetic frame times.

/** What each quality level changes. level 3 = best. */
export const LEVELS = [
  { name: 'low',    pixelRatio: 0.6, particles: 0.25, decor: 0,    labels: false, blobs: false, tex: false, normal: false, reflect: false, shadows: false },
  { name: 'medium', pixelRatio: 0.8, particles: 0.5,  decor: 0.5,  labels: true,  blobs: true,  tex: true,  normal: false, reflect: false, shadows: false },
  { name: 'good',   pixelRatio: 1.0, particles: 1,    decor: 1,    labels: true,  blobs: true,  tex: true,  normal: true,  reflect: true,  shadows: false },
  { name: 'high',   pixelRatio: 1.5, particles: 1,    decor: 1,    labels: true,  blobs: true,  tex: true,  normal: true,  reflect: true,  shadows: true },
];

export class QualityController {
  /**
   * start: initial level. lowFps/highFps: thresholds. downSecs: how long below lowFps before stepping down.
   * upSecs: how long above highFps before one step up. warmup: seconds ignored at the start (shader compilation, loading).
   */
  constructor({ start = 3, lowFps = 45, highFps = 57, downSecs = 3, upSecs = 10, warmup = 2.5, max = 3 } = {}) {
    this.level = Math.max(0, Math.min(max, start));
    this.max = max; this.lowFps = lowFps; this.highFps = highFps; this.downSecs = downSecs; this.upSecs = upSecs; this.warmup = warmup;
    this.t = 0; this.fps = 60; this.lowT = 0; this.highT = 0; this.cooldown = 0;
    this.upTried = new Set();     // a level that was already re-tried once and failed is not re-tried again (no flip-flopping)
    this.history = [];
  }

  /** Feed one frame (dt in seconds). Returns the new level when it changed, otherwise null. */
  frame(dt) {
    if (!(dt > 0)) return null;
    this.t += dt;
    if (this.t < this.warmup) return null;
    if (dt > 0.25) return null;                       // tab was hidden / a one-off hitch: not a performance signal
    this.fps += (1 / dt - this.fps) * Math.min(1, dt * 1.5);   // smoothed over about a second
    if (this.cooldown > 0) { this.cooldown -= dt; return null; }

    if (this.fps < this.lowFps) { this.lowT += dt; this.highT = 0; }
    else if (this.fps > this.highFps) { this.highT += dt; this.lowT = 0; }
    else { this.lowT = Math.max(0, this.lowT - dt); this.highT = Math.max(0, this.highT - dt); }

    if (this.lowT >= this.downSecs && this.level > 0) {
      if (this.upTried.has(this.level + 1) === false && this.history.length && this.history[this.history.length - 1].dir === 'up') this.upTried.add(this.level);
      return this.set(this.level - 1, 'down');
    }
    if (this.highT >= this.upSecs && this.level < this.max && !this.upTried.has(this.level + 1)) {
      this.upTried.add(this.level + 1);
      return this.set(this.level + 1, 'up');
    }
    return null;
  }

  set(level, dir) {
    this.level = level; this.lowT = 0; this.highT = 0; this.cooldown = 4; this.fps = dir === 'down' ? 50 : 56;
    this.history.push({ t: +this.t.toFixed(1), level, dir });
    return level;
  }
}

/** Starting level from simple device hints (cores, memory). A weak device starts one step lower. */
export function initialLevel({ cores = 8, memory = 8, touch = false } = {}) {
  if (cores <= 4 || memory <= 3 || touch) return 2;   // phones start without shadows; they can still step up if they have headroom
  return 3;
}
