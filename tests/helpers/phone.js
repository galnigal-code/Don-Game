// Physical phone model for tests. It deliberately does NOT use any of the game's own formulas.
// World frame (the viewer): X right, Y up, Z towards the viewer. The accelerometer reports the REACTION to gravity,
// i.e. the world "up" vector expressed in the device axes (x = right edge of the natural portrait screen, y = its top).
export const G = 9.81;
const rad = (d) => (d * Math.PI) / 180;
const rotCCW = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

/**
 * rest: how far the phone's natural top is rotated counter-clockwise from the viewer's upright (0, 90, 180, 270).
 *       (landscape with the top to the left = 90, top to the right = 270)
 * cw:   additional rotation, in degrees, CLOCKWISE as the viewer sees it (right edge of the screen goes down) = turning a wheel right.
 * opts: mirrorX = a (hypothetical) device that reports its x axis mirrored; flipSign = iOS-style negated readings.
 */
export function reading(rest, cw, { mirrorX = false, flipSign = false } = {}) {
  const t = rad(rest), c = -rad(cw);                      // clockwise is negative counter-clockwise
  const xd = rotCCW(rotCCW({ x: 1, y: 0 }, t), c);       // device axes in the world frame
  const yd = rotCCW(rotCCW({ x: 0, y: 1 }, t), c);
  let u = { x: xd.y * G, y: yd.y * G, z: 0 }; // up = (0,1): its component along each device axis
  if (mirrorX) u.x = -u.x;
  if (flipSign) u = { x: -u.x, y: -u.y, z: 0 };
  return u;
}
