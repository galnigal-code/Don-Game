import { describe, it, expect } from 'vitest';
import { engineFreq, engineGain, distanceGain, musicStep, BPM, STEP_SECONDS } from '../../src/audio/soundMath.js';

describe('engine', () => {
  it('pitch and loudness rise with speed; turbo raises the pitch', () => {
    expect(engineFreq(0)).toBeGreaterThan(40);
    expect(engineFreq(32)).toBeGreaterThan(engineFreq(10));
    expect(engineFreq(32, true)).toBeGreaterThan(engineFreq(32) * 1.15);
    expect(engineGain(0)).toBeGreaterThan(0);
    expect(engineGain(32)).toBeGreaterThan(engineGain(5));
    expect(engineGain(500)).toBe(1);
    expect(engineFreq(-5)).toBe(engineFreq(0));
  });
});

describe('distance gain', () => {
  it('is 1 up close, 0 far away and falls off monotonically', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(200)).toBe(0);
    let prev = 1;
    for (let d = 12; d <= 90; d += 6) { const g = distanceGain(d); expect(g).toBeLessThanOrEqual(prev); prev = g; }
  });
});

describe('music', () => {
  it('loops every 64 steps and has a steady kick and a bass line', () => {
    expect(musicStep(0)).toEqual(musicStep(64));
    expect(musicStep(5)).toEqual(musicStep(69));
    let kicks = 0, bass = 0, arp = 0, hats = 0;
    for (let i = 0; i < 64; i++) { const n = musicStep(i); if (n.kick) kicks++; if (n.bass) bass++; if (n.arp) arp++; if (n.hat) hats++; }
    expect(kicks).toBe(16);
    expect(bass).toBeGreaterThan(20);
    expect(arp).toBeGreaterThan(20);
    expect(hats).toBe(32);
  });
  it('plays notes in a sensible audible range and changes chord every bar', () => {
    const roots = [0, 16, 32, 48].map((i) => musicStep(i).bass);
    expect(new Set(roots).size).toBe(4);
    for (let i = 0; i < 64; i++) { const n = musicStep(i); for (const f of [n.bass, n.arp]) if (f) { expect(f).toBeGreaterThan(40); expect(f).toBeLessThan(2000); } }
  });
  it('tempo is a lively but not frantic 132 BPM', () => { expect(BPM).toBe(132); expect(STEP_SECONDS).toBeCloseTo(60 / 132 / 2, 9); });
});
