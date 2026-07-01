// three.js — vanilla WebGPU starter (Vite bundler)
//
// A single lit, rotating cube with OrbitControls, on the WebGPURenderer path.
// Minimal and boring on purpose — copy this folder, `npm install && npm run dev`,
// and it renders. See README.md.
//
// Holds the skill's 7 invariants:
//   1. ESM only (no global THREE) — imports resolve through node_modules via Vite
//   2. BufferGeometry only (BoxGeometry already is one)
//   3. Explicit color management (outputColorSpace + tone mapping)
//   4. setAnimationLoop AND await renderer.init() — see the comment block below,
//      this is the invariant that's unique to the WebGPU path
//   5. Resize handling (camera aspect + projection matrix + renderer size)
//   6. Dispose on teardown (see dispose() at the bottom)
//   7. WebGPU forks materials/shaders: this template deliberately stays on
//      MeshStandardMaterial (confirmed to work under WebGPURenderer) rather than
//      guessing at a node-material constructor name. For custom shaders on this
//      path, use TSL nodes (import from 'three/tsl') — see
//      references/shaders-tsl.md — do NOT reach for ShaderMaterial/onBeforeCompile,
//      those are WebGL-only and silently no-op (or throw) under WebGPURenderer.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.querySelector('#app');

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // clamp retina cost
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; // invariant 3 (default since r152, explicit anyway)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// WHY `await renderer.init()` here:
// WebGLRenderer's context is created synchronously in its constructor, but
// WebGPURenderer requests the GPU adapter/device from the browser
// (navigator.gpu.requestAdapter() under the hood), which is an async handshake.
// Calling .render() before that resolves either no-ops or throws depending on
// version — the classic symptom is a silently black canvas with no console error.
// setAnimationLoop (below) already waits for init internally before invoking the
// callback, so it alone is sufficient for a looping demo like this one. We
// additionally await renderer.init() here so any init failure (e.g. no WebGPU/
// WebGL2 support at all) surfaces as a rejected promise we can see immediately,
// rather than a silent no-render. Both together is the documented, correct
// combination — see references/renderers-and-setup.md.
await renderer.init();

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
// MeshStandardMaterial works unchanged under WebGPURenderer (it's compiled to a
// node-material graph internally). For hand-authored node materials / TSL, see
// references/shaders-tsl.md rather than guessing exact export names here.
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
