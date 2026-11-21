import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createTrack } from '../sim/TrackModel.js';
import { createWorld } from '../sim/World.js';
import { driveSimple } from '../sim/BotDriver.js';
import { createRenderer } from '../render/Renderer.js';
import { buildTrackMesh } from '../render/TrackMesh.js';
import { createCarModel } from '../render/CarModel.js';
import { CameraRig } from '../render/CameraRig.js';
import { KeyboardInput } from '../input/KeyboardInput.js';
import { TouchSteerTemp } from '../input/TouchSteerTemp.js';
import { createHud } from '../ui/hud.js';
import { createDebugOverlay } from '../debug/DebugOverlay.js';

const STEP = CONFIG.sim.STEP;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Game {
  constructor(canvas, uiRoot, params) {
    this.params = params;
    this.autopilot = params.has('autopilot');
    this.fast = Math.max(1, Number(params.get('fast')) || 1);
    this.seed = Number(params.get('seed')) || 1;

    const r = createRenderer(canvas);
    this.renderer = r.renderer; this.scene = r.scene; this.camera = r.camera;
    this.track = createTrack();
    this.scene.add(buildTrackMesh(this.track));
    this.rig = new CameraRig(this.camera);

    this.keyboard = new KeyboardInput();
    this.keyboard.onRestart = () => this.newRace();
    this.touch = new TouchSteerTemp(canvas);
    this.hud = createHud(uiRoot, { onRestart: () => this.newRace() });
    this.debug = params.has('debug') ? createDebugOverlay(uiRoot, this.renderer) : null;

    this.tmpPos = new THREE.Vector3();
    this.tmpWorld = {}; this.tmpSample = {};
    this.views = [];
    this.newRace();

    this.acc = 0; this.last = performance.now(); this.paused = false;
    document.addEventListener('visibilitychange', () => { this.paused = document.hidden; this.last = performance.now(); });
    this.frame = this.frame.bind(this);
  }

  newRace() {
    for (const v of this.views) this.scene.remove(v.root);
    this.world = createWorld({ track: this.track, seed: this.seed });
    this.views = this.world.cars.map((car) => {
      const v = createCarModel(car.color); this.scene.add(v.root); return v;
    });
    this.resultShown = false;
    this.hud.reset();
    this.rig.reset();
    this.updateViews(0);
  }

  start() { requestAnimationFrame(this.frame); }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    if (!this.paused) {
      this.acc += dt * this.fast;
      let n = 0;
      while (this.acc >= STEP && n++ < 5 * this.fast) { this.simStep(); this.acc -= STEP; }
      if (this.acc > STEP) this.acc = 0;
    }
    this.render(dt);
    this.debug?.frame(dt, this);
  }

  simStep() {
    const w = this.world, car = w.player;
    if (this.autopilot) driveSimple(car, this.track);
    else {
      car.input.steer = clamp(this.keyboard.update(STEP) + this.touch.steer, -1, 1);
      car.input.turbo = this.keyboard.turbo || this.hud.turboHeld || this.hud.consumePulse();
    }
    w.step(STEP);
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
      v.body.rotation.z = car.steer * 0.07;
      for (const w of v.wheels) w.rotation.x -= (car.speed * dt) / 0.4;
      let visible = car.state !== 'respawning';
      if (car.invulnT > 0) visible = visible && Math.floor(car.t * 10) % 2 === 0;
      v.root.visible = visible;
      if (car.isPlayer) { this.playerWorld = this.tmpWorld; this.playerHeading = heading; }
    });
  }

  render(dt) {
    const car = this.world.player;
    this.updateViews(dt);
    this.tmpPos.set(this.playerWorld.x, this.playerWorld.y, this.playerWorld.z);
    if (car.wallHit) { this.rig.shake(0.12); car.wallHit = false; }
    this.rig.update(dt, this.tmpPos, this.playerHeading, car.turboT > 0);
    const time = car.finishTime ?? this.world.time;
    this.hud.update({ time, car, length: this.track.finishS });
    if (car.state === 'finished' && !this.resultShown) { this.resultShown = true; this.hud.showResult(car.finishTime); }
    this.renderer.render(this.scene, this.camera);
  }
}
