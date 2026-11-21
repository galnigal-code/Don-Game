// Item-box layout: scattered groups (1-2 boxes) at random lateral positions. Pure logic.
// A new layout is generated for every race (from the race seed), never on ramps, in gaps, at cliff edges or next to obstacles.
import { CONFIG } from '../config.js';
import { FIXED_OBSTACLES } from './trackData.js';

/** True if `s` lies on or next to a ramp / trench (where a box would be unfair or unreachable). */
function inRampZone(track, s, clear) {
  for (const r of track.ramps) {
    const end = r.gap ? r.gap.to : r.s;
    if (s >= r.s - r.len - clear && s <= end + clear) return true;
  }
  return false;
}

export function generateBoxes(track, rng, { obstacles = FIXED_OBSTACLES } = {}) {
  const B = CONFIG.boxes;
  const boxes = [];
  const uniform = (a, b) => a + (b - a) * rng();
  let s = B.FIRST_S - uniform(0, B.GAP_MAX - B.GAP_MIN) * 0.5;
  const lastS = track.finishS - B.LAST_MARGIN;
  let pairAcc = rng();                       // pairs come about every 1/PAIR_CHANCE groups (steady count), at random places
  while (true) {
    s += uniform(B.GAP_MIN, B.GAP_MAX);
    if (s > lastS) break;
    pairAcc += B.PAIR_CHANCE;
    const want = pairAcc >= 1 ? 2 : 1;
    if (want === 2) pairAcc -= 1;
    const placed = [];
    for (let k = 0; k < want; k++) {
      for (let attempt = 0; attempt < B.ATTEMPTS; attempt++) {
        const bs = s + (k === 0 ? 0 : uniform(0, B.PAIR_SPREAD_S)) + attempt * 3;   // a blocked spot slides forward a little, so a group is rarely lost
        if (bs > lastS) continue;
        const sm = track.sample(bs);
        const lim = sm.halfWidth - B.WALL_MARGIN;
        const bd = uniform(-lim, lim);
        if (inRampZone(track, bs, B.RAMP_CLEAR) || track.inGap(bs)) continue;
        if (sm.edgeLeft === 'cliff' && bd < -(sm.halfWidth - B.CLIFF_MARGIN)) continue;
        if (sm.edgeRight === 'cliff' && bd > sm.halfWidth - B.CLIFF_MARGIN) continue;
        if (obstacles.some((o) => Math.hypot(o.s - bs, o.d - bd) < B.OBSTACLE_CLEAR)) continue;
        if (placed.some((p) => Math.abs(p.d - bd) < B.PAIR_MIN_D)) continue;
        placed.push({ s: bs, d: bd });
        break;
      }
    }
    for (const p of placed) boxes.push({ id: boxes.length, s: p.s, d: p.d, t: 0 });
    if (!placed.length) s -= uniform(B.GAP_MIN, B.GAP_MAX) * 0.6;       // the whole group was blocked: try again sooner
  }
  return boxes;
}
