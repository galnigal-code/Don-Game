import * as THREE from 'three';
import { CONFIG } from './config.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2 });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.MAX_PIXEL_RATIO));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2a65a);
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 800);
camera.position.set(0, 2.5, 7);
camera.lookAt(0, 0.3, 0);

scene.add(new THREE.HemisphereLight(0xbfe3ff, 0xc9a36b, 1.2));
const sun = new THREE.DirectionalLight(0xffd9a0, 2);
sun.position.set(5, 8, 4);
scene.add(sun);

const car = new THREE.Mesh(
  new THREE.BoxGeometry(2, 0.8, 4),
  new THREE.MeshStandardMaterial({ color: 0xd0201c, metalness: 0.3, roughness: 0.4 }),
);
scene.add(car);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

document.getElementById('ui').innerHTML = '<div id="version">Don Game · M0</div>';

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  car.rotation.y += dt * 0.8;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
