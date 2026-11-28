import { describe, it, expect } from 'vitest';
import { createTrack } from '../../src/sim/TrackModel.js';
import { crowdPlaces } from '../../src/render/Crowd.js';

describe('crowd placement', () => {
  const track = createTrack('city');
  const places = crowdPlaces(track);
  it('has a sensible number of people, none on the road', () => {
    expect(places.length).toBeGreaterThan(150);
    expect(places.length).toBeLessThan(900);
    for (const p of places.slice(0, 200)) {
      let best = 1e9;
      for (const sm of track.samples) best = Math.min(best, Math.hypot(sm.px - p.x, sm.pz - p.z));
      expect(best).toBeGreaterThan(track.samples[0].halfWidth + 0.5);
    }
  });
  it('is deterministic', () => { expect(crowdPlaces(track).length).toBe(places.length); });
});
