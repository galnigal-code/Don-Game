import { desert } from './desert.js';
import { city } from './city.js';

export const TRACKS = { city, desert };
export const TRACK_IDS = Object.keys(TRACKS);
export const DEFAULT_TRACK = 'city';
export const isTrackId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(TRACKS, id);
