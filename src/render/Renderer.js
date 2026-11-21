import * as THREE from 'three';
import { CONFIG } from '../config.js';

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(HORIZON, CONFIG.render.FOG_NEAR, CONFIG.render.FOG_FAR);

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 800);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xc9a36b, 1.3));
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
  sun.position.set(-60, 80, 40);
  scene.add(sun);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, sun, resize };
}
