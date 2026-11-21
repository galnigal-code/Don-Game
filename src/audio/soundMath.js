// Pure helpers for the synthesized audio (unit-tested).

/** Engine pitch (Hz) from speed (m/s). Turbo raises it. */
export function engineFreq(speed, turbo = false) {
  return (58 + Math.max(0, speed) * 3.1) * (turbo ? 1.22 : 1);
}
/** Engine loudness 0..1 from speed. */
export function engineGain(speed) {
  return Math.min(1, 0.25 + Math.max(0, speed) / 40);
}
/** Volume (0..1) of a world sound at `dist` metres from the listener. */
export function distanceGain(dist, near = 12, far = 90) {
  if (dist <= near) return 1;
  if (dist >= far) return 0;
  const t = (dist - near) / (far - near);
  return (1 - t) * (1 - t);
}

// ---- music: 4-bar loop (Am - F - C - G), 8th-note steps -----------------------------------
export const BPM = 132;
export const STEP_SECONDS = 60 / BPM / 2;
const ROOTS = [110.0, 87.31, 130.81, 98.0];                   // A2 F2 C3 G2
const CHORDS = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];   // minor, major, major, major (semitones)
const semis = (f, n) => f * Math.pow(2, n / 12);

/** Notes to play at step i (0..63 repeat): {bass, arp, hat, kick} (frequencies or null). */
export function musicStep(i) {
  const s = ((i % 64) + 64) % 64;
  const bar = Math.floor(s / 16), pos = s % 16;
  const root = ROOTS[bar], chord = CHORDS[bar];
  const bass = pos % 4 === 0 || pos % 8 === 3 ? root : (pos % 2 === 0 ? root * 2 : null);
  const arp = pos % 2 === 1 || pos % 4 === 2 ? semis(root * 4, chord[[0, 1, 2, 1, 0, 2, 1, 2][pos % 8]]) : null;
  return { bass, arp, hat: pos % 2 === 1, kick: pos % 4 === 0 };
}
