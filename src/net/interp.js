// Smooth display of another phone's car: a short buffer of timestamped states, shown ~0.12 s in the past so there is always a
// "next" sample to interpolate towards. Pure logic.
export const DELAY = 0.12;
const MAX_EXTRAPOLATE = 0.25;
const SIZE = 16;

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };

export class RemoteTrack {
  constructor() { this.buf = []; this.last = null; }
  /** state: output of unpackCar. Old or duplicate timestamps are dropped (messages can arrive out of order). */
  push(st) {
    const b = this.buf;
    if (b.length && st.t <= b[b.length - 1].t) {
      if (st.t < b[0].t) return;                      // older than everything we hold
      const i = b.findIndex((x) => x.t >= st.t);
      if (b[i].t === st.t) return;
      b.splice(i, 0, st);                             // late, but inside the window: keep it ordered
    } else b.push(st);
    if (b.length > SIZE) b.shift();
  }
  get empty() { return this.buf.length === 0; }

  /**
   * State to show at time t (seconds, the sender's race clock minus DELAY).
   * Returns { ...fields, stale } or null when nothing was ever received. `stale` = the connection to that car stalled.
   */
  sample(t) {
    const b = this.buf;
    if (!b.length) return null;
    if (t <= b[0].t) return { ...b[0], stale: false };
    const lastS = b[b.length - 1];
    if (t >= lastS.t) {
      const dt = Math.min(t - lastS.t, MAX_EXTRAPOLATE);
      const moving = lastS.state === 'driving';
      return { ...lastS, s: lastS.s + (moving ? lastS.speed * dt : 0), stale: t - lastS.t > MAX_EXTRAPOLATE };
    }
    let i = 1;
    while (b[i].t < t) i++;
    const a = b[i - 1], c = b[i], k = (t - a.t) / (c.t - a.t || 1);
    // discrete things (state, effects) switch at the later sample's time; numbers blend
    const near = k < 0.5 ? a : c;
    return {
      ...near, s: lerp(a.s, c.s, k), d: lerp(a.d, c.d, k), h: lerp(a.h, c.h, k), yaw: lerpAngle(a.yaw, c.yaw, k),
      speed: lerp(a.speed, c.speed, k), steer: lerp(a.steer, c.steer, k), stale: false,
    };
  }
}
