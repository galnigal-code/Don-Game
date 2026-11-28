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

  /** Sample of the MAIN road at s (a loop wraps s; the heading stays continuous over the seam). */
  function sampleMain(s, out) {
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
  }

  /* ---------- branches (V5-B): alleys, elevated tracks, the secret door ----------
   * A branch REPLACES the main road for a stretch [sa, sb] of the lap: a car on it keeps the main-road coordinate `s`
   * (so rank, items, bots and the camera work unchanged), but `s` runs at a different pace along it (`warp` = main metres per
   * real metre: a shortcut has warp > 1). The geometry has its own centre line, width and heights. Cars enter from a window
   * of the main road at sa and leave at sb: onto the road again, or off a lip in a jump. */
  const branches = [];
  if (loop && def.branches) {
    const tmpM = {};
    const mainPt = (sv, d = 0, y = 0) => { const p = sampleMain(sv, tmpM); return { x: p.px + p.rx * d, y: p.py + y, z: p.pz + p.rz * d }; };
    def.branches.forEach((bd, bi) => {
      const raw = bd.path(mainPt);
      // lead-in / lead-out along the main road's own direction: the branch leaves and rejoins with the road's heading (no visual kink)
      const ta = sampleMain(bd.sa, {}), tb = sampleMain(bd.sb, {}), LEAD = 14;
      const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < LEAD + 8;
      const mid = raw.slice(1, -1).filter((p) => !near(p, raw[0]) && !near(p, raw[raw.length - 1]));      // points too close to an end would fold the lead-in back
      const pts = bd.exact ? raw : [raw[0], { x: raw[0].x + ta.tx * LEAD, y: raw[0].y, z: raw[0].z + ta.tz * LEAD }, ...mid,
        { x: raw[raw.length - 1].x - tb.tx * LEAD, y: raw[raw.length - 1].y, z: raw[raw.length - 1].z - tb.tz * LEAD }, raw[raw.length - 1]];
      const e = [{ x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y, z: 2 * pts[0].z - pts[1].z }, ...pts,
        { x: 2 * pts[pts.length - 1].x - pts[pts.length - 2].x, y: 2 * pts[pts.length - 1].y - pts[pts.length - 2].y, z: 2 * pts[pts.length - 1].z - pts[pts.length - 2].z }];
      const dn = [], cm = [0]; const tp = {};
      for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < 30; j++) { crPoint(e[i], e[i + 1], e[i + 2], e[i + 3], j / 30, tp); dn.push({ x: tp.x, y: tp.y, z: tp.z }); }
      dn.push({ ...pts[pts.length - 1] });
      for (let i = 1; i < dn.length; i++) cm.push(cm[i - 1] + Math.hypot(dn[i].x - dn[i - 1].x, dn[i].y - dn[i - 1].y, dn[i].z - dn[i - 1].z));
      const total = cm[cm.length - 1], nb = Math.floor(total) + 1, ps = []; let jj = 0;
      for (let k = 0; k < nb; k++) {
        const a = Math.min(k, total);
        while (jj < dn.length - 2 && cm[jj + 1] < a) jj++;
        const f = (a - cm[jj]) / Math.max(1e-9, cm[jj + 1] - cm[jj]);
        ps.push({ x: dn[jj].x + (dn[jj + 1].x - dn[jj].x) * f, y: dn[jj].y + (dn[jj + 1].y - dn[jj].y) * f, z: dn[jj].z + (dn[jj + 1].z - dn[jj].z) * f });
      }
      const sa0 = sampleMain(bd.sa, {}), hdg = [], bs = []; let ph = sa0.heading;
      for (let k = 0; k < nb; k++) {
        const a = ps[Math.max(0, k - 1)], b2 = ps[Math.min(nb - 1, k + 1)];
        let tx = b2.x - a.x, ty = b2.y - a.y, tz = b2.z - a.z; const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
        let h = Math.atan2(tx, -tz); while (h - ph > Math.PI) h -= 2 * Math.PI; while (h - ph < -Math.PI) h += 2 * Math.PI; ph = h; hdg.push(h);
        const rl = Math.hypot(tz, tx) || 1;
        bs.push({ px: ps[k].x, py: ps[k].y, pz: ps[k].z, tx, ty, tz, rx: -tz / rl, rz: tx / rl, heading: h, curvature: 0, halfWidth: bd.hw, edgeLeft: 'wall', edgeRight: 'wall', sandLimL: bd.hw + 1, sandLimR: bd.hw + 1 });
      }
      for (let k = 0; k < nb; k++) { const a = Math.max(0, k - 3), b2 = Math.min(nb - 1, k + 3); bs[k].curvature = (hdg[b2] - hdg[a]) / Math.max(1, b2 - a); }
      const latOf = (pt, sv) => { const p = sampleMain(sv, {}); return (pt.x - p.px) * p.rx + (pt.z - p.pz) * p.rz; };
      const first = pts[0], last = pts[pts.length - 1], mb = sampleMain(bd.sb, {});
      branches.push({
        index: bi + 1, id: bd.id, kind: bd.kind, sa: bd.sa, sb: bd.sb, hw: bd.hw, end: bd.end, entry: bd.entry, boxes: bd.boxes || [], pads: bd.pads || [], building: bd.building || null,
        length: total, warp: (bd.sb - bd.sa) / total, n: nb, samples: bs, step: total / (nb - 1),
        entryCenter: latOf(first, bd.sa), exitD: latOf(last, bd.sb), exitH: bd.end === 'jump' ? last.y - mb.py : 0, jumpVy: bd.jumpVy ?? 3,
      });
    });
  }
  const sampleBranch = (br, s, out) => {
    const lap = Math.floor(s / lapLength), sl = s - lap * lapLength;
    const u = Math.min(1, Math.max(0, (sl - br.sa) / (br.sb - br.sa)));
    const x = u * (br.n - 1), i = Math.min(br.n - 2, Math.floor(x)), f = x - i;
    const A = br.samples[i], B = br.samples[i + 1], lerp = (p, q) => p + (q - p) * f;
    out.s = s;
    out.px = lerp(A.px, B.px); out.py = lerp(A.py, B.py); out.pz = lerp(A.pz, B.pz);
    let tx = lerp(A.tx, B.tx), ty = lerp(A.ty, B.ty), tz = lerp(A.tz, B.tz); const tl = Math.hypot(tx, ty, tz) || 1;
    out.tx = tx / tl; out.ty = ty / tl; out.tz = tz / tl;
    const rx = lerp(A.rx, B.rx), rz = lerp(A.rz, B.rz), rl = Math.hypot(rx, rz) || 1; out.rx = rx / rl; out.rz = rz / rl;
    out.heading = lerp(A.heading, B.heading) + lap * loopTurn;
    out.curvature = lerp(A.curvature, B.curvature) / br.step;
    out.halfWidth = br.hw; out.edgeLeft = 'wall'; out.edgeRight = 'wall'; out.sandLimL = br.hw + 1; out.sandLimR = br.hw + 1;
    return out;
  };

  const track = {
    id: def.id, name: def.name, style: def.style, loop, laps, lapLength, runoff: SE, obstacles: def.obstacles || [],
    samples, minS, maxS, finishS, step: STEP, headingTurn: loopTurn, branches,
    length: finishS, // race length (start line -> finish line)
    ramps, allRamps, gaps: ramps.filter((r) => r.gap).map((r) => r.gap),
    /** 1-based lap of position s (1 for a non-loop track). */
    lapAt(s) { return loop ? Math.min(laps, Math.max(0, Math.floor(s / lapLength)) + 1) : 1; },
    /** Interpolated sample at s on a route (0 = the main road, 1.. = a branch). Writes into `out` (reuse it to avoid garbage). */
    sample(s, out = {}, route = 0) { return route ? sampleBranch(branches[route - 1], s, out) : sampleMain(s, out); },
    /** Main-road metres per real metre on this route (a shortcut is > 1). */
    warp(route) { return route ? branches[route - 1].warp : 1; },
    /**
     * Route changes of a car that just moved from prevS to car.s: onto a branch when it crosses the branch's start line inside the
     * entry window, back onto the main road (or off the lip, in a jump) at the end. Returns true when the route changed.
     */
    updateRoute(car, prevS) {
      if (!branches.length) return false;
      if (car.route === 0) {
        if (car.h > 0.6 || car.state !== 'driving') return false;
        const k0 = Math.floor(prevS / lapLength), k1 = Math.floor(car.s / lapLength);
        for (let k = k0; k <= k1; k++) for (const br of branches) {
          const a = br.sa + k * lapLength;
          if (prevS < a && car.s >= a && car.d >= br.entry[0] && car.d <= br.entry[1]) {
            car.route = br.index; car.routeLap = k; car.d -= br.entryCenter; return true;
          }
        }
        return false;
      }
      const br = branches[car.route - 1];
      if (car.s >= br.sb + car.routeLap * lapLength) {
        car.route = 0; car.d += br.exitD;
        if (br.end === 'jump') { car.h += br.exitH; car.vy = Math.max(car.vy, br.jumpVy); car.yaw *= 0.25; }   // the lip guides the car straight: it cannot steer in the air
        return true;
      }
      return false;
    },
    /** Height of the driving surface above the road plane (non-zero only on a ramp slope). */
    groundHeight(s, route = 0) {
      if (route) return 0;                                       // a branch deck is its own ground (cars' h is relative to it)
      for (const r of allRamps) if (s >= r.s - r.len && s <= r.s) return r.rise * (s - (r.s - r.len)) / r.len;
      return 0;
    },
    groundSlope(s, route = 0) {
      if (route) return 0;
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
    toWorld(s, d, h = 0, out = {}, route = 0) {
      const p = track.sample(s, scratch, route);
      out.x = p.px + p.rx * d; out.y = p.py + h; out.z = p.pz + p.rz * d;
      return out;
    },
  };
  const scratch = {};
  return track;
}
