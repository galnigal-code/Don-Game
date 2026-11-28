import { describe, it, expect } from 'vitest';
import { fitTrack } from '../../src/ui/minimap.js';
import { createTrack } from '../../src/sim/TrackModel.js';

describe('track map', () => {
  it('fits the whole track inside the square with padding, keeping the proportions', () => {
    const t = createTrack();
    const pts = t.samples.map((p) => ({ x: p.px, z: p.pz }));
    const m = fitTrack(pts, 200, 20);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of pts) { const [x, y] = m(p.x, p.z); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    expect(minX).toBeGreaterThanOrEqual(19.99); expect(minY).toBeGreaterThanOrEqual(19.99);
    expect(maxX).toBeLessThanOrEqual(180.01); expect(maxY).toBeLessThanOrEqual(180.01);
    expect(Math.max(maxX - minX, maxY - minY)).toBeCloseTo(160, 3);        // the long side fills the box
    const [ax, ay] = m(0, 0), [bx, by] = m(100, 0), [cx, cy] = m(0, 100);
    expect(Math.hypot(bx - ax, by - ay)).toBeCloseTo(Math.hypot(cx - ax, cy - ay), 6);   // same scale on both axes
  });
});
