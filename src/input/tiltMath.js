// Pure tilt math (unit-tested). The phone is a steering wheel: we measure how far the device is rotated
// around the axis perpendicular to its screen. That rotation is the same physical motion in portrait and in
// both landscape orientations, so the angle is measured in the DEVICE frame and the screen orientation is not used.
//
// u = accelerationIncludingGravity {x, y}: x = right edge, y = top edge of the NATURAL portrait screen.
// Android/Chrome reports the reaction to gravity (+up); iOS reports the opposite sign. Negating both axes only shifts the
// angle by 180 degrees and never changes the direction of rotation, so it is harmless, and it is undone anyway.
export const DEG = Math.PI / 180;

export function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Wheel angle (radians). A phone turned CLOCKWISE (right edge down) gives an INCREASING value. */
export function rollAngle(u) {
  return Math.atan2(-u.x, u.y);
}

/** a = {x, y}. planar = how much gravity lies in the screen plane (~9.8 when upright, ~0 when lying flat). */
export function rollFromMotion(a, isIOS = false) {
  const k = isIOS ? -1 : 1;
  const u = { x: a.x * k, y: a.y * k };
  return { roll: rollAngle(u), planar: Math.hypot(u.x, u.y) };
}

export function smoothAngle(prev, next, alpha) {
  return prev + wrapPi(next - prev) * alpha;
}

/** Roll (rad) relative to `zero` -> steering in [-1, 1] with dead zone and saturation at maxAngle. */
export function steerFromRoll(roll, zero, { deadZone, maxAngle, invert = false }) {
  const a = wrapPi(roll - zero) * (invert ? -1 : 1);
  const m = Math.abs(a);
  if (m < deadZone) return 0;
  return Math.sign(a) * Math.min(1, (m - deadZone) / (maxAngle - deadZone));
}
