import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createTrack } from '../sim/TrackModel.js';
import { createWorld } from '../sim/World.js';
import { createBrain, drivePlayerProxy } from '../sim/BotDriver.js';
import { createRng } from '../sim/rng.js';
import { createRenderer } from '../render/Renderer.js';
import { buildTrackMesh } from '../render/TrackMesh.js';
import { createCarModel } from '../render/CarModel.js';
import { CameraRig } from '../render/CameraRig.js';
import { EntityViews } from '../render/EntityViews.js';
import { Effects } from '../render/Effects.js';
import { KeyboardInput } from '../input/KeyboardInput.js';
import { TouchSteerTemp } from '../input/TouchSteerTemp.js';
import { TiltInput } from '../input/TiltInput.js';
import { createScreens } from '../ui/screens.js';
import { createHud } from '../ui/hud.js';
import { createDebugOverlay } from '../debug/DebugOverlay.js';

const STEP = CONFIG.sim.STEP;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * States: menu -> calibrate -> countdown -> racing -> spectate -> results
 *                                   ^______________________________|  (new race)
 */
export class Game {
  constructor(canvas, uiRoot, params) {
    this.params = params;
    this.autopilot = params.has('autopilot');
    this.fast = Math.max(1, Number(params.get('fast')) || 1);
    this.fixedSeed = params.has('seed') ? Number(params.get('seed')) : null;

    const r = createRenderer(canvas);
    this.renderer = r.renderer; this.scene = r.scene; this.camera = r.camera;
    this.track = createTrack();
    this.scene.add(buildTrackMesh(this.track));
    this.rig = new CameraRig(this.camera);
    this.entityViews = new EntityViews(this.scene, this.track);
    this.effects = new Effects(this.scene);

    this.keyboard = new KeyboardInput();
    this.keyboard.onRestart = () => { if (this.state !== 'menu' && this.state !== 'calibrate') this.beginRace(); };
    this.touch = new TouchSteerTemp(canvas);
    canvas.addEventListener('pointerdown', () => { if (this.state === 'spectate') this.cycleSpectate(); });
    this.tilt = new TiltInput();
    if (params.has('invert')) this.tilt.invert = params.get('invert') !== '0';
    this.uiRoot = uiRoot;
    this.hud = createHud(uiRoot, {
      onRestart: () => this.beginRace(),
      onRecalibrate: () => this.toCalibrate(),
      onSkip: () => { this.skipping = true; },
    });
    this.screens = createScreens(uiRoot, this.tilt, { onPlay: () => this.onPlay(), onStart: () => this.onStartRace() });
    this.debug = params.has('debug') ? createDebugOverlay(uiRoot, this.renderer, this.tilt) : null;
    this.state = 'menu';

    this.carWorld = []; this.tmpSample = {}; this.tmpWorld = {}; this.tmpPos = new THREE.Vector3();
    this.views = [];
    this.newRace();

    this.acc = 0; this.last = performance.now(); this.paused = false;
    this.skipping = false; this.goTextT = 0; this.specId = null; this.spectateBannerSet = false;
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden; this.last = performance.now();
      if (!document.hidden && this.state !== 'menu' && this.state !== 'calibrate') this.keepAwake();
    });
    this.frame = this.frame.bind(this);
  }

  /* ---------- flow ---------- */

  start() {
    if (this.autopilot || this.params.has('skipCalib')) { this.tilt.start(); this.beginRace(); }
    else this.toMenu();
    requestAnimationFrame(this.frame);
  }

  setHudVisible(v) { this.uiRoot.classList.toggle('hud-hidden', !v); }
  toMenu() { this.state = 'menu'; this.setHudVisible(false); this.screens.showMenu(); }
  toCalibrate() { this.state = 'calibrate'; this.setHudVisible(false); this.hud.reset(); this.screens.showCalibrate(); }

  /** "Play" tap: must run inside the tap handler (iOS motion permission, fullscreen, orientation lock). */
  async onPlay() {
    const perm = this.tilt.requestPermission();
    const immersive = (async () => {
      try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* not allowed */ }
      try { await screen.orientation?.lock?.('landscape'); } catch { /* not supported */ }
    })();
    await Promise.all([perm, immersive]);
    this.tilt.start();
    this.toCalibrate();
  }

  onStartRace() { this.tilt.calibrate(); this.beginRace(); }

  newRace() {
    for (const v of this.views) this.scene.remove(v.root);
    const seed = this.fixedSeed ?? ((Math.random() * 1e9) | 0);
    this.world = createWorld({ track: this.track, seed });
    this.autoBrain = createBrain(createRng(seed + 1000), this.track);   // used by ?autopilot=1
    this.entityViews.setWorld(this.world);
    this.views = this.world.cars.map((car) => {
      const v = createCarModel(car.color, car.isPlayer ? null : car.name);
      this.scene.add(v.root);
      return v;
    });
    this.hud.reset();
    this.hud.setCars(this.world.cars);
    this.skipping = false; this.specId = null; this.spectateBannerSet = false;
    this.updateViews(0);
    this.rig.reset();
  }

  beginRace() {
    this.newRace();
    this.screens.hide();
    this.setHudVisible(true);
    this.state = 'countdown';
    this.countT = CONFIG.countdown.SECONDS;
    this.boostArmed = false; this.prevTurboCd = false;
    this.keepAwake();
  }

  async keepAwake() {
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { /* not available */ }
  }

  readTurbo() { return this.keyboard.turbo || this.hud.turboHeld || this.hud.consumePulse(); }

  /* ---------- per frame ---------- */

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    if (!this.paused) {
      if (this.state === 'countdown') this.updateCountdown(dt);
      if (this.state === 'racing' || this.state === 'spectate') this.runSim(dt);
      if (this.goTextT > 0) { this.goTextT -= dt; if (this.goTextT <= 0) this.hud.hideCountdown(); }
    }
    this.screens.update();
    this.render(dt);
    this.debug?.frame(dt, this);
  }

  updateCountdown(dt) {
    this.countT -= dt;
    const pressed = this.autopilot ? false : this.readTurbo();
    // pressing turbo in the last fraction of the countdown = start boost (no turbo is used up)
    if (pressed && !this.prevTurboCd && this.countT <= CONFIG.countdown.START_BOOST_WINDOW) this.boostArmed = true;
    this.prevTurboCd = pressed;
    if (this.countT > 0) { this.hud.showCountdown(String(Math.ceil(this.countT))); return; }
    this.world.go(this.boostArmed);
    this.world.player.prevTurboInput = true;   // a still-held button must not also burn a turbo
    this.state = 'racing';
    this.hud.showCountdown(this.boostArmed ? 'GO! 🚀' : 'GO!');
    this.goTextT = CONFIG.countdown.GO_TEXT_TIME;
  }

  runSim(dt) {
    if (this.skipping) {
      for (let i = 0; i < 60 && !this.world.done; i++) this.simStep();
    } else {
      this.acc += dt * this.fast;
      let n = 0;
      while (this.acc >= STEP && n++ < 5 * this.fast) { this.simStep(); this.acc -= STEP; }
      if (this.acc > STEP) this.acc = 0;
    }
    const w = this.world, p = w.player;
    if (this.state === 'racing' && p.state === 'finished') this.enterSpectate();
    if ((this.state === 'spectate' || this.state === 'racing') && w.done) this.enterResults();
  }

  simStep() {
    const w = this.world, car = w.player;
    if (car.state !== 'finished') {
      if (this.autopilot) drivePlayerProxy(car, this.autoBrain, w);
      else {
        const kb = this.keyboard.update(STEP);
        // tilt wins when the phone reports motion; touch-halves steering is only a fallback
        car.input.steer = clamp(this.tilt.active ? this.tilt.steer + kb : kb + this.touch.steer, -1, 1);
        car.input.turbo = this.readTurbo();
        car.input.item = this.keyboard.item || this.hud.consumeItemPulse();
      }
    }
    w.step(STEP);
  }

  enterSpectate() {
    this.state = 'spectate';
    const p = this.world.player;
    this.hud.setSpectate(true, p.place === 1 ? 'סיימת ראשון! 🏆' : `סיימת במקום ${p.place}`);
    this.pickSpectate(true);
  }

  enterResults() {
    this.state = 'results';
    this.hud.setSpectate(false);
    this.hud.showResults(this.world.finishOrder, this.world.player);
    this.skipping = false;
  }

  /** Spectator camera follows the best-placed car that is still racing. */
  pickSpectate(force = false) {
    const cars = this.world.ranked;
    const cur = cars.find((c) => c.id === this.specId);
    if (!force && cur && cur.state !== 'finished') return;
    const next = cars.find((c) => c.state !== 'finished') || cars[0];
    if (next.id !== this.specId) { this.specId = next.id; this.rig.reset(); }
  }
  cycleSpectate() {
    const open = this.world.ranked.filter((c) => c.state !== 'finished');
    if (open.length < 2) return;
    const i = open.findIndex((c) => c.id === this.specId);
    this.specId = open[(i + 1) % open.length].id;
    this.rig.reset();
  }

  /* ---------- drawing ---------- */

  /** Turn simulation events into visual effects (and camera shake for the player). */
  handleEvents(target) {
    const evs = this.world.events;
    if (this.skipping) { evs.length = 0; return; }
    const T = this.track, p = this.world.player, tmp = this.tmpWorld;
    for (const e of evs) {
      if (e.type === 'explosion') {
        T.toWorld(e.s, e.d, 0.8, tmp);
        this.effects.explosion(tmp.x, tmp.y, tmp.z);
        if (Math.abs(e.s - target.s) < 25) this.rig.shake(0.18);
      } else if (e.type === 'hit' && e.carId === p.id) {
        this.rig.shake(0.35);
      } else if (e.type === 'shield') {
        const c = this.world.cars.find((x) => x.id === e.carId);
        T.toWorld(c.s, c.d, 1, tmp); this.effects.puff(tmp.x, tmp.y, tmp.z);
      } else if (e.type === 'pickup') {
        const b = this.world.boxes[e.boxId];
        T.toWorld(b.s, b.d, 1.3, tmp); this.effects.sparkle(tmp.x, tmp.y, tmp.z);
      }
    }
    evs.length = 0;
  }


  updateViews(dt) {
    const T = this.track;
    this.world.cars.forEach((car, i) => {
      const v = this.views[i];
      const sm = T.sample(car.s, this.tmpSample);
      T.toWorld(car.s, car.d, car.h, this.tmpWorld);
      const heading = sm.heading + car.yaw;
      v.root.position.set(this.tmpWorld.x, this.tmpWorld.y, this.tmpWorld.z);
      v.root.rotation.set(Math.atan2(sm.ty, Math.hypot(sm.tx, sm.tz)), -heading, 0, 'YXZ');
      const k = car.hit.kind;
      const p = k ? 1 - car.hit.t / CONFIG.car.HIT_TIME[k] : 0;
      v.body.rotation.z = car.steer * 0.07 + (k === 'bump' ? Math.sin(p * 30) * 0.08 : 0);
      v.body.rotation.y = k === 'spin' ? p * Math.PI * 4 : k === 'slip' ? Math.sin(car.t * 9) * 0.45 : 0;
      v.body.rotation.x = k === 'launch' ? -p * Math.PI * 2 : 0;
      v.body.position.y = k === 'bump' ? Math.abs(Math.sin(p * Math.PI * 3)) * 0.45 : 0;
      v.shield.visible = car.shieldT > 0 && (car.shieldT > 1 || Math.floor(car.t * 8) % 2 === 0);
      for (const w of v.wheels) w.rotation.x -= (car.speed * dt) / 0.4;
      let visible = car.state !== 'respawning';
      if (car.invulnT > 0) visible = visible && Math.floor(car.t * 10) % 2 === 0;
      v.root.visible = visible;
      if (v.label) v.label.visible = this.camera.position.distanceToSquared(v.root.position) < 55 * 55;   // far labels only clutter
      const cw = (this.carWorld[i] ||= {});
      cw.x = this.tmpWorld.x; cw.y = this.tmpWorld.y; cw.z = this.tmpWorld.z; cw.heading = heading;
    });
  }

  render(dt) {
    const w = this.world, player = w.player;
    this.updateViews(dt);

    let target = player;
    if (this.state === 'spectate' || (this.state === 'results')) {
      if (this.state === 'spectate') this.pickSpectate();
      target = w.cars.find((c) => c.id === this.specId) || player;
    }
    const cw = this.carWorld[w.cars.indexOf(target)];
    this.tmpPos.set(cw.x, cw.y, cw.z);
    if (player.wallHit) { if (target === player) this.rig.shake(0.12); player.wallHit = false; }
    this.rig.update(dt, this.tmpPos, cw.heading, target.turboT > 0);

    this.handleEvents(target);
    this.entityViews.update(performance.now() / 1000, w);
    this.effects.update(dt);
    this.hud.update({ car: player, cars: w.cars, length: this.track.finishS });
    if (this.state === 'spectate') this.hud.updateStandings(w.ranked, this.specId);
    this.renderer.render(this.scene, this.camera);
  }
}
