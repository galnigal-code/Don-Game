// Development-only keyboard control (arrows/A-D steer, Shift/Up turbo, Space item, R restart).
export class KeyboardInput {
  constructor() {
    this.down = new Set(); this.steer = 0; this.onRestart = null;
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && !e.repeat) this.onRestart?.();
      this.down.add(e.code);
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }
  get turbo() { return this.down.has('ShiftLeft') || this.down.has('ShiftRight') || this.down.has('ArrowUp'); }
  get item() { return this.down.has('Space'); }
  update(dt) {
    const l = this.down.has('ArrowLeft') || this.down.has('KeyA');
    const r = this.down.has('ArrowRight') || this.down.has('KeyD');
    const target = (r ? 1 : 0) - (l ? 1 : 0);
    const rate = dt / 0.15;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));
    return this.steer;
  }
}
