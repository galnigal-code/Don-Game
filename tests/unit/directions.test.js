// THE DIRECTION CONTRACT (everything that has a left/right/forward). If any of these fails, the game is reversed somewhere.
//   +steer = right, +d = right of the road = right side of the SCREEN, right turn = road bends to the right on screen,
//   the car's nose points forward (-z), keyboard/touch right = +steer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../../src/config.js';
import { createTrack } from '../../src/sim/TrackModel.js';
import { createCar, stepCar } from '../../src/sim/Car.js';
import { CameraRig } from '../../src/render/CameraRig.js';
import { TRACK_PATH } from '../../src/sim/trackData.js';
import { KeyboardInput } from '../../src/input/KeyboardInput.js';
import { TouchSteerTemp } from '../../src/input/TouchSteerTemp.js';

const track = createTrack();
const DT = CONFIG.sim.STEP;

/** Where a world point appears on screen, using the REAL chase-camera code. NDC x > 0 = right half of the screen. */
function screenX(carS, carD, point) {
  const cam = new THREE.PerspectiveCamera(65, 844 / 390, 0.1, 800);
  const rig = new CameraRig(cam);
  const sm = track.sample(carS), w = track.toWorld(carS, carD, 0);
  rig.update(1, new THREE.Vector3(w.x, w.y, w.z), sm.heading, false);
  cam.updateMatrixWorld(true);
  const p = track.toWorld(point.s, point.d, 0);
  return new THREE.Vector3(p.x, p.y + 0.5, p.z).project(cam).x;
}

describe('road geometry', () => {
  it('the first long turn in the track data is a RIGHT turn and the road really bends to +x (screen right at the start)', () => {
    const firstTurn = TRACK_PATH.find(([, deg]) => deg !== 0);
    expect(firstTurn[1]).toBeGreaterThan(0);
    const a = track.sample(0), b = track.sample(350);
    expect(a.tz).toBeLessThan(-0.99);                               // starts facing -z
    expect(b.heading).toBeGreaterThan(a.heading + 0.5);              // heading grows on a right turn
    expect(b.px - a.px).toBeGreaterThan(30);                         // and the road moved to +x (the viewer's right)
    expect(b.curvature).toBeGreaterThan(0);                          // positive curvature = right turn
  });
  it('a left turn has negative curvature and bends to -x', () => {
    const left = track.samples.find((s) => s.curvature < -0.008);
    expect(left).toBeTruthy();
    const ahead = track.sample(left.s + 40);
    expect(ahead.heading).toBeLessThan(left.heading);
  });
  it('+d is to the right of the direction of travel on every sample', () => {
    for (let s = 0; s < track.finishS; s += 17) {
      const p = track.sample(s);
      const cross = p.tx * p.rz - p.tz * p.rx;                     // y component of forward x right, for a viewer looking down
      expect(cross, `s=${s}`).toBeGreaterThan(0.9);
    }
  });
});

describe('what the player sees', () => {
  it('+d (right of the road) is on the right half of the screen and -d on the left, everywhere on the track', () => {
    for (let s = 40; s < track.finishS - 40; s += 53) {
      expect(screenX(s, 0, { s: s + 25, d: 4 }), `right @${s}`).toBeGreaterThan(screenX(s, 0, { s: s + 25, d: -4 }));
      expect(screenX(s, 0, { s: s + 25, d: 4 }), `right is right @${s}`).toBeGreaterThan(0);
      expect(screenX(s, 0, { s: s + 25, d: -4 }), `left is left @${s}`).toBeLessThan(0);
    }
  });
  it('a car that has moved to +d shows up to the right of one at the centre', () => {
    for (const s of [100, 700, 1500, 2300]) expect(screenX(s - 30, 0, { s, d: 5 })).toBeGreaterThan(screenX(s - 30, 0, { s, d: 0 }));
  });
  it('the road ahead of a right turn bends to the RIGHT on screen', () => {
    const s0 = 180;                                                // just before the first right turn
    expect(screenX(s0, 0, { s: s0 + 120, d: 0 })).toBeGreaterThan(screenX(s0, 0, { s: s0 + 20, d: 0 }));
  });
});

describe('steering input', () => {
  it('positive steer moves the car to +d (right), negative to -d (left)', () => {
    for (const [steer, sign] of [[0.6, 1], [-0.6, -1]]) {
      const car = createCar({ s: 0 });
      for (let i = 0; i < 60 * 3; i++) { car.input.steer = i < 120 ? 0 : steer; stepCar(car, DT, track); }
      expect(Math.sign(car.d - 0), `steer ${steer}`).toBe(sign);
      expect(Math.abs(car.d)).toBeGreaterThan(1);
    }
  });
  it('positive steer also turns the car body to the right (yaw > 0 is nose to the right of the road direction)', () => {
    const car = createCar({ s: 0 });
    for (let i = 0; i < 90; i++) { car.input.steer = i < 60 ? 0 : 1; stepCar(car, DT, track); }
    expect(car.yaw).toBeGreaterThan(0.1);
  });
});

describe('keyboard and touch', () => {
  const handlers = {};
  let saved;
  beforeEach(() => { saved = { add: globalThis.addEventListener, w: globalThis.innerWidth }; globalThis.addEventListener = (t, f) => { handlers[t] = f; }; globalThis.innerWidth = 800; });
  afterEach(() => { globalThis.addEventListener = saved.add; globalThis.innerWidth = saved.w; });
  it('ArrowRight / D steer right, ArrowLeft / A steer left', () => {
    for (const [code, sign] of [['ArrowRight', 1], ['KeyD', 1], ['ArrowLeft', -1], ['KeyA', -1]]) {
      const k = new KeyboardInput();
      handlers.keydown({ code, repeat: false, preventDefault() {} });
      let s = 0; for (let i = 0; i < 20; i++) s = k.update(0.05);
      expect(Math.sign(s), code).toBe(sign);
    }
  });
  it('touching the right half of the screen steers right and the left half steers left', () => {
    const el = { listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, setPointerCapture() {} };
    const t = new TouchSteerTemp(el);
    el.listeners.pointerdown({ pointerId: 1, clientX: 700 }); expect(t.steer).toBe(1);
    el.listeners.pointerup({ pointerId: 1 });
    el.listeners.pointerdown({ pointerId: 2, clientX: 100 }); expect(t.steer).toBe(-1);
  });
});
