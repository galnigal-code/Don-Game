// The city at sunset: a closed loop, 2 laps, about 2 km (60 s) per lap. Flowing: no corner needs braking.
// The main road: straights joined by wide corners (radius 52-95 m) and one gentle S-bend, drawn as a "turtle" path and closed exactly
// (the two free straights were solved so that the end meets the start). About 1970 m per lap = 62 s at the cruise speed.
// At 32 m/s even the tightest corner pushes the car sideways at ~10 m/s while the steering can hold ~16: nothing needs braking.
// segment = ['S', length] | ['C', radius, turnDegrees]  (positive = to the right, the loop is clockwise on the map)
const SEGMENTS = [
  ['S', 300], ['C', 95, 90], ['S', 190], ['C', 62, 90], ['S', 225], ['C', 260, 22], ['C', 260, -22], ['S', 165],
  ['C', 70, 90], ['S', 177.1], ['C', 62, 90], ['S', 259.8],
];
function turtle(segs, step = 14) {
  let x = 0, z = 0, th = 0; const pts = [{ x, z }];
  for (const [k, a, b] of segs) {
    if (k === 'S') { const n = Math.max(1, Math.round(a / step)); for (let i = 1; i <= n; i++) { x += Math.cos(th) * a / n; z += Math.sin(th) * a / n; pts.push({ x, z }); } }
    else { const turn = (b * Math.PI) / 180, n = Math.max(2, Math.round((Math.abs(turn) * a) / step)), dth = turn / n;
      for (let i = 1; i <= n; i++) { const mid = th + dth / 2, ds = Math.abs(a * dth); x += Math.cos(mid) * ds; z += Math.sin(mid) * ds; th += dth; pts.push({ x, z }); } }
  }
  return pts.slice(0, -1);               // the last point is the first one again
}
export const CITY_POINTS = turtle(SEGMENTS);

/**
 * Branches. Each REPLACES the main road for a stretch [sa, sb] of the lap (see TrackModel). `path(m)` returns the centre line;
 * m(s, d, y) = the main road at lap position s, d metres to its right (the right is the INSIDE of this clockwise loop), y metres up.
 * entry = the part of the main road (lateral d at s = sa) that leads onto it.
 */
/**
 * A corner-cut alley as an exact path: an arc to the right, a straight, an arc to the right (a Dubins "RSR" path), tangent to the road
 * at both ends, so it leaves and rejoins with the road's own heading and every bend has radius R (no braking needed at 32 m/s).
 */
function cornerCut(m, sa, sb, dIn, R) {
  const TAU = 2 * Math.PI, mod = (a) => ((a % TAU) + TAU) % TAU;
  const pose = (sv) => { const p = m(sv, dIn), q = m(sv + 1, dIn), o = m(sv - 1, dIn); return { x: p.x, z: p.z, th: Math.atan2(q.z - o.z, q.x - o.x) }; };
  const A = pose(sa), B = pose(sb), right = (t) => [-Math.sin(t), Math.cos(t)];
  const c1 = [A.x + R * right(A.th)[0], A.z + R * right(A.th)[1]], c2 = [B.x + R * right(B.th)[0], B.z + R * right(B.th)[1]];
  const phi = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]), len = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  const d1 = mod(phi - A.th), d2 = mod(B.th - phi), pts = [];
  const arc = (c, t0, dt) => { const n = Math.max(2, Math.ceil((R * dt) / 7)); for (let i = 0; i <= n; i++) { const t = t0 + (dt * i) / n, r = right(t); pts.push({ x: c[0] - R * r[0], y: 0, z: c[1] - R * r[1] }); } };
  arc(c1, A.th, d1);
  const nS = Math.max(1, Math.ceil(len / 8)); for (let i = 1; i < nS; i++) { const t = phi, r = right(t), f = i / nS; pts.push({ x: c1[0] + (c2[0] - c1[0]) * f - R * r[0], y: 0, z: c1[1] + (c2[1] - c1[1]) * f - R * r[1] }); }
  arc(c2, phi, d2);
  pts[0] = m(sa, dIn, 0); pts[pts.length - 1] = m(sb, dIn, 0);
  return pts;
}
const alley = (id, sa, sb, dIn, R) => ({
  id, kind: 'alley', hw: 5.5, sa, sb, end: 'merge', entry: [dIn - 2.4, dIn + 2.4], exact: true,
  pads: [{ u: 0.24, d: 0 }],                  // just after the first bend: the long straight that follows lets the boost wear off before the second bend
  path: (m) => cornerCut(m, sa, sb, dIn, R),
});

