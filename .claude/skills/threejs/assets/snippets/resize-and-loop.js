// resize-and-loop.js
//
// Canonical resize handler + render loop for a vanilla three.js (WebGL or WebGPU) scene.
// Paste-ready: assumes `renderer`, `scene`, and `camera` already exist (see
// references/renderers-and-setup.md for full renderer setup). Swap the `three` import for
// `three/webgpu` if you're on the WebGPU path — this file's logic is identical either way.
//
// Holds invariants 4, 5, and 6 from SKILL.md:
//   4. setAnimationLoop, not raw requestAnimationFrame
//   5. handle resize (aspect + updateProjectionMatrix + setSize + clamped pixel ratio)
//   6. dispose on teardown

import * as THREE from 'three';

// --- assume these already exist from your renderer/scene setup ---
// const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// const scene = new THREE.Scene();
// const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);

/**
 * Resize handler: keeps the camera's projection and the renderer's drawing buffer in sync
 * with the canvas's display size. Call once at startup and again on every 'resize'.
 */
function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Perspective-camera-only: aspect must match the new viewport, or the image stretches/squashes.
  camera.aspect = width / height;
  camera.updateProjectionMatrix(); // required after touching aspect/fov/near/far — matrices aren't recomputed automatically

  renderer.setSize(width, height); // also writes canvas CSS width/height (updateStyle=true by default);
  // pass `renderer.setSize(width, height, false)` instead if a parent container already sizes
  // the canvas via CSS and you don't want three.js fighting that layout.

  // Clamp pixel ratio: retina/4K displays report devicePixelRatio 2-3+, and rendering at full
  // device resolution on a 3x display is ~9x the fragment work of 1x for no perceptible gain
  // past ~2x. Re-clamp on resize too, in case the window moved to a different-DPI monitor.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

window.addEventListener('resize', onResize);
onResize(); // run once immediately so sizing is correct before the first frame

// --- render loop ---
//
// Use renderer.setAnimationLoop(fn), never a hand-rolled requestAnimationFrame loop (invariant 4):
//   - WebGPURenderer initializes its device asynchronously (navigator.gpu.requestAdapter()).
//     setAnimationLoop internally waits for that handshake before invoking your callback, so you
//     never race it. A raw rAF loop can call .render() before init resolves -> silent black canvas.
//   - WebXR frame timing comes from the headset, not the browser's rAF; setAnimationLoop is the
//     only API that receives correct XRFrame timing when an XR session is active.
// Using it unconditionally means the same loop code works for WebGL, WebGPU, and XR without a fork.

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta(); // seconds since the previous frame — use for frame-rate-independent motion
  // const elapsed = clock.getElapsedTime(); // total seconds since the clock started, if you need absolute time

  // controls?.update(delta); // if using OrbitControls with damping, or any per-frame animation system
  // mixer?.update(delta);    // AnimationMixer, if playing clips

  renderer.render(scene, camera);
});

/**
 * Teardown: call this on unmount / page navigation / hot-reload to release GPU resources and
 * event listeners (invariant 6). A remount without this is a classic leak.
 */
function dispose() {
  renderer.setAnimationLoop(null); // stop the loop before tearing anything else down
  window.removeEventListener('resize', onResize);
  renderer.dispose(); // releases the WebGL/WebGPU context's GPU resources
  // Also dispose anything you created: geometries, materials, textures, controls, render targets.
  // renderer.dispose() only releases the renderer/context itself, not scene content.
}

export { onResize, dispose };
