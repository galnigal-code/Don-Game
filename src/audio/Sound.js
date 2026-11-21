import { engineFreq, engineGain, distanceGain, musicStep, STEP_SECONDS } from './soundMath.js';

const KEY = 'dongame.muted';

/** All sound is synthesized with the Web Audio API (no files). Create on load, call unlock() from a tap. */
export class Sound {
  constructor() {
    this.ctx = null; this.muted = false;
    try { this.muted = localStorage.getItem(KEY) === '1'; } catch { /* ignore */ }
    this.musicOn = false; this.musicStep = 0; this.nextTime = 0; this.timer = null;
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Must be called from a user gesture (tap) at least once. Safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const c = this.ctx;
        this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(c.destination);
        this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
        this.musicBus = c.createGain(); this.musicBus.gain.value = 0.16; this.musicBus.connect(this.master);
        // 1 s of white noise, reused for hats, whooshes and explosions
        const len = c.sampleRate;
        this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.buildEngine();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* audio is optional */ }
  }

  buildEngine() {
    const c = this.ctx;
    this.eng = { gain: c.createGain(), filter: c.createBiquadFilter(), o1: c.createOscillator(), o2: c.createOscillator(), g2: c.createGain(), lfo: c.createOscillator(), lfoG: c.createGain() };
    const e = this.eng;
    e.o1.type = 'sawtooth'; e.o2.type = 'square'; e.g2.gain.value = 0.5;
    e.filter.type = 'lowpass'; e.filter.frequency.value = 600; e.filter.Q.value = 2;
    e.gain.gain.value = 0;
    e.lfo.frequency.value = 17; e.lfoG.gain.value = 3.5; e.lfo.connect(e.lfoG); e.lfoG.connect(e.o1.frequency);
    e.o1.connect(e.filter); e.o2.connect(e.g2); e.g2.connect(e.filter); e.filter.connect(e.gain); e.gain.connect(this.sfxBus);
    e.o1.start(); e.o2.start(); e.lfo.start();
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.03);
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  suspend() { this.ctx?.suspend?.(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  /* ---------- engine (call every frame) ---------- */
  engine(speed, turbo, on) {
    if (!this.ctx) return;
    const e = this.eng, t = this.ctx.currentTime;
    const f = engineFreq(speed, turbo);
    e.o1.frequency.setTargetAtTime(f, t, 0.05);
    e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.filter.frequency.setTargetAtTime(380 + speed * 22 + (turbo ? 500 : 0), t, 0.08);
    e.gain.gain.setTargetAtTime(on ? 0.1 * engineGain(speed) : 0, t, 0.1);
  }

  /* ---------- building blocks ---------- */
  tone(freq, dur, { type = 'square', vol = 0.2, slideTo = null, delay = 0, bus = this.sfxBus } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { vol = 0.3, from = 2000, to = 300, type = 'lowpass', delay = 0, q = 1, bus = this.sfxBus } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus); src.start(t); src.stop(t + dur + 0.05);
  }

  /* ---------- effects ---------- */
  beep(final = false) { this.tone(final ? 880 : 440, final ? 0.5 : 0.18, { type: 'square', vol: 0.22 }); }
  turbo() { this.noise(0.9, { vol: 0.35, type: 'bandpass', from: 500, to: 3200, q: 0.8 }); this.tone(180, 0.5, { type: 'sawtooth', vol: 0.12, slideTo: 520 }); }
  pickup() { this.tone(660, 0.1, { vol: 0.16 }); this.tone(990, 0.16, { vol: 0.16, delay: 0.08 }); }
  roulette() { for (let i = 0; i < 6; i++) this.tone(500 + (i % 3) * 120, 0.05, { vol: 0.07, delay: i * 0.12, type: 'triangle' }); }
  ready() { this.tone(880, 0.08, { vol: 0.14, type: 'triangle' }); this.tone(1320, 0.14, { vol: 0.14, delay: 0.07, type: 'triangle' }); }
  use(item, vol = 1) {
    switch (item) {
      case 'missile': this.noise(0.7, { vol: 0.35 * vol, type: 'bandpass', from: 2500, to: 500, q: 1.2 }); this.tone(300, 0.5, { type: 'sawtooth', vol: 0.1 * vol, slideTo: 900 }); break;
      case 'gun': for (let i = 0; i < 5; i++) this.noise(0.06, { vol: 0.3 * vol, type: 'highpass', from: 3500, to: 1500, delay: i * 0.12 }); break;
      case 'shield': this.tone(700, 0.5, { type: 'sine', vol: 0.14 * vol, slideTo: 1400 }); this.tone(1050, 0.5, { type: 'sine', vol: 0.1 * vol, slideTo: 2100, delay: 0.05 }); break;
      default: this.tone(220, 0.15, { type: 'square', vol: 0.18 * vol, slideTo: 110 }); this.noise(0.12, { vol: 0.15 * vol, from: 900, to: 200 });   // drop mine / oil / barrel
    }
  }
  explosion(vol = 1) { this.noise(0.8, { vol: 0.6 * vol, from: 1800, to: 80 }); this.tone(110, 0.5, { type: 'sine', vol: 0.4 * vol, slideTo: 35 }); }
  hit() { this.tone(160, 0.35, { type: 'sawtooth', vol: 0.22, slideTo: 60 }); this.noise(0.25, { vol: 0.3, from: 1200, to: 150 }); }
  shieldBlock() { this.tone(1200, 0.18, { type: 'sine', vol: 0.18, slideTo: 1800 }); }
  bump() { this.noise(0.15, { vol: 0.3, from: 700, to: 120 }); this.tone(90, 0.12, { type: 'sine', vol: 0.25 }); }
  fall() { this.tone(600, 0.9, { type: 'sine', vol: 0.18, slideTo: 80 }); }
  respawn() { this.tone(300, 0.12, { vol: 0.14, type: 'triangle' }); this.tone(450, 0.12, { vol: 0.14, delay: 0.1, type: 'triangle' }); this.tone(600, 0.18, { vol: 0.14, delay: 0.2, type: 'triangle' }); }
  jump() { this.tone(200, 0.35, { type: 'triangle', vol: 0.14, slideTo: 420 }); }
  land() { this.noise(0.14, { vol: 0.25, from: 800, to: 150 }); }
  finish(win) { const notes = win ? [523, 659, 784, 1047] : [392, 466, 523]; notes.forEach((f, i) => this.tone(f, 0.28, { type: 'square', vol: 0.16, delay: i * 0.13 })); }
  at(dist, fn, ...args) { const v = distanceGain(dist); if (v > 0.02) fn.call(this, ...args, v); }

  /* ---------- music (simple looping groove) ---------- */
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true; this.musicStep = 0; this.nextTime = this.ctx.currentTime + 0.1;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(0.16, this.ctx.currentTime, 0.2);
    this.timer = setInterval(() => this.scheduleMusic(), 40);
  }
  stopMusic() {
    if (!this.musicOn) return;
    this.musicOn = false; clearInterval(this.timer); this.timer = null;
    this.musicBus?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
  }
  scheduleMusic() {
    if (!this.ctx || this.ctx.state !== 'running') { if (this.ctx) this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.05); return; }
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const n = musicStep(this.musicStep), t = this.nextTime - this.ctx.currentTime;
      if (n.bass) this.tone(n.bass, STEP_SECONDS * 1.8, { type: 'square', vol: 0.5, delay: Math.max(0, t), bus: this.musicBus });
      if (n.arp) this.tone(n.arp, STEP_SECONDS * 1.4, { type: 'triangle', vol: 0.4, delay: Math.max(0, t), bus: this.musicBus });
      if (n.hat) this.noise(0.04, { vol: 0.18, type: 'highpass', from: 7000, to: 5000, delay: Math.max(0, t), bus: this.musicBus });
      if (n.kick) this.tone(120, 0.12, { type: 'sine', vol: 0.7, slideTo: 40, delay: Math.max(0, t), bus: this.musicBus });
      this.nextTime += STEP_SECONDS; this.musicStep++;
    }
  }
}
