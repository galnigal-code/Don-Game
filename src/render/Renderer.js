import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { baseFov } from './cameraMath.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

const HORIZON = 0xf0c590;

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4f9fe0');
  grad.addColorStop(0.45, '#9fcdf0');
  grad.addColorStop(0.62, '#f6d4a0');
  grad.addColorStop(1, '#f0a85e');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
  let ratioCap = CONFIG.render.MAX_PIXEL_RATIO;
  const applyRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratioCap));
  applyRatio();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(HORIZON, CONFIG.render.FOG_NEAR, CONFIG.render.FOG_FAR);

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, CONFIG.render.FOG_FAR + 120);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0xc9a36b, 1.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc88a, 2.4);
  sun.position.set(-50, 40, -84);   // low sun ahead-left: long warm light (matches the sun disc in Environment)
  scene.add(sun);

  /* Reflections: a physical sky is rendered once into a small cube map that the glossy car paint and glass reflect. */
  let envMap = null;
  const setReflections = (on) => {
    if (on && !envMap) {
      try {
        const sky = new Sky(); sky.scale.setScalar(10000);
        const u = sky.material.uniforms;
        u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.85;
        u.sunPosition.value.set(-50, 20, -84).normalize();
        const skyScene = new THREE.Scene(); skyScene.add(sky);
        const pm = new THREE.PMREMGenerator(renderer);
        envMap = pm.fromScene(skyScene, 0, 1, 20000).texture;
        pm.dispose(); sky.geometry.dispose(); sky.material.dispose();
      } catch { envMap = null; }                        // no reflections is fine
    }
    scene.environment = on ? envMap : null;
    scene.environmentIntensity = 0.28;
  };

  /* Real shadows (top tier only): the sun's shadow box follows the player. */
  sun.castShadow = false;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 160; sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
  const sunOffset = new THREE.Vector3(-50, 40, -84).normalize().multiplyScalar(70);
  scene.add(sun.target);
  const setShadows = (on) => {
    if (renderer.shadowMap.enabled !== on) { renderer.shadowMap.enabled = on; renderer.shadowMap.type = THREE.PCFShadowMap; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
    sun.castShadow = on;
    hemi.intensity = on ? 0.95 : 1.3; sun.intensity = on ? 3.2 : 2.4;   // less flat fill, more sun: shadows need contrast to be seen
  };
  const followShadow = (p) => {
    // snap to the shadow-texel grid so the shadows do not shimmer while the box moves
    const q = 44 / 1024;
    const x = Math.round(p.x / q) * q, y = Math.round(p.y / q) * q, z = Math.round(p.z / q) * q;
    sun.target.position.set(x, y, z); sun.position.set(x + sunOffset.x, y + sunOffset.y, z + sunOffset.z);
    sun.target.updateMatrixWorld();
  };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.userData.baseFov = baseFov(camera.aspect);
    camera.fov = camera.userData.baseFov;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /** Quality control: change the render resolution without touching anything else. */
  const setRatioCap = (cap) => { ratioCap = cap; applyRatio(); resize(); };
  return { renderer, scene, camera, sun, resize, setRatioCap, setReflections, setShadows, followShadow };
}
