import { describe, it, expect } from 'vitest';
import { profileGeometry } from '../../src/render/CarModel.js';

// A profile drawn with the nose at +x. The car faces -z in the game, so the nose must end up at NEGATIVE z.
const BODY = [[-2.15, 0.3], [-2.15, 0.82], [-1.5, 0.9], [-0.2, 0.84], [1.2, 0.74], [1.95, 0.5], [2.2, 0.38], [2.15, 0.3]];
const CABIN = [[-1.15, 0.82], [-0.75, 1.3], [0.35, 1.32], [1.0, 0.84]];

function vertices(geo) {
  const p = geo.attributes.position, out = [];
  for (let i = 0; i < p.count; i++) out.push({ x: p.getX(i), y: p.getY(i), z: p.getZ(i) });
  return out;
}
const avgZ = (vs, pred) => { const a = vs.filter(pred); return a.reduce((s, v) => s + v.z, 0) / a.length; };

describe('car model orientation (nose faces -z)', () => {
  it('the long low nose is at the front (-z) and the raised tail deck at the back (+z)', () => {
    const v = vertices(profileGeometry(BODY, 1.9));
    const noseZ = avgZ(v, (p) => p.y < 0.45 && Math.abs(p.z) > 1.5);            // low points at the ends: the nose side
    expect(Math.min(...v.map((p) => p.z))).toBeLessThan(-2.1);
    expect(avgZ(v, (p) => p.y > 0.8)).toBeGreaterThan(0.2);                       // the highest deck sits towards the tail
    expect(noseZ).toBeLessThan(0);
  });
  it('the windscreen (long slope) faces forward and the steep rear window faces back', () => {
    const v = vertices(profileGeometry(CABIN, 1.46, 0.05));
    const roofZ = avgZ(v, (p) => p.y > 1.25);
    expect(roofZ).toBeGreaterThan(0.1);          // the roof is shifted to the rear: front slope is longer
  });
  it('is centred across the width (x) and spans about the right width', () => {
    const v = vertices(profileGeometry(BODY, 1.9));
    const xs = v.map((p) => p.x);
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.9, 1);
  });
});
