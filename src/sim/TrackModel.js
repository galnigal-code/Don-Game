// Pure track model (no three.js). Builds a smooth centerline from trackData and
// exposes sampling in "track space": s (along), d (lateral, + = right), h (height).
import { CONFIG } from '../config.js';
import { TRACK_PATH, SEGMENTS, LEAD_IN, RUN_OUT, RAMPS, heightAt } from './trackData.js';

const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

function controlPoints(path, step = 50) {
  const pts = [{ x: 0, y: 0, z: 0 }];
  let theta = 0, s = -LEAD_IN, x = 0, z = 0;
  for (const [len, turnDeg] of path) {
    const n = Math.max(1, Math.round(len / step));
    const ds = len / n, dth = (turnDeg * Math.PI / 180) / n;
    for (let i = 0; i < n; i++) {
      const mid = theta + dth / 2;
      x += Math.sin(mid) * ds; z -= Math.cos(mid) * ds;
      theta += dth; s += ds;
      pts.push({ x, y: heightAt(s), z });
    }
  }
  return pts;
}

// Centripetal Catmull-Rom between p1 and p2, u in [0,1].
function crPoint(p0, p1, p2, p3, u, out) {
  const dist = (a, b) => Math.pow(Math.max(1e-6, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2), 0.25);
  const t0 = 0, t1 = t0 + dist(p0, p1), t2 = t1 + dist(p1, p2), t3 = t2 + dist(p2, p3);
  const t = t1 + (t2 - t1) * u;
  for (const k of ['x', 'y', 'z']) {
    const a1 = (t1 - t) / (t1 - t0) * p0[k] + (t - t0) / (t1 - t0) * p1[k];
    const a2 = (t2 - t) / (t2 - t1) * p1[k] + (t - t1) / (t2 - t1) * p2[k];
    const a3 = (t3 - t) / (t3 - t2) * p2[k] + (t - t2) / (t3 - t2) * p3[k];
    const b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2;
    const b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3;
    out[k] = (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2;
  }
  return out;
}

function sectionInfo(s, segments) {
  const base = CONFIG.track.HALF_WIDTH, canyon = CONFIG.track.CANYON_HALF_WIDTH;
  let hw = base, edgeLeft = 'sand', edgeRight = 'sand';
  for (const seg of segments) {
    if (seg.type === 'canyon') {
      const k = Math.min(smooth01((s - seg.from) / 30), smooth01((seg.to - s) / 30));
      hw = Math.min(hw, base + (canyon - base) * k);
      if (s >= seg.from && s <= seg.to) { edgeLeft = 'wall'; edgeRight = 'wall'; }
    } else if (seg.type === 'cliff' && s >= seg.from && s <= seg.to) {
      if (seg.side === 'left') edgeLeft = 'cliff'; else edgeRight = 'cliff';
    }
  }
  return { hw, edgeLeft, edgeRight };
}

export function createTrack(path = TRACK_PATH, segments = SEGMENTS, ramps = RAMPS) {
  const STEP = CONFIG.track.SAMPLE_STEP;
  const ctrl = controlPoints(path);
  const ext = [
    { x: 2 * ctrl[0].x - ctrl[1].x, y: 2 * ctrl[0].y - ctrl[1].y, z: 2 * ctrl[0].z - ctrl[1].z },
    ...ctrl,
    (() => { const a = ctrl[ctrl.length - 1], b = ctrl[ctrl.length - 2];
      return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z }; })(),
  ];

  // Dense polyline along the spline, with cumulative arc length.
  const dense = [], cum = [];
  const tmp = {};
  const SUB = 40;
  for (let i = 0; i < ctrl.length - 1; i++) {
    for (let j = 0; j < SUB; j++) {
      crPoint(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], j / SUB, tmp);
      dense.push({ x: tmp.x, y: tmp.y, z: tmp.z });
    }
  }
  dense.push({ ...ctrl[ctrl.length - 1] });
  cum.push(0);
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const total = cum[cum.length - 1];

  // Uniform resample every STEP meters.
  const n = Math.floor(total / STEP) + 1;
  const pos = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const a = k * STEP;
    while (j < dense.length - 2 && cum[j + 1] < a) j++;
    const f = (a - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    const p = dense[j], q = dense[j + 1];
    pos.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f });
  }

  // Tangent, unwrapped heading, signed curvature.
  const heading = [];
  const samples = [];
  let prevH = 0;
  for (let k = 0; k < n; k++) {
    const a = pos[Math.max(0, k - 1)], b = pos[Math.min(n - 1, k + 1)];
    let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
    const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
    let h = Math.atan2(tx, -tz);
    if (k > 0) { while (h - prevH > Math.PI) h -= 2 * Math.PI; while (h - prevH < -Math.PI) h += 2 * Math.PI; }
    prevH = h; heading.push(h);
    const rl = Math.hypot(tz, tx) || 1;
    samples.push({ s: k * STEP - LEAD_IN, px: pos[k].x, py: pos[k].y, pz: pos[k].z, tx, ty, tz,
      rx: -tz / rl, rz: tx / rl, heading: h, curvature: 0, halfWidth: 0, edgeLeft: 'sand', edgeRight: 'sand' });
  }
  const W = 3;
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - W), b = Math.min(n - 1, k + W);
    const sm = samples[k];
    sm.curvature = (heading[b] - heading[a]) / ((b - a) * STEP);
    const info = sectionInfo(sm.s, segments);
    sm.halfWidth = info.hw; sm.edgeLeft = info.edgeLeft; sm.edgeRight = info.edgeRight;
  }

  const minS = -LEAD_IN;
  const maxS = minS + (n - 1) * STEP;
  const finishS = maxS - RUN_OUT;

  const track = {
    samples, minS, maxS, finishS, step: STEP,
    length: finishS, // race length (start line -> finish line)
    ramps, gaps: ramps.filter((r) => r.gap).map((r) => r.gap),
    /** Interpolated sample at s. Writes into `out` (reuse it to avoid garbage). */
    sample(s, out = {}) {
      const x = (Math.min(maxS, Math.max(minS, s)) - minS) / STEP;
      const i = Math.min(n - 2, Math.floor(x)), f = x - i;
      const A = samples[i], B = samples[i + 1];
      const lerp = (u, v) => u + (v - u) * f;
      out.s = s;
      out.px = lerp(A.px, B.px); out.py = lerp(A.py, B.py); out.pz = lerp(A.pz, B.pz);
      let tx = lerp(A.tx, B.tx), ty = lerp(A.ty, B.ty), tz = lerp(A.tz, B.tz);
      const tl = Math.hypot(tx, ty, tz) || 1;
      out.tx = tx / tl; out.ty = ty / tl; out.tz = tz / tl;
      const rx = lerp(A.rx, B.rx), rz = lerp(A.rz, B.rz), rl = Math.hypot(rx, rz) || 1;
      out.rx = rx / rl; out.rz = rz / rl;
      out.heading = lerp(A.heading, B.heading);
      out.curvature = lerp(A.curvature, B.curvature);
      out.halfWidth = lerp(A.halfWidth, B.halfWidth);
      const near = f < 0.5 ? A : B;
      out.edgeLeft = near.edgeLeft; out.edgeRight = near.edgeRight;
      return out;
    },
    /** Height of the driving surface above the road plane (non-zero only on a ramp slope). */
    groundHeight(s) {
      for (const r of ramps) if (s >= r.s - r.len && s <= r.s) return r.rise * (s - (r.s - r.len)) / r.len;
      return 0;
    },
    groundSlope(s) {
      for (const r of ramps) if (s >= r.s - r.len && s <= r.s) return r.rise / r.len;
      return 0;
    },
    /** The ramp whose launch line was crossed between prevS and s (or null). */
    rampCrossed(prevS, s) {
      for (const r of ramps) if (prevS < r.s && s >= r.s) return r;
      return null;
    },
    /** True where the road is missing (a car on the ground there falls). */
    inGap(s) {
      for (const r of ramps) if (r.gap && s > r.gap.from && s < r.gap.to) return true;
      return false;
    },
    /** World position for track coordinates (s, d lateral, h above road). */
    toWorld(s, d, h = 0, out = {}) {
      const p = track.sample(s, scratch);
      out.x = p.px + p.rx * d; out.y = p.py + h; out.z = p.pz + p.rz * d;
      return out;
    },
  };
  const scratch = {};
  return track;
}
