// TEMPORARY (until tilt steering arrives in M2): touch the left / right half of the screen to steer.
export class TouchSteerTemp {
  constructor(el) {
    this.pointers = new Map();
    el.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, e.clientX < innerWidth / 2 ? -1 : 1);
      el.setPointerCapture?.(e.pointerId);
    });
    const up = (e) => this.pointers.delete(e.pointerId);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  get steer() {
    let s = 0;
    for (const v of this.pointers.values()) s += v;
    return Math.max(-1, Math.min(1, s));
  }
}
