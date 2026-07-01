// raycaster-picker.js
//
// Pointer -> NDC -> Raycaster.setFromCamera -> intersectObjects picker, wired to pointermove
// (hover) and click (select). Renderer-agnostic: Raycaster and pointer math live in three core
// and behave identically on WebGL and WebGPU.

import * as THREE from 'three';

// --- assumes renderer, scene, camera, and pickableObjects already exist ---
// const pickableObjects = [mesh1, mesh2, ...]; // the specific list to test — see perf notes below

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
let selected = null;

/**
 * Convert a pointer event to normalized device coordinates (NDC): both axes in [-1, 1], origin
 * at screen center, +Y UP. This is the one line everyone gets backwards — DOM/screen coordinates
 * are Y-down, NDC is Y-up, so the Y term needs an explicit negation.
 */
function updatePointerNDC(event, canvas) {
  const rect = canvas.getBoundingClientRect(); // use the canvas's own rect, not window.innerWidth/Height —
  // otherwise picking drifts as soon as the canvas is offset or resized by CSS
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; // note the negation
}

/**
 * Cast a ray from the camera through the current pointer position and return the nearest hit.
 */
function pickAtPointer() {
  raycaster.setFromCamera(pointer, camera); // builds the ray from camera + NDC pointer in one call;
  // handles PerspectiveCamera and OrthographicCamera correctly — prefer this over hand-rolled unprojection

  // `true` = recursive: walk each candidate's descendants too. Needed for loaded GLTF scenes,
  // which are typically a Group wrapping many Mesh children — the Group itself has no geometry
  // to hit. Pass `false` only when every candidate in the list is itself a direct, geometry-bearing
  // object (skipping the descendant walk is cheaper).
  const hits = raycaster.intersectObjects(pickableObjects, true);
  return hits[0] ?? null; // intersectObjects returns hits sorted nearest-first; [0] is the closest
}

// --- perf notes ---
//
// - Raycasting is O(triangles) per candidate object (after a cheap bounding-sphere/box reject).
//   Testing hundreds of high-poly meshes on every single pointermove is a common frame-time sink.
// - Throttle pointermove picking (rAF-gated below) rather than raycasting synchronously inside
//   the DOM event handler — pointer events can fire faster than your render loop on
//   high-poll-rate mice/trackpads.
// - Pass the specific `pickableObjects` array, not `scene.children` — avoids wasting cycles on
//   lights/helpers/gizmos and avoids accidentally making them clickable.
// - For scenes with tens of thousands of triangles where raycasting itself is the bottleneck
//   (confirm via profiling first), the community library three-mesh-bvh patches Mesh.raycast to
//   use a bounding-volume hierarchy — not part of three core, see references/performance.md.

let hoverPending = false;

function onPointerMove(event) {
  updatePointerNDC(event, renderer.domElement);
  if (hoverPending) return; // rAF-gate: coalesce bursts of pointermove into at most one raycast per frame
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const hit = pickAtPointer();
    const hitObject = hit?.object ?? null;
    if (hitObject === hovered) return; // no change, skip redundant highlight churn
    if (hovered) hovered.material.emissive?.setHex(0x000000); // clear previous hover highlight
    hovered = hitObject;
    if (hovered) hovered.material.emissive?.setHex(0x222222); // apply new hover highlight
  });
}

function onClick(event) {
  // click doesn't need rAF-gating — it's already a discrete, low-frequency event.
  updatePointerNDC(event, renderer.domElement);
  const hit = pickAtPointer();

  if (selected) selected.material.emissive?.setHex(0x000000); // clear previous selection highlight
  selected = hit?.object ?? null;
  if (selected) selected.material.emissive?.setHex(0x555500); // apply new selection highlight

  // hit.point (Vector3, world-space), hit.distance, hit.face, hit.uv, hit.instanceId (for
  // InstancedMesh) are also available on `hit` — see references/interaction.md for the full
  // intersection-result shape.
}

// Prefer pointer events (pointermove/pointerdown/pointerup) over mouse events — they unify
// mouse/touch/pen and are what OrbitControls/TransformControls use internally, so behavior stays
// consistent if this picker coexists with those controls on the same canvas.
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('click', onClick);

// --- teardown ---
function disposePicker() {
  renderer.domElement.removeEventListener('pointermove', onPointerMove);
  renderer.domElement.removeEventListener('click', onClick);
}

export { pickAtPointer, disposePicker };