/**
 * A smooth lane beside the road for elevated tracks: lateral offset d(s) and height y(s) built from smooth steps, so there is never a
 * kink (bends R > 60 m, slopes <= 12 %). legs: [{ from, to, d }] = move to lateral d between those s; rise: [{ from, to, y }] likewise.
 */
function lane(m, sa, sb, d0, legs, rises, step = 10) {
  const sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const ease = (t, k) => { t = Math.max(0, Math.min(1, t)); return k * sm(t) + (1 - k) * t; };        // k = how "smooth" (1) or how straight (0) the step is
  const profile = (v0, list, key, k) => (sv) => { let v = v0, prev = v0; for (const l of list) { v = prev + (l[key] - prev) * ease((sv - l.from) / (l.to - l.from), k); if (sv >= l.to) prev = l[key]; else break; } return v; };
  const dOf = profile(d0, legs, 'd', 1), yOf = profile(0, rises, 'y', 0.6), pts = [];       // heights use a straighter step: a constant slope, not a steep middle
  for (let sv = sa; sv < sb; sv += step) pts.push(m(sv, dOf(sv), yOf(sv)));
  pts.push(m(sb, dOf(sb), yOf(sb)));
  return pts;
}

export const BRANCHES = [
  alley('alleyA', 530, 850, 6.2, 62),         // cuts the corner after the right-hand side
  alley('alleyB', 1510, 1830, 6.2, 62),        // cuts the top-left corner
  { // long elevated track on the inside of the loop: leaves the road to the right, climbs OFF the road, comes back down
    id: 'sky', kind: 'elevated', hw: 5.5, sa: 110, sb: 400, end: 'merge', entry: [3, 9], exact: true,
    boxes: [{ u: 0.42, d: -2.5 }, { u: 0.42, d: 2.5 }, { u: 0.5, d: 0 }, { u: 0.58, d: -2.5 }, { u: 0.58, d: 2.5 }],
    pads: [{ u: 0.1, d: 0 }],       // early: the boost has worn off before the bend that follows (R~50 holds 45 m/s)
    path: (m) => lane(m, 110, 400, 6, [{ from: 124, to: 214, d: 18 }, { from: 296, to: 386, d: 6 }], [{ from: 166, to: 270, y: 8 }, { from: 292, to: 386, y: 0 }]),
  },
  { // short floating track on the outside, ends in an open lip: the car jumps back onto the road
    id: 'neo', kind: 'neo', hw: 5.5, sa: 900, sb: 1140, end: 'jump', entry: [-9, -3], jumpVy: 3, exact: true,
    boxes: [{ u: 0.5, d: -2.5 }, { u: 0.5, d: 2.5 }, { u: 0.58, d: 0 }],
    pads: [{ u: 0.5, d: 0 }],
    path: (m) => lane(m, 900, 1140, -6, [{ from: 914, to: 1000, d: -25 }, { from: 1030, to: 1126, d: -3 }], [{ from: 950, to: 1050, y: 7 }]),
  },
  { // the secret door: a garage door in a building on the outside, a dark climbing tunnel, a floating track out of the top floor
    id: 'secret', kind: 'secret', hw: 4.5, sa: 1730, sb: 1960, end: 'jump', entry: [-10.6, -6.4], jumpVy: 3.5, exact: true,
    boxes: [{ u: 0.85, d: -2.2 }, { u: 0.85, d: 2.2 }],
    pads: [{ u: 0.9, d: 0 }],
    building: { s0: 1770, s1: 1895, dIn: -19, dOut: -46, height: 24, door: [1778, 1789], doorH: 5.2, exit: [-29, -19, 10.5, 16.5] },
    path: (m) => lane(m, 1730, 1960, -9, [{ from: 1744, to: 1834, d: -34 }, { from: 1855, to: 1955, d: -3 }], [{ from: 1788, to: 1895, y: 11.5 }]),
  },
];

export const city = {
  id: 'city', name: 'עיר בשקיעה', style: 'city', loop: true, laps: 2,
  points: CITY_POINTS, segments: [], ramps: [], branches: BRANCHES,
  // boost pads on the main road (s along the lap, d lateral): three of them; every elevated track and every alley has one more
  mainPads: [{ s: 62, d: -4 }, { s: 455, d: -4 }, { s: 1020, d: 4 }],        // each is followed by 140+ m before a tight bend: a boosted car (57 m/s) needs that to slow down to what the steering holds (45 m/s)
  obstacles: [], heightAt: () => 0,
  leadIn: 40, runOut: 120,
  runoff: 1.6,           // the kerb strip: the car is held on the road side of it (no slowdown, see CONFIG.car.SAND_MULT)
};
