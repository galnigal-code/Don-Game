// Pure tilt math (unit-tested). The phone is a steering wheel: we measure how far the
// device is rotated around the axis perpendicular to its screen, using gravity.
//
// Frames
//  - device frame: x = right, y = up on the NATURAL portrait screen (what devicemotion reports)
//  - screen frame: x = right, y = up on the screen AS THE USER SEES IT (portrait or landscape)
//  - `u` = accelerationIncludingGravity. On Android/Chrome it points "up" (reaction to gravity),
//    on iOS the sign is inverted. After the sign fix `u` is the world-up vector in device frame.
//  - angle = screen.orientation.angle = counter-clockwise rotation of the device from natural portrait.
export const DEG = Math.PI / 180;

export function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** World-up vector expressed in the screen frame. */
export function gravityToScreen(u, angleDeg) {
  const t = angleDeg * DEG, c = Math.cos(t), s = Math.sin(t);
  return { x: u.x * c - u.y * s, y: u.x * s + u.y * c };
}

/** Wheel rotation (radians). Positive = rotated CLOCKWISE as seen by the user (right side down). */
export function rollAngle(g) {
  return Math.atan2(-g.x, g.y);
}

/** a = {x, y} accelerationIncludingGravity. planar = how much gravity lies in the screen plane (≈9.8 when upright, ≈0 when flat). */
export function rollFromMotion(a, angleDeg, isIOS) {
  const k = isIOS ? -1 : 1;
  const g = gravityToScreen({ x: a.x * k, y: a.y * k }, angleDeg);
  return { roll: rollAngle(g), planar: Math.hypot(g.x, g.y) };
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
