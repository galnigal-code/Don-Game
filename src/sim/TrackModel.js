// Pure track model (no three.js). Builds a smooth centerline from trackData and
// exposes sampling in "track space": s (along), d (lateral, + = right), h (height).
import { CONFIG } from '../config.js';
import { TRACKS } from './tracks/index.js';
import { desert } from './tracks/desert.js';

const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

function controlPoints(path, leadIn, heightAt, step = 50) {
  const pts = [{ x: 0, y: 0, z: 0 }];
  let theta = 0, s = -leadIn, x = 0, z = 0;
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

function sectionInfo(s, segments, baseHW) {
  const base = baseHW, canyon = CONFIG.track.CANYON_HALF_WIDTH;
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

/**
 * createTrack(def): `def` is a track definition (see tracks/), a track id ('city' | 'desert') or, for old callers,
 * (path, segments, ramps) of the desert. A LOOP track (the city) is one closed lap; the simulation sees it unrolled: s grows
 * over all laps, and every geometry query wraps s back into one lap. The heading stays continuous across laps (no jump at the seam).
 */
export function createTrack(arg, segmentsArg, rampsArg) {
  let def;
  if (Array.isArray(arg)) def = { ...desert, path: arg, segments: segmentsArg ?? desert.segments, ramps: rampsArg ?? desert.ramps };
  else if (typeof arg === 'string') def = TRACKS[arg];
  else def = arg || desert;
  if (!def) throw new Error('unknown track ' + arg);

  const loop = !!def.loop;
  const LEAD_IN = def.leadIn, RUN_OUT = def.runOut, heightAt = def.heightAt, segments = def.segments, ramps = def.ramps;
  const SE = def.runoff ?? CONFIG.track.SAND_EXTRA, BASE_HW = def.halfWidth ?? CONFIG.track.HALF_WIDTH;

  let ctrl, ext;
  if (loop) {
    ctrl = def.points.map((p) => ({ x: p.x, y: heightAt(0), z: p.z }));
    const m = ctrl.length;
    ext = [ctrl[m - 1], ...ctrl, ctrl[0], ctrl[1]];                 // wrap around: p[-1], p[0..m-1], p[m], p[m+1]
  } else {
    ctrl = controlPoints(def.path, LEAD_IN, heightAt);
    ext = [
      { x: 2 * ctrl[0].x - ctrl[1].x, y: 2 * ctrl[0].y - ctrl[1].y, z: 2 * ctrl[0].z - ctrl[1].z },
      ...ctrl,
      (() => { const a = ctrl[ctrl.length - 1], b = ctrl[ctrl.length - 2];
        return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z }; })(),
    ];
  }

  // Dense polyline along the spline, with cumulative arc length.
  const dense = [], cum = [];
  const tmp = {};
  const SUB = 40;
  const segCount = loop ? ctrl.length : ctrl.length - 1;
  for (let i = 0; i < segCount; i++) {
    for (let j = 0; j < SUB; j++) {
      crPoint(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], j / SUB, tmp);
      dense.push({ x: tmp.x, y: tmp.y, z: tmp.z });
    }
  }
  dense.push(loop ? { ...dense[0] } : { ...ctrl[ctrl.length - 1] });
  cum.push(0);
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const total = cum[cum.length - 1];

  // Uniform resample every STEP meters (a loop: the step is adjusted so that a whole number of steps closes the loop exactly).
  const nSteps = loop ? Math.max(8, Math.round(total / CONFIG.track.SAMPLE_STEP)) : Math.floor(total / CONFIG.track.SAMPLE_STEP);
  const STEP = loop ? total / nSteps : CONFIG.track.SAMPLE_STEP;
  const n = nSteps + 1;                                              // samples 0..nSteps (a loop: the last one equals the first)
  const pos = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const a = k * STEP;
    while (j < dense.length - 2 && cum[j + 1] < a) j++;
    const f = (a - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    const p = dense[j], q = dense[j + 1];
    pos.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f });
  }
  if (loop) pos[n - 1] = { ...pos[0] };

  // Tangent, unwrapped heading, signed curvature.
  const heading = [];
  const samples = [];
  const s0 = loop ? 0 : -LEAD_IN;
  let prevH = 0;
  for (let k = 0; k < n; k++) {
    const a = loop ? pos[(k - 1 + nSteps) % nSteps] : pos[Math.max(0, k - 1)];
    const b = loop ? pos[(k + 1) % nSteps] : pos[Math.min(n - 1, k + 1)];
    let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
    const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
    let h = Math.atan2(tx, -tz);
    if (k > 0) { while (h - prevH > Math.PI) h -= 2 * Math.PI; while (h - prevH < -Math.PI) h += 2 * Math.PI; }
    prevH = h; heading.push(h);
    const rl = Math.hypot(tz, tx) || 1;
    samples.push({ s: s0 + k * STEP, px: pos[k].x, py: pos[k].y, pz: pos[k].z, tx, ty, tz,
      rx: -tz / rl, rz: tx / rl, heading: h, curvature: 0, halfWidth: 0, edgeLeft: 'sand', edgeRight: 'sand' });
  }
  // a loop turns by a whole number of full turns per lap; the heading continues over the seam
  const loopTurn = loop ? Math.round((heading[n - 1] - heading[0]) / (2 * Math.PI)) * 2 * Math.PI : 0;
  if (loop) { heading[n - 1] = heading[0] + loopTurn; samples[n - 1].heading = heading[n - 1]; }
  const hAt = (i) => (loop ? heading[((i % nSteps) + nSteps) % nSteps] + Math.floor(i / nSteps) * loopTurn : heading[Math.max(0, Math.min(n - 1, i))]);
  const W = 3;
  for (let k = 0; k < n; k++) {
    const a = loop ? k - W : Math.max(0, k - W), b = loop ? k + W : Math.min(n - 1, k + W);
    const sm = samples[k];
    sm.curvature = (hAt(b) - hAt(a)) / ((b - a) * STEP);
    const info = sectionInfo(sm.s, segments, BASE_HW);
    sm.halfWidth = info.hw; sm.edgeLeft = info.edgeLeft; sm.edgeRight = info.edgeRight;
  }

  // V4: the sand shoulder narrows smoothly (a funnel, 30 m long) into the next wall / guard rail on that side, so a car on the
  // shoulder is guided back to the road instead of being teleported when the barrier starts.
  const FUNNEL = 30, HALF = CONFIG.car.HALF_WIDTH;
  for (const [edgeKey, limKey] of [['edgeLeft', 'sandLimL'], ['edgeRight', 'sandLimR']]) {
    let next = null;                                    // index of the closest barrier sample at or ahead of k
    for (let k = n - 1; k >= 0; k--) {
      const sm = samples[k];
      if (sm[edgeKey] !== 'sand') next = k;
      let lim = sm.halfWidth + SE;
      if (next != null && sm[edgeKey] === 'sand') {
        const dist = (next - k) * STEP;
        if (dist < FUNNEL) { const inner = samples[next].halfWidth - HALF; lim = inner + (lim - inner) * (dist / FUNNEL); }
      }
      sm[limKey] = lim;
    }
  }

  const lapLength = loop ? nSteps * STEP : 0;
  const laps = loop ? def.laps : 1;
  const minS = -LEAD_IN;
  const maxS = loop ? laps * lapLength + RUN_OUT : minS + (n - 1) * STEP;
  const finishS = loop ? laps * lapLength : maxS - RUN_OUT;
  // ramps unrolled over every lap (the base list stays in `ramps` for drawing)
  const allRamps = loop
    ? Array.from({ length: laps + 2 }, (_, i) => i - 1).flatMap((lap) => ramps.map((r) => ({ ...r, s: r.s + lap * lapLength, gap: r.gap ? { from: r.gap.from + lap * lapLength, to: r.gap.to + lap * lapLength } : null })))
    : ramps;

  const track = {
    id: def.id, name: def.name, style: def.style, loop, laps, lapLength, runoff: SE, obstacles: def.obstacles || [],
    samples, minS, maxS, finishS, step: STEP, headingTurn: loopTurn,
    length: finishS, // race length (start line -> finish line)
    ramps, allRamps, gaps: ramps.filter((r) => r.gap).map((r) => r.gap),
    /** 1-based lap of position s (1 for a non-loop track). */
    lapAt(s) { return loop ? Math.min(laps, Math.max(0, Math.floor(s / lapLength)) + 1) : 1; },
    /** Interpolated sample at s. Writes into `out` (reuse it to avoid garbage). A loop wraps s; the heading stays continuous. */
    sample(s, out = {}) {
      const sc = Math.min(maxS, Math.max(minS, s));
      let x, lap = 0;
      if (loop) { lap = Math.floor(sc / lapLength); x = (sc - lap * lapLength) / STEP; }
      else x = (sc - minS) / STEP;
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
      out.heading = lerp(A.heading, B.heading) + lap * loopTurn;
      out.curvature = lerp(A.curvature, B.curvature);
      out.halfWidth = lerp(A.halfWidth, B.halfWidth);
      const near = f < 0.5 ? A : B;
      out.edgeLeft = near.edgeLeft; out.edgeRight = near.edgeRight;
      out.sandLimL = lerp(A.sandLimL, B.sandLimL); out.sandLimR = lerp(A.sandLimR, B.sandLimR);
      return out;
    },
    /** Height of the driving surface above the road plane (non-zero only on a ramp slope). */
    groundHeight(s) {
      for (const r of allRamps) if (s >= r.s - r.len && s <= r.s) return r.rise * (s - (r.s - r.len)) / r.len;
      return 0;
    },
    groundSlope(s) {
      for (const r of allRamps) if (s >= r.s - r.len && s <= r.s) return r.rise / r.len;
      return 0;
    },
    /** The ramp whose launch line was crossed between prevS and s (or null). */
    rampCrossed(prevS, s) {
      for (const r of allRamps) if (prevS < r.s && s >= r.s) return r;
      return null;
    },
    /** True where the road is missing (a car on the ground there falls). */
    inGap(s) {
      for (const r of allRamps) if (r.gap && s > r.gap.from && s < r.gap.to) return true;
      return false;
    },
    /** Nearest spot at or after `s` that is safe to put a car on: not on a ramp and not above a trench. */
    safeSpawnS(s) {
      for (let guard = 0; guard < 6; guard++) {
        let moved = false;
        for (const r of allRamps) {
          const end = (r.gap ? r.gap.to : r.s) + 10;
          if (s >= r.s - r.len - 3 && s <= end) { s = end; moved = true; }
        }
        if (!moved) break;
      }
      return s;
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
