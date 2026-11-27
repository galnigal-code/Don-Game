import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createTrack } from '../sim/TrackModel.js';
import { createWorld } from '../sim/World.js';
import { createBrain, drivePlayerProxy } from '../sim/BotDriver.js';
import { createRng } from '../sim/rng.js';
import { createRenderer } from '../render/Renderer.js';
import { buildTrackMesh } from '../render/TrackMesh.js';
import { loadSurfaceTextures } from '../render/textures.js';
import { createCarModel } from '../render/CarModel.js';
import { CameraRig } from '../render/CameraRig.js';
import { EntityViews } from '../render/EntityViews.js';
import { Effects } from '../render/Effects.js';
import { Particles } from '../render/Particles.js';
import { createRollerModel } from '../render/RollerModel.js';
import { buildEnvironment } from '../render/Environment.js';
import { QualityController, LEVELS, initialLevel } from '../render/quality.js';
import { distanceGain } from '../audio/soundMath.js';
import { KeyboardInput } from '../input/KeyboardInput.js';
import { TouchSteerTemp } from '../input/TouchSteerTemp.js';
import { TiltInput } from '../input/TiltInput.js';
import { createScreens } from '../ui/screens.js';
import { createHud } from '../ui/hud.js';
import { createDebugOverlay } from '../debug/DebugOverlay.js';
import { Sound } from '../audio/Sound.js';
import { BUILD_ID, BUILD_LABEL, isOutdated, fetchPublished } from '../version.js';

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
    this.renderer = r.renderer; this.scene = r.scene; this.camera = r.camera; this.setRatioCap = r.setRatioCap;
    this.track = createTrack();
    this.trackMesh = buildTrackMesh(this.track);
    this.scene.add(this.trackMesh);
    this.env = buildEnvironment(this.track, this.scene);
    this.surfaceTex = null;
    this.setupQuality(params);
    if (!params.has('notex')) loadSurfaceTextures().then((t) => { this.surfaceTex = t; this.applyQuality(this.qLevel); window.__texLoaded = true; });
    this.rig = new CameraRig(this.camera);
    this.entityViews = new EntityViews(this.scene, this.track);
    this.effects = new Effects(this.scene);
    this.particles = new Particles(this.scene);
    this.rollerView = createRollerModel();
    this.scene.add(this.rollerView.root);
    this.rollerSmokeAcc = 0; this.pingAcc = 0; this.lastDangerVibrate = 0;
    this.emitAcc = new Map();
    this.v3 = new THREE.Vector3();

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
    this.sound = new Sound();
    const mute = document.createElement('button');
    mute.id = 'btn-mute'; mute.setAttribute('aria-label', 'השתק');
    const paintMute = () => { mute.textContent = this.sound.muted ? '🔇' : '🔊'; };
    paintMute();
    mute.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sound.unlock(); this.sound.toggleMute(); paintMute(); });
    uiRoot.appendChild(mute);
    // emergency "steering feels reversed" switch, available during the race
    const flip = document.createElement('button');
    flip.id = 'btn-flip'; flip.textContent = '↔'; flip.setAttribute('aria-label', 'הפוך כיוון היגוי');
    const toast = document.createElement('div'); toast.id = 'toast';
    this.toastEl = toast;
    flip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.tilt.flipDirection();
      toast.textContent = 'כיוון ההיגוי הוחלף'; toast.classList.add('on');
      clearTimeout(this.toastT); this.toastT = setTimeout(() => toast.classList.remove('on'), 1400);
    });
    uiRoot.appendChild(flip); uiRoot.appendChild(toast);
    // any first tap unlocks audio (autopilot / skipCalib flows have no "play" button)
    addEventListener('pointerdown', () => this.sound.unlock(), { once: false, capture: true });
    this.screens = createScreens(uiRoot, this.tilt, { onPlay: () => this.onPlay(), onStart: () => this.onStartRace() });
    this.debug = params.has('debug') ? createDebugOverlay(uiRoot, this.renderer, this.tilt) : null;
    this.state = 'menu';
    this.setupVersionBadge(uiRoot);

    this.carWorld = []; this.tmpSample = {}; this.tmpWorld = {}; this.tmpPos = new THREE.Vector3();
    this.views = [];
    this.newRace();

    this.acc = 0; this.last = performance.now(); this.paused = false;
    this.skipping = false; this.goTextT = 0; this.specId = null; this.spectateBannerSet = false;
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden; this.last = performance.now();
      if (document.hidden) this.sound.suspend(); else this.sound.resume();
      if (!document.hidden && this.state !== 'menu' && this.state !== 'calibrate') this.keepAwake();
    });
    this.frame = this.frame.bind(this);
  }

  /* ---------- quality ---------- */

  /** ?quality=0..3 pins a level; otherwise it adapts to the frame rate. The last level is remembered for the next visit. */
  setupQuality(params) {
    const q = params.get('quality');
    const pinned = q !== null && q !== 'auto' && !Number.isNaN(Number(q)) ? Math.max(0, Math.min(3, Number(q))) : null;
    let start = initialLevel({ cores: navigator.hardwareConcurrency || 8, memory: navigator.deviceMemory || 8 });
    try { const saved = Number(localStorage.getItem('dongame.quality')); if (!Number.isNaN(saved) && localStorage.getItem('dongame.quality') !== null) start = Math.min(start, Math.max(0, Math.min(3, saved))); } catch { /* ignore */ }
    if (pinned !== null) start = pinned;
    this.quality = new QualityController({ start });
    this.qualityPinned = pinned !== null;
    this.cpuMs = 0; this.submitMs = 0; this.simMs = 0;
    this.applyQuality(this.quality.level);
  }

  applyQuality(level) {
    const L = LEVELS[level];
    this.qLevel = level; this.qCfg = L;
    this.setRatioCap(L.pixelRatio);
    this.env.setDetail(L.decor);
    this.trackMesh.userData.applySurfaces(this.surfaceTex, L);
    this.env.applySurfaces(this.surfaceTex, L);
    try { localStorage.setItem('dongame.quality', String(level)); } catch { /* ignore */ }
  }

  /* ---------- version ---------- */

  /** Shows which build is running and reloads (or offers to) when a newer one has been published. */
  setupVersionBadge(uiRoot) {
    const badge = document.createElement('div');
    badge.id = 'build'; badge.textContent = 'גרסה ' + BUILD_LABEL;
    const update = document.createElement('button');
    update.id = 'btn-update'; update.hidden = true; update.textContent = 'יצאה גרסה חדשה, לחץ לעדכון';
    const reload = (id) => { location.replace(`${location.pathname}?v=${encodeURIComponent(id)}`); };
    update.addEventListener('click', () => reload(this.publishedId || Date.now()));
    uiRoot.appendChild(badge); uiRoot.appendChild(update);
    const check = async () => {
      const pub = await fetchPublished();
      if (!pub || !isOutdated(BUILD_ID, pub.id)) { update.hidden = true; return; }
      this.publishedId = pub.id;
      let tried = null;
      try { tried = sessionStorage.getItem('dongame.autoReload'); } catch { /* ignore */ }
      // idle on the menu: refresh silently, once per published version. Otherwise (or if it did not help) show the button.
      if ((this.state === 'menu') && tried !== pub.id) {
        try { sessionStorage.setItem('dongame.autoReload', pub.id); } catch { /* ignore */ }
        reload(pub.id);
      } else update.hidden = false;
    };
    this.checkVersion = check;
    check();
    setInterval(check, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }

  /* ---------- flow ---------- */

  start() {
    if (this.autopilot || this.params.has('skipCalib')) { this.tilt.start(); this.beginRace(); }
    else this.toMenu();
    requestAnimationFrame(this.frame);
  }

  setHudVisible(v) { this.uiRoot.classList.toggle('hud-hidden', !v); }
  toMenu() {
    this.sound.stopMusic(); this.state = 'menu'; this.setHudVisible(false); this.screens.showMenu(); }
  toCalibrate() { this.sound.stopMusic(); this.state = 'calibrate'; this.setHudVisible(false); this.hud.reset(); this.screens.showCalibrate(); }

  /** "Play" tap: must run inside the tap handler (iOS motion permission, fullscreen, orientation lock). */
  async onPlay() {
    this.sound.unlock();
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
    for (const v of this.views) { this.scene.remove(v.root); this.scene.remove(v.blob); }
    const seed = this.fixedSeed ?? ((Math.random() * 1e9) | 0);
    this.world = createWorld({ track: this.track, seed, roller: this.params.has('roller') ? this.params.get('roller') === '1' : CONFIG.roller.ENABLED });   // shelved: ?roller=1 brings it back (tests)
    this.autoBrain = createBrain(createRng(seed + 1000), this.track);   // used by ?autopilot=1
    this.entityViews.setWorld(this.world);
    this.views = this.world.cars.map((car) => {
      const v = createCarModel(car.color, car.isPlayer ? null : car.name);
      this.scene.add(v.root); this.scene.add(v.blob);
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
    this.countT = CONFIG.countdown.SECONDS; this.lastBeep = null;
    this.sound.stopMusic(); this.sound.startMusic();
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
      if (this.state === 'racing' || this.state === 'spectate') { const ts = performance.now(); this.runSim(dt); this.simMs += (performance.now() - ts - this.simMs) * 0.05; }
      if (this.goTextT > 0) { this.goTextT -= dt; if (this.goTextT <= 0) this.hud.hideCountdown(); }
    }
    if (!this.paused && !this.qualityPinned) {
      const changed = this.quality.frame(dt);
      if (changed !== null) this.applyQuality(changed);
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
    if (this.countT > 0) {
      const n = Math.ceil(this.countT);
      this.hud.showCountdown(String(n));
      if (this.lastBeep !== n) { this.lastBeep = n; this.sound.beep(false); }
      return;
    }
    this.sound.beep(true);
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
    if (this.state === 'racing' && (p.state === 'finished' || p.state === 'eliminated')) this.enterSpectate();
    if ((this.state === 'spectate' || this.state === 'racing') && w.done) this.enterResults();
  }

  simStep() {
    const w = this.world, car = w.player;
    if (car.state !== 'finished' && car.state !== 'eliminated') {
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
    if (p.state === 'eliminated') this.hud.setSpectate(true, 'נדרסת! 🫓 צופים בשאר המרוץ');
    else { this.sound.finish(p.place === 1); this.hud.setSpectate(true, p.place === 1 ? 'סיימת ראשון! 🏆' : `סיימת במקום ${p.place}`); }
    this.hud.setDanger(0);
    this.pickSpectate(true);
  }

  enterResults() {
    this.state = 'results';
    this.sound.stopMusic();
    this.hud.setSpectate(false);
    this.hud.setDanger(0);
    this.hud.showResults(this.world.finalOrder(), this.world.player);
    this.skipping = false;
  }

  /** Spectator camera follows the best-placed car that is still racing. */
  pickSpectate(force = false) {
    const cars = this.world.ranked;
    const cur = cars.find((c) => c.id === this.specId);
    const out = (c) => c.state === 'finished' || c.state === 'eliminated';
    if (!force && cur && !out(cur)) return;
    const next = cars.find((c) => !out(c)) || cars[0];
    if (next.id !== this.specId) { this.specId = next.id; this.rig.reset(); }
  }
  cycleSpectate() {
    const open = this.world.ranked.filter((c) => c.state !== 'finished' && c.state !== 'eliminated');
    if (open.length < 2) return;
    const i = open.findIndex((c) => c.id === this.specId);
    this.specId = open[(i + 1) % open.length].id;
    this.rig.reset();
  }

  showToast(text, ms = 1400) {
    const t = this.toastEl; if (!t) return;
    t.textContent = text; t.classList.add('on');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('on'), ms);
  }

  /* ---------- drawing ---------- */

  /** The roller: model, rumble, smoke and the warnings for the player. */
  updateRoller(dt, target, player) {
    const T = this.track, roller = this.world.roller, rv = this.rollerView;
    if (!roller.active) { rv.root.visible = false; this.sound.rollerRumble(0, false); if (this.state !== 'results') this.hud.setDanger(0); return; }
    const sm = T.sample(roller.s - 1.5, this.tmpSample);
    T.toWorld(roller.s - 1.5, 0, 0, this.tmpWorld);
    rv.root.visible = true;
    rv.root.position.set(this.tmpWorld.x, this.tmpWorld.y, this.tmpWorld.z);
    rv.root.rotation.set(Math.atan2(sm.ty, Math.hypot(sm.tx, sm.tz)), -sm.heading, 0, 'YXZ');
    rv.update(Math.min(20, sm.halfWidth * 2 + 1.2), roller.speed, dt, this.world.time);
    // smoke from the chimney
    this.rollerSmokeAcc += dt * 14;
    while (this.rollerSmokeAcc >= 1) {
      this.rollerSmokeAcc -= 1;
      rv.root.updateMatrixWorld(true);
      this.v3.copy(rv.chimney); rv.root.localToWorld(this.v3);
      this.particles.emit(this.v3.x, this.v3.y, this.v3.z, (Math.random() - 0.5) * 1.2, 3 + Math.random() * 2, (Math.random() - 0.5) * 1.2,
        { size: 0.9, life: 1.4, color: 0x4a4a4a, alpha: 0.55, grow: 3, drag: 0.6, up: 1 });
    }
    // rumble: louder the closer it is to what the camera follows
    this.sound.rollerRumble(distanceGain(Math.abs(target.s - roller.s), 25, 160), true);
    // warnings for the player (while still racing)
    if (this.state === 'racing' && player.state === 'driving') {
      const d = player.s - roller.s, R = CONFIG.roller;
      const k = Math.max(0, Math.min(1, (R.DANGER_DIST - d) / (R.DANGER_DIST - 15)));
      this.hud.setDanger(k);
      const now = performance.now();
      if (d < R.VIBRATE_DIST && now - this.lastDangerVibrate > 900) { this.lastDangerVibrate = now; navigator.vibrate?.(35); }
      if (k > 0.35) { this.pingAcc += dt * (2 + 5 * k); if (this.pingAcc >= 1) { this.pingAcc = 0; this.sound.dangerPing(k); } }
    } else if (this.state !== 'racing') this.hud.setDanger(0);
  }

  /** Engine loop and one-shot sounds that follow the player's state changes. */
  frameSounds(player, target) {
    const sd = this.sound;
    if (!sd.ctx) return;
    const racing = this.state === 'racing' || this.state === 'spectate' || this.state === 'countdown';
    sd.engine(target.speed, target.turboT > 0, racing && target.state === 'driving');
    const prev = this.prevPlayer || (this.prevPlayer = {});
    if (player.turboT > 0 && !prev.turbo) sd.turbo();
    if (player.state === 'falling' && prev.state !== 'falling') sd.fall();
    if (player.state === 'driving' && prev.state === 'respawning') sd.respawn();
    const air = player.h > this.track.groundHeight(player.s) + 0.4;
    if (air && !prev.air) sd.jump();
    if (!air && prev.air && player.state === 'driving') sd.land();
    if (this.readyAt && performance.now() >= this.readyAt) { this.readyAt = 0; if (player.item) sd.ready(); }
    prev.turbo = player.turboT > 0; prev.state = player.state; prev.air = air;
  }

  /** Dust from the rear wheels (more on sand / with turbo) and turbo flames from the exhausts. */
  emitCarParticles(car, v, dt) {
    const onGround = car.state === 'driving' && car.h < 0.3 + this.track.groundHeight(car.s);
    const turbo = car.turboT > 0 || car.boostT > 0;
    for (const f of v.flames) f.visible = turbo && car.state === 'driving';
    if (turbo && car.state === 'driving') for (const f of v.flames) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    if (!onGround || car.speed < 6) return;
    v.root.updateMatrixWorld(true);
    const heading = this.carWorld[this.world.cars.indexOf(car)]?.heading ?? 0;
    const bx = Math.sin(heading), bz = -Math.cos(heading);            // car forward
    const rate = (car.offroad ? 70 : 22) * Math.min(1, car.speed / 25) * (turbo ? 1.6 : 1) * this.qCfg.particles;
    let acc = (this.emitAcc.get(car) || 0) + rate * dt;
    while (acc >= 1) {
      acc -= 1;
      const w = v.wheels[2 + (Math.random() < 0.5 ? 0 : 1)];
      w.getWorldPosition(this.v3);
      this.particles.emit(this.v3.x, this.v3.y - 0.15, this.v3.z,
        -bx * 2 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.4, -bz * 2 + (Math.random() - 0.5) * 2,
        { size: 0.5 + Math.random() * 0.5, life: 0.5 + Math.random() * 0.4, color: car.offroad ? 0xd9b27a : 0xcdb08a, alpha: car.offroad ? 0.5 : 0.28, grow: 2.2, drag: 1.6, up: 0.5 });
    }
    this.emitAcc.set(car, acc);
    if (turbo) {
      for (const f of v.flames) {
        f.getWorldPosition(this.v3);
        this.particles.emit(this.v3.x, this.v3.y, this.v3.z, -bx * 9 + (Math.random() - 0.5), 0.3 + Math.random() * 0.4, -bz * 9 + (Math.random() - 0.5),
          { size: 0.35, life: 0.18 + Math.random() * 0.1, color: Math.random() < 0.5 ? 0xffb030 : 0xff6a10, alpha: 0.95, grow: 0.8, drag: 3 });
      }
    }
  }

  /** Turn simulation events into visual effects (and camera shake for the player). */
  handleEvents(target) {
    const evs = this.world.events;
    if (this.skipping) { evs.length = 0; return; }
    const T = this.track, p = this.world.player, tmp = this.tmpWorld;
    const dist = (s) => Math.abs(s - target.s);
    for (const e of evs) {
      if (e.type === 'roller-start') {
        this.showToast('⚠️ המכבש יצא לדרך! אל תעצרו', 2600);
        this.sound.warn(); this.rig.shake(0.2); navigator.vibrate?.([80, 60, 80]);
      } else if (e.type === 'flattened') {
        const c = this.world.cars.find((x) => x.id === e.carId);
        this.sound.at(dist(e.s), (v) => this.sound.squash(v));
        T.toWorld(e.s, e.d, 0.4, tmp);
        for (let q = 0; q < 10; q++) this.particles.emit(tmp.x, tmp.y, tmp.z, (Math.random() - 0.5) * 8, 0.5 + Math.random() * 2, (Math.random() - 0.5) * 8,
          { size: 0.7 + Math.random() * 0.6, life: 0.7, color: 0xb9a58c, alpha: 0.6, grow: 2, drag: 2.5, up: 0.5 });
        if (c === p) { navigator.vibrate?.([60, 40, 140]); this.rig.shake(0.35); }
      } else if (e.type === 'explosion') {
        this.sound.at(dist(e.s), this.sound.explosion);
        T.toWorld(e.s, e.d, 0.8, tmp);
        this.effects.explosion(tmp.x, tmp.y, tmp.z);
        for (let q = 0; q < 14; q++) this.particles.emit(tmp.x, tmp.y, tmp.z, (Math.random() - 0.5) * 12, 2 + Math.random() * 7, (Math.random() - 0.5) * 12,
          { size: 0.5 + Math.random() * 0.6, life: 0.6 + Math.random() * 0.5, color: q % 3 === 0 ? 0x2a2a2a : q % 3 === 1 ? 0xff8a1f : 0xc9a36b, alpha: 0.85, grow: 1.4, drag: 1.2, up: -9 });
        if (Math.abs(e.s - target.s) < 25) this.rig.shake(0.18);
      } else if (e.type === 'collide') {
        T.toWorld(e.s, e.d, 0.6, tmp);
        const n = 6 + Math.min(8, Math.round(e.strength * 0.5));
        for (let q = 0; q < n; q++) this.particles.emit(tmp.x, tmp.y, tmp.z, (Math.random() - 0.5) * 9, 1 + Math.random() * 4, (Math.random() - 0.5) * 9,
          { size: 0.22 + Math.random() * 0.18, life: 0.2 + Math.random() * 0.15, color: q % 2 ? 0xffffff : 0xffd45a, alpha: 1, grow: 0.3, drag: 2, up: -7 });
        this.sound.at(dist(e.s), (v) => this.sound.clank(e.strength, v));
        if (e.a === p.id || e.b === p.id) {
          this.rig.shake(Math.min(0.4, 0.08 + e.strength * 0.015));
          const nowMs = performance.now();
          if (nowMs - (this.lastVibrate || 0) > 400) { this.lastVibrate = nowMs; navigator.vibrate?.(e.strength > 12 ? 45 : 25); }
        }
      } else if (e.type === 'hit') {
        if (e.carId === p.id) { this.rig.shake(0.35); this.sound.hit(); }
        else if (e.kind === 'bump') this.sound.at(dist(this.world.cars.find((x) => x.id === e.carId).s), this.sound.bump);
      } else if (e.type === 'use') {
        const c = this.world.cars.find((x) => x.id === e.carId);
        this.sound.at(dist(c.s), (v) => this.sound.use(e.item, v));
      } else if (e.type === 'shield') {
        const c = this.world.cars.find((x) => x.id === e.carId);
        T.toWorld(c.s, c.d, 1, tmp); this.effects.puff(tmp.x, tmp.y, tmp.z);
        if (c === p) this.sound.shieldBlock();
      } else if (e.type === 'pickup') {
        const b = this.world.boxes[e.boxId];
        T.toWorld(b.s, b.d, 1.3, tmp); this.effects.sparkle(tmp.x, tmp.y, tmp.z);
        if (e.carId === p.id) { this.sound.pickup(); this.sound.roulette(); this.readyAt = performance.now() + 800; }
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
      let pitch = Math.atan2(sm.ty, Math.hypot(sm.tx, sm.tz));
      const gh = T.groundHeight(car.s);
      if (car.h <= gh + 0.05) pitch += Math.atan(T.groundSlope(car.s));                          // driving up a ramp
      else if (car.state === 'driving' && !car.hit.kind) pitch += Math.max(-0.35, Math.min(0.35, car.vy * 0.03));   // nose follows the flight
      v.root.rotation.set(pitch, -heading, 0, 'YXZ');
      const k = car.hit.kind;
      const p = k ? 1 - car.hit.t / CONFIG.car.HIT_TIME[k] : 0;
      v.body.rotation.z = car.steer * 0.07 + (k === 'bump' ? Math.sin(p * 30) * 0.08 : 0);
      v.body.rotation.y = k === 'spin' ? p * Math.PI * 4 : k === 'slip' ? Math.sin(car.t * 9) * 0.45 : 0;
      v.body.rotation.x = k === 'launch' ? -p * Math.PI * 2 : 0;
      v.body.position.y = k === 'bump' ? Math.abs(Math.sin(p * Math.PI * 3)) * 0.45 : 0;
      v.shield.visible = car.shieldT > 0 && (car.shieldT > 1 || Math.floor(car.t * 8) % 2 === 0);
      for (const w of v.wheels) w.rotation.x -= (car.speed * dt) / 0.4;
      let visible = car.state !== 'respawning';
      // flattened by the roller: squash to a thin pancake, stay a few seconds, then disappear
      if (car.state === 'eliminated') {
        const t = this.world.time - car.eliminatedAt, k = Math.min(1, t / CONFIG.roller.FLATTEN_TIME);
        v.root.scale.set(1 + 0.35 * k, 1 - 0.88 * k, 1 + 0.35 * k);
        visible = t < 3.5;
      } else if (v.root.scale.y !== 1) v.root.scale.set(1, 1, 1);
      if (car.invulnT > 0) visible = visible && Math.floor(car.t * 10) % 2 === 0;
      v.root.visible = visible;
      // blob shadow stays on the ground (below jumps), fades with height
      const groundY = this.tmpWorld.y - car.h + gh;
      v.blob.position.set(this.tmpWorld.x, groundY + 0.05, this.tmpWorld.z);
      v.blob.rotation.set(Math.atan2(sm.ty, Math.hypot(sm.tx, sm.tz)), -heading, 0, 'YXZ');
      v.blob.visible = this.qCfg.blobs && visible && car.state !== 'falling';
      v.blob.scale.setScalar(Math.max(0.5, 1 - Math.max(0, car.h - gh) * 0.12));
      if (dt > 0) this.emitCarParticles(car, v, dt, sm.curvature);
      if (v.label) v.label.visible = this.qCfg.labels && this.camera.position.distanceToSquared(v.root.position) < 55 * 55;   // far labels only clutter
      const cw = (this.carWorld[i] ||= {});
      cw.x = this.tmpWorld.x; cw.y = this.tmpWorld.y; cw.z = this.tmpWorld.z; cw.heading = heading;
    });
  }

  render(dt) {
    const t0 = performance.now();
    const w = this.world, player = w.player;
    this.updateViews(dt);

    let target = player;
    if (this.state === 'spectate' || (this.state === 'results')) {
      if (this.state === 'spectate') this.pickSpectate();
      target = w.cars.find((c) => c.id === this.specId) || player;
    }
    const cw = this.carWorld[w.cars.indexOf(target)];
    this.tmpPos.set(cw.x, cw.y, cw.z);
    if (player.wallHit) { if (target === player) { this.rig.shake(0.12); this.sound.bump(); } player.wallHit = false; }
    this.rig.update(dt, this.tmpPos, cw.heading, target.turboT > 0);

    this.handleEvents(target);
    this.entityViews.update(performance.now() / 1000, w);
    this.effects.update(dt);
    this.frameSounds(player, target);
    this.particles.update(dt, this.camera, this.renderer.domElement.height);
    this.hud.update({ car: player, cars: w.cars, length: this.track.finishS, roller: w.roller });
    if (this.state === 'spectate') this.hud.updateStandings(w.ranked, this.specId);
    this.updateRoller(dt, target, player);
    this.env.update(this.camera);
    const t1 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const t2 = performance.now();
    this.cpuMs += (t1 - t0 - this.cpuMs) * 0.05;           // JS work per frame (everything except issuing the draw calls)
    this.submitMs += (t2 - t1 - this.submitMs) * 0.05;     // time to issue the draw calls (CPU side)
  }
}
