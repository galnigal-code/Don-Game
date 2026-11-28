// Track map (V4-C): a half-transparent top-down map on the right side of the screen, under the speed. The track line is drawn
// once; the car dots are redrawn ~15 times a second. A 2D canvas: no extra 3D draw calls. It ignores touches.
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

/** Fit the track (top-down: x right, z down) into a square of `size` px with `pad`. Pure, unit-tested. */
export function fitTrack(points, size, pad) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const k = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ, 1);
  const ox = pad + ((size - 2 * pad) - (maxX - minX) * k) / 2, oz = pad + ((size - 2 * pad) - (maxZ - minZ) * k) / 2;
  return (x, z) => [ox + (x - minX) * k, oz + (z - minZ) * k];
}

export function createMinimap(root, track) {
  const cv = document.createElement('canvas');
  cv.id = 'minimap'; cv.setAttribute('aria-hidden', 'true');
  root.appendChild(cv);
  const g = cv.getContext('2d');
  const pts = track.samples.filter((p) => p.s >= 0 && p.s <= track.finishS).map((p) => ({ x: p.px, z: p.pz }));
  let base = null, px = 0, map = null, acc = 1;
  const tmp = {};

  function layout() {
    const css = Math.round(cv.getBoundingClientRect().width) || 140;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    px = Math.round(css * dpr);
    if (cv.width === px && base) return;
    cv.width = cv.height = px;
    map = fitTrack(pts, px, px * 0.1);
    base = document.createElement('canvas'); base.width = base.height = px;
    const b = base.getContext('2d');
    b.lineJoin = b.lineCap = 'round';
    const path = () => { b.beginPath(); pts.forEach((p, i) => { const [x, y] = map(p.x, p.z); if (i) b.lineTo(x, y); else b.moveTo(x, y); }); };
    path(); b.strokeStyle = 'rgba(0,0,0,.55)'; b.lineWidth = px * 0.05; b.stroke();          // outline (readable on sand and sky)
    path(); b.strokeStyle = 'rgba(255,255,255,.9)'; b.lineWidth = px * 0.025; b.stroke();
    // start (green tick) and finish (checkered square)
    const [sx, sy] = map(pts[0].x, pts[0].z); b.fillStyle = '#3ddc68'; b.beginPath(); b.arc(sx, sy, px * 0.03, 0, 7); b.fill();
    const [fx, fy] = map(pts[pts.length - 1].x, pts[pts.length - 1].z), q = px * 0.028;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { b.fillStyle = (i + j) % 2 ? '#111' : '#fff'; b.fillRect(fx - q + i * q, fy - q + j * q, q, q); }
  }
  addEventListener('resize', () => { base = null; });

  return {
    el: cv,
    /** cars: all cars; meId: the player's car (bigger, white ring, arrow); watchId: the car the spectator camera follows. */
    update(dt, cars, meId, watchId = null) {
      acc += dt; if (acc < 1 / 15) return; acc = 0;
      layout();
      g.clearRect(0, 0, px, px); g.drawImage(base, 0, 0);
      const r = px * 0.045;
      const order = [...cars].sort((a, b) => (a.id === meId) - (b.id === meId));       // mine on top
      for (const c of order) {
        if (c.state === 'respawning') continue;
        const sm = track.sample(Math.min(track.finishS, Math.max(0, c.s)), tmp);
        const [x, y] = map(sm.px + sm.rx * c.d, sm.pz + sm.rz * c.d);
        const me = c.id === meId, watch = c.id === watchId;
        g.beginPath(); g.arc(x, y, me ? r * 1.45 : r, 0, 7); g.fillStyle = hex(c.color); g.fill();
        g.lineWidth = me || watch ? px * 0.018 : px * 0.01; g.strokeStyle = me || watch ? '#fff' : 'rgba(0,0,0,.7)'; g.stroke();
        if (me) {                                         // an arrow pointing where the car drives
          const [ax, ay] = map(sm.px + sm.tx * 120, sm.pz + sm.tz * 120);
          const a = Math.atan2(ay - y, ax - x), L = r * 2.6;
          g.beginPath(); g.moveTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
          g.lineTo(x + Math.cos(a + 2.5) * r * 1.2, y + Math.sin(a + 2.5) * r * 1.2); g.lineTo(x + Math.cos(a - 2.5) * r * 1.2, y + Math.sin(a - 2.5) * r * 1.2);
          g.closePath(); g.fillStyle = '#fff'; g.fill();
        }
      }
    },
    setVisible(on) { cv.hidden = !on; },
  };
}
