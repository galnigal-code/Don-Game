import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createTerrain, createNoise, smooth } from '../../src/render/terrainMath.js';
import { SEGMENTS } from '../../src/sim/trackData.js';

const track = createTrack();
const terrain = createTerrain(track);
const SE = CONFIG.track.SAND_EXTRA;
const at = (s, lat) => { const p = track.sample(s); return terrain.sample(p.px + p.rx * lat, p.pz + p.rz * lat); };

describe('noise', () => {
  it('is deterministic, smooth and within [0,1]', () => {
    const n = createNoise(5), m = createNoise(5);
    for (let i = 0; i < 200; i++) { const v = n(i * 0.37, i * 0.91); expect(v).toBe(m(i * 0.37, i * 0.91)); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(Math.abs(n(10.001, 3) - n(10, 3))).toBeLessThan(0.01);
    expect(createNoise(1)(3.3, 4.4)).not.toBe(createNoise(2)(3.3, 4.4));
  });
  it('smooth() is a clamped smoothstep', () => { expect(smooth(0, 1, -1)).toBe(0); expect(smooth(0, 1, 2)).toBe(1); expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 6); });
});

describe('terrain height', () => {
  it('is deterministic', () => { expect(terrain.heightAt(100, -200)).toBe(createTerrain(track).heightAt(100, -200)); });
  it('stays below the road ribbons near the road (so it can never poke through)', () => {
    for (let s = 100; s < 2800; s += 150) for (const lat of [-110, 110]) {
      const t = at(s, lat);
      if (t.edge !== 'sand' || t.d > 150) continue;     // compare with the road that is actually nearest
      expect(t.y, `s=${s} lat=${lat}`).toBeLessThan(t.py - 1.4);
    }
  });
  it('is far below the road next to cliffs, so the drop is visible', () => {
    const cliff = SEGMENTS.find((x) => x.type === 'cliff' && x.side === 'left');
    const s = (cliff.from + cliff.to) / 2;
    expect(at(s, -110).y).toBeLessThan(track.sample(s).py - 25);
  });
  it('forms a plateau beside the canyon walls', () => {
    const c = SEGMENTS.find((x) => x.type === 'canyon');
    const s = (c.from + c.to) / 2;
    expect(at(s, 40).y).toBeGreaterThan(track.sample(s).py + 3);
  });
  it('keeps dunes and mesas in a sane range', () => {
    let lo = Infinity, hi = -Infinity;
    for (let x = -1500; x <= 1500; x += 97) for (let z = -3500; z <= 500; z += 97) { const y = terrain.heightAt(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    expect(lo).toBeGreaterThan(-60);
    expect(hi).toBeLessThan(90);
  });
  it('ribbon height slopes smoothly from the shoulder down to the terrain', () => {
    const p = track.sample(300), o = p.halfWidth + SE;
    expect(terrain.ribbonY(p.py, o, p.halfWidth)).toBeCloseTo(p.py - 0.25, 6);
    expect(terrain.ribbonY(p.py, o + 100, p.halfWidth)).toBeCloseTo(p.py - 2.0, 6);
    expect(terrain.ribbonY(p.py, o + 300, p.halfWidth)).toBeCloseTo(p.py - 2.0, 6);
  });
});
