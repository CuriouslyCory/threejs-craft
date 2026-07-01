// three.js — vanilla WebGL starter (Vite bundler)
//
// A single lit, rotating cube with OrbitControls. Minimal and boring on purpose —
// copy this folder, `npm install && npm run dev`, and it renders. See README.md.
//
// Holds the skill's 7 invariants:
//   1. ESM only (no global THREE) — imports resolve through node_modules via Vite
//   2. BufferGeometry only (BoxGeometry already is one)
//   3. Explicit color management (outputColorSpace + tone mapping)
//   4. setAnimationLoop (not raw requestAnimationFrame)
//   5. Resize handling (camera aspect + projection matrix + renderer size)
//   6. Dispose on teardown (see dispose() at the bottom)
//   7. N/A here — this is the WebGL path, no ShaderMaterial/onBeforeCompile used

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.querySelector('#app');

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // clamp retina cost
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; // invariant 3 (default since r152, explicit anyway)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// --- Scene & camera ---------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d23);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(2.5, 2, 3.5);

// --- Controls ---------------------------------------------------------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

// --- Lights -------------------------------------------------------------
const keyLight = new THREE.DirectionalLight(0xffffff, 3);
keyLight.position.set(3, 4, 2);
scene.add(keyLight);

const ambient = new THREE.AmbientLight(0x404050, 1.5);
scene.add(ambient);

// --- Geometry / material -----------------------------------------------------
const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
const material = new THREE.MeshStandardMaterial({
  color: 0x4f83ff,
  roughness: 0.4,
  metalness: 0.1,
});
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// --- Resize (invariant 5) ----------------------------------------------------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// --- Render loop (invariant 4) ------------------------------------------------
renderer.setAnimationLoop(() => {
  cube.rotation.x += 0.006;
  cube.rotation.y += 0.009;
  controls.update();
  renderer.render(scene, camera);
});

// --- Teardown / dispose (invariant 6) -----------------------------------------
// Not called automatically in this always-on demo — this is the hook you'd wire
// to page unload / SPA unmount (e.g. Vite HMR dispose) in a real app. Demonstrated
// here so the pattern is copy-pasteable.
function dispose() {
  renderer.setAnimationLoop(null);
  window.removeEventListener('resize', onResize);
  controls.dispose();
  geometry.dispose();
  material.dispose();
  renderer.dispose();
}

window.addEventListener('beforeunload', dispose);

// Vite HMR: dispose the old scene before the module is replaced so dev-server
// edits don't leak GPU resources across hot reloads.
if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
