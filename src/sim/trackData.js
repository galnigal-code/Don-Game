// Desert track definition. Coordinates: s = meters along the track, s=0 is the START LINE.
// The track is described as a "turtle path": [length_m, total_heading_change_deg] (positive = right turn).
export const LEAD_IN = 40;   // straight before the start line (grid area)
export const RUN_OUT = 120;  // straight after the finish line (cars coast to a stop)

const RACE = [
  [150, 0], [200, 70], [150, 0], [220, -110], [120, 0], [200, 80], [180, -70], [100, 0],
  [240, 120], [150, 0], [200, -140], [100, 0], [220, 90], [160, -60], [150, 0], [200, -80],
  [100, 0], [60, 0],
];
export const TRACK_PATH = [[LEAD_IN, 0], ...RACE, [RUN_OUT, 0]];

// Special sections, by s range (relative to the start line).
//  canyon: narrow road with rock walls on both sides.
//  cliff : no fence on one side - driving off it means falling (respawn at checkpoint).
export const SEGMENTS = [
  { from: 640, to: 780, type: 'cliff', side: 'left' },
  { from: 1180, to: 1400, type: 'canyon' },
  { from: 1900, to: 2050, type: 'cliff', side: 'right' },
];

// Gentle rolling dunes; flat at the start.
export function heightAt(s) {
  const r = Math.min(1, Math.max(0, s / 200));
  const ramp = r * r * (3 - 2 * r);
  return ramp * (4 * Math.sin(s / 220) + 3 * Math.sin(s / 97 + 1));
}
