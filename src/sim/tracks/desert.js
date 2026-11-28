// The original desert track: point to point, one lap, canyon, cliff sections, a few jumps.
import { TRACK_PATH, SEGMENTS, LEAD_IN, RUN_OUT, RAMPS, FIXED_OBSTACLES, heightAt } from '../trackData.js';
import { CONFIG } from '../../config.js';

export const desert = {
  id: 'desert', name: 'מדבר', style: 'desert', loop: false, laps: 1,
  path: TRACK_PATH, segments: SEGMENTS, ramps: RAMPS, obstacles: FIXED_OBSTACLES, heightAt,
  leadIn: LEAD_IN, runOut: RUN_OUT, runoff: CONFIG.track.SAND_EXTRA,
};
