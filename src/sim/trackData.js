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


// Ramps. The car follows the ramp surface (rise over len metres ending at s) and is launched at s.
// With a gap, the road is missing between gap.from and gap.to: land beyond it or fall (respawn at the checkpoint).
// Flight distance = speed * 2*launchVy/gravity, so a ramp needs at least ~21 m/s to clear a 16 m gap.
export const RAMPS = [
  { s: 420, rise: 1.4, len: 6, launchVy: 11, gap: null },                      // just a hop
  { s: 980, rise: 1.4, len: 6, launchVy: 11, gap: { from: 984, to: 1000 } },
  { s: 1630, rise: 1.4, len: 6, launchVy: 11, gap: { from: 1634, to: 1650 } },
  { s: 2450, rise: 1.4, len: 6, launchVy: 11, gap: { from: 2454, to: 2470 } },
];

// Fixed obstacles: barrels break when hit, rocks stay. Both cost a bump (~1 s slow).
export const FIXED_OBSTACLES = [
  { s: 540, d: 3.5, kind: 'barrel' }, { s: 600, d: -4, kind: 'rock' },
  { s: 880, d: -3, kind: 'barrel' }, { s: 880, d: 4, kind: 'barrel' },
  { s: 1100, d: 0, kind: 'rock' }, { s: 1220, d: -2.5, kind: 'rock' }, { s: 1340, d: 2.5, kind: 'barrel' },
  { s: 1480, d: -4, kind: 'barrel' }, { s: 1800, d: 3, kind: 'rock' }, { s: 2100, d: -3.5, kind: 'barrel' },
  { s: 2300, d: 4, kind: 'rock' }, { s: 2560, d: -3, kind: 'barrel' }, { s: 2700, d: 2, kind: 'rock' },
];
