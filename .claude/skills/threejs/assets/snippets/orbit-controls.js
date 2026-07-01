// orbit-controls.js
//
// Canonical OrbitControls setup: orbit-around-a-target camera control via pointer drag
// (rotate), wheel/pinch (dolly), and right-drag or two-finger drag (pan). The default choice
// for "let the user look around a model" (product viewers, model inspectors, general scene
// exploration). Renderer-agnostic — works identically with WebGLRenderer and WebGPURenderer.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- assumes camera and renderer already exist ---
// const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
// const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

const controls = new OrbitControls(camera, renderer.domElement);

// --- damping (inertia) ---
//
// enableDamping makes orbit/pan/zoom ease out instead of stopping instantly on pointer release —
// reads as much more polished. The tradeoff: damping only applies its next interpolation step
// inside controls.update(), so IT MUST BE CALLED EVERY FRAME once damping is on, not just after
// user input. Forgetting this is the most common OrbitControls bug: input appears to "not work"
// or only partially apply, because the eased motion never gets a chance to advance.
controls.enableDamping = true;
controls.dampingFactor = 0.05; // higher = snappier/less inertia, lower = floatier

// --- target ---
//
// The point the camera orbits around and looks at — set this to your subject's center, not the
// world origin, if your model isn't centered at (0,0,0).
controls.target.set(0, 0, 0);

// --- distance clamps (dolly/zoom limits) ---
controls.minDistance = 2; // closest the camera can dolly in
controls.maxDistance = 20; // farthest the camera can dolly out

// --- polar angle clamps (vertical orbit limits) ---
//
// Polar angle is measured from the +Y axis: 0 = looking straight down from directly above,
// Math.PI = looking straight up from directly below. Clamping this is the standard way to stop
// a user from flipping the camera under the floor or over the top of a product-viewer subject —
// prefer this over manually clamping camera position.
controls.minPolarAngle = 0; // radians
controls.maxPolarAngle = Math.PI; // radians — tighten e.g. to Math.PI * 0.9 to keep the camera from going fully underneath

controls.enablePan = true; // set false to lock panning (e.g. keep a product viewer subject centered)

controls.update(); // required once after setting target/position/clamps, before the first render

// --- render loop ---
renderer.setAnimationLoop(() => {
  controls.update(); // required every frame when enableDamping (or autoRotate) is true — see note above
  renderer.render(scene, camera);
});

// --- teardown ---
//
// dispose() removes the pointer/wheel event listeners OrbitControls attached to
// renderer.domElement. Skipping this on unmount/remount leaks listeners onto a detached canvas
// (invariant 6) — a classic source of "controls from the old scene are still firing" bugs in
// hot-reload or SPA route-change scenarios.
function disposeControls() {
  controls.dispose();
}

export { controls, disposeControls };
