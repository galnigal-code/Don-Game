// Pure terrain height function (no three.js, unit-tested). The terrain only has to look good far from the
// road: everything within ~100 m is covered by the road "ribbons" built in TrackMesh.
import { CONFIG } from '../config.js';

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** Smooth value noise in [0,1]. */
export function createNoise(seed = 1) {
  const h = (ix, iz) => {
    let n = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
  };
}

export function createTerrain(track, seed = 7) {
  const noise = createNoise(seed);
  const pts = [];
  for (let i = 0; i < track.samples.length; i += 6) pts.push(track.samples[i]);

  function nearest(x, z) {
    let best = null, bd = Infinity;
    for (const p of pts) {
      const d2 = (p.px - x) ** 2 + (p.pz - z) ** 2;
      if (d2 < bd) { bd = d2; best = p; }
    }
    return { p: best, d: Math.sqrt(bd) };
  }

  /** {y, py, d}: terrain height at world x,z, the nearest road height and the distance to the road. */
  function sample(x, z) {
    const { p, d } = nearest(x, z);
    const side = (x - p.px) * p.rx + (z - p.pz) * p.rz >= 0 ? 1 : -1;
    const edge = side > 0 ? p.edgeRight : p.edgeLeft;
    const base = p.py - 2.0;
    const dunes = (noise(x / 110, z / 110) - 0.5) * 2 * 14 * smooth(110, 260, d)
                + (noise(x / 45 + 17, z / 45 + 3) - 0.5) * 2 * 1.4 * smooth(105, 200, d);
    const mesa = 38 * smooth(0.58, 0.7, noise(x / 420 + 5, z / 420 + 9)) * smooth(300, 480, d);   // flat-topped mesas on the horizon
    let y;
    if (edge === 'cliff') y = lerp(p.py - 32, base + dunes, smooth(100, 260, d));
    else if (edge === 'wall') y = lerp(p.py + 6, base + dunes, smooth(60, 170, d));
    else y = base + dunes;
    return { y: y + mesa, py: p.py, d, edge, mesa };
  }

  /** Height of the road ribbon beside a sand shoulder at lateral distance `lat` from the centre line. */
  function ribbonY(py, lat, hw) {
    const o = hw + CONFIG.track.SAND_EXTRA;
    return py - 0.25 - 1.75 * clamp01((lat - o) / 100);
  }

  return { sample, heightAt: (x, z) => sample(x, z).y, ribbonY, noise };
}
