// Visual car dynamics (pure math, no three): a spring-damper for the body, lean and nose dip, and the front-wheel angle.
// These only move the model; the simulation never reads them.

/** One spring-damper axis (semi-implicit Euler, stable for any dt thanks to sub-stepping). */
export class Spring {
  constructor(k = 90, c = 9) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  kick(dv) { this.v += dv; }
  step(target, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Front wheels turn with the steering. Three.js rotation.y is positive COUNTER-CLOCKWISE seen from above, i.e. it turns the nose
 * to the LEFT (nose is -z). The game's +steer is RIGHT, so the angle is negative for +steer (see the direction contract).
 */
export function wheelSteerAngle(steer, speedFrac = 1) {
  return -clamp(steer, -1, 1) * 0.5 * (1 - 0.35 * clamp(speedFrac, 0, 1));
}

/** Per-car suspension state: heave (up/down), pitch (nose up/down) and roll (lean). */
export class CarSuspension {
  constructor() { this.heave = new Spring(110, 8); this.pitch = new Spring(70, 7); this.roll = new Spring(60, 6); this.prevVy = 0; this.prevSpeed = 0; this.lean = 0; }
  /** car: { vy, speed, steer }. Returns { y, pitch, roll } offsets to add to the body. */
  update(car, dt, cruise = 40) {
    if (!(dt > 0)) return { y: this.heave.x, pitch: this.pitch.x, roll: this.roll.x };
    const dvy = clamp(car.vy - this.prevVy, -25, 25);
    const acc = clamp((car.speed - this.prevSpeed) / dt, -40, 40);
    this.prevVy = car.vy; this.prevSpeed = car.speed;
    this.heave.kick(-dvy * 0.35);                                  // the body lags behind a sudden up/down jolt
    const y = clamp(this.heave.step(0, dt), -0.28, 0.2);
    const pitch = this.pitch.step(clamp(-acc * 0.0016, -0.05, 0.05), dt);        // nose dips under braking, lifts when accelerating (acc is signed)
    const roll = this.roll.step(clamp(car.steer, -1, 1) * clamp(car.speed / cruise, 0, 1.3) * 0.075, dt);
    return { y, pitch, roll };
  }
}
