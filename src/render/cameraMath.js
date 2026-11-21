// Pure camera helpers (unit-tested).
const DEG = Math.PI / 180;

/**
 * Vertical field of view for a given aspect ratio. Landscape keeps the tuned 65 degrees. In portrait the horizontal view would
 * be tiny (the road and the bends hidden), so the vertical FOV grows to keep roughly a 60-70 degree horizontal view, up to a cap.
 */
export function baseFov(aspect, landscapeFov = 65, minHorizontal = 70, cap = 95) {
  if (aspect >= 1.2) return landscapeFov;
  const wanted = 2 * Math.atan(Math.tan((minHorizontal * DEG) / 2) / aspect) / DEG;
  return Math.min(cap, Math.max(landscapeFov, wanted));
}
export const horizontalFov = (vfov, aspect) => 2 * Math.atan(Math.tan((vfov * DEG) / 2) * aspect) / DEG;
