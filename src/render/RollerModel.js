import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const RADIUS = 2.6;

function steelTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8d939b'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 1800; i++) { const v = 110 + Math.random() * 60; g.fillStyle = `rgba(${v},${v},${v + 6},0.35)`; g.fillRect(Math.random() * 512, Math.random() * 256, 3, 2); }
  g.strokeStyle = 'rgba(40,44,50,.75)'; g.lineWidth = 3;
  for (let i = 0; i <= 12; i++) { g.beginPath(); g.moveTo(i * (512 / 12), 0); g.lineTo(i * (512 / 12), 256); g.stroke(); }   // panel seams around the drum
  g.fillStyle = 'rgba(30,32,36,.9)';
  for (let i = 0; i < 12; i++) for (const y of [40, 128, 216]) { g.beginPath(); g.arc(i * (512 / 12) + 12, y, 4, 0, 7); g.fill(); }  // rivets
  const stripe = (y0, y1) => { for (let x = -256; x < 768; x += 48) { g.fillStyle = '#f2a900'; g.beginPath(); g.moveTo(x, y1); g.lineTo(x + 24, y1); g.lineTo(x + 24 + (y1 - y0), y0); g.lineTo(x + (y1 - y0), y0); g.closePath(); g.fill(); } };
  g.save(); g.beginPath(); g.rect(0, 0, 512, 30); g.rect(0, 226, 512, 30); g.clip(); g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 512, 256); stripe(0, 30); stripe(226, 256); g.restore();   // hazard bands at both ends
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const bake = (geo, color, x, y, z) => {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.translate(x, y, z);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3), c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
};

/**
 * The giant road roller: a steel drum across the whole road and a yellow frame with a cab and a smoking chimney.
 * Few meshes (drum, 2 arms, body, lights, shadow). update() fits the drum to the road width.
 */
export function createRollerModel() {
  const root = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, 1, 28).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ map: steelTexture() }));
  drum.position.y = RADIUS;
  root.add(drum);

  const YELLOW = 0xf2b400, DARK = 0x222428, GLASS = 0x2b3a48;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const armGeo = bake(new THREE.BoxGeometry(0.6, 1.2, 6.5), YELLOW, 0, 0, 0);
  const armL = new THREE.Mesh(armGeo, mat), armR = new THREE.Mesh(armGeo, mat);
  armL.position.set(-9, RADIUS + 0.5, 3.3); armR.position.set(9, RADIUS + 0.5, 3.3);
  root.add(armL, armR);

  const bodyParts = [
    bake(new THREE.BoxGeometry(5.6, 2.2, 6.5), YELLOW, 0, RADIUS + 1.1, 5.2),               // engine / chassis
    bake(new THREE.BoxGeometry(4.2, 0.35, 5.2), DARK, 0, RADIUS + 2.4, 5.2),               // deck
    bake(new THREE.BoxGeometry(3.6, 2.8, 3.2), YELLOW, 0, RADIUS + 3.9, 4.4),              // cab
    bake(new THREE.BoxGeometry(3.7, 1.3, 3.3), GLASS, 0, RADIUS + 4.2, 4.4),               // windows
    bake(new THREE.BoxGeometry(4.2, 0.3, 3.8), DARK, 0, RADIUS + 5.45, 4.4),               // roof
    bake(new THREE.CylinderGeometry(0.28, 0.34, 3.2, 10), DARK, 1.6, RADIUS + 4.4, 6.8),    // chimney
    bake(new THREE.BoxGeometry(5.8, 0.5, 0.6), DARK, 0, RADIUS + 0.4, 8.6),                // rear bumper
  ];
  const body = new THREE.Mesh(mergeGeometries(bodyParts), mat);
  root.add(body);

  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const lamps = new THREE.Mesh(mergeGeometries([
    bake(new THREE.BoxGeometry(0.7, 0.45, 0.2), 0xfff2c0, -1.3, RADIUS + 3.6, 2.75),
    bake(new THREE.BoxGeometry(0.7, 0.45, 0.2), 0xfff2c0, 1.3, RADIUS + 3.6, 2.75),
    bake(new THREE.BoxGeometry(0.8, 0.3, 0.2), 0xff2a2a, 0, RADIUS + 2.0, 8.75),
  ]), lampMat);
  root.add(lamps);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false }));
  beacon.position.set(0, RADIUS + 5.9, 4.4); root.add(beacon);

  // big soft shadow
  const sc = document.createElement('canvas'); sc.width = sc.height = 64;
  const g = sc.getContext('2d'); const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 16), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.06, 3);
  root.add(shadow);

  root.visible = false;
  const chimney = new THREE.Vector3(1.6, RADIUS + 6.1, 6.8);

  return {
    root, drum, chimney,
    /** Fit to the road (width in metres) and roll the drum (speed in m/s). */
    update(width, speed, dt, time) {
      drum.scale.x = width;
      armL.position.x = -(width / 2 + 0.3); armR.position.x = width / 2 + 0.3;
      shadow.scale.x = width + 6;
      drum.rotation.x -= (speed * dt) / RADIUS;
      beacon.visible = Math.floor(time * 4) % 2 === 0;
    },
  };
}
