# Interaction — raycasting, pointer picking, HTML alignment, TransformControls

Renderer-agnostic: `Raycaster` and pointer math live in `three` core and behave identically on
WebGL and WebGPU. `TransformControls` is an addon (`three/addons/controls/TransformControls.js`)
that also works with either renderer.

## Pointer → NDC math

Raycasting needs the pointer in **normalized device coordinates** (NDC): both axes in
`[-1, 1]`, origin at screen center, +Y **up** (opposite of typical screen/DOM Y-down
coordinates — this flip is the one line people get backwards).

```js
function updatePointerNDC(event, pointer, canvas) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; // note the negation
}
```

Use `getBoundingClientRect()` rather than `window.innerWidth/Height` unless the canvas is
guaranteed full-viewport — otherwise picking drifts as soon as the canvas is offset or resized
by CSS.

## Raycaster basics

```js
import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerMove(event) {
  updatePointerNDC(event, pointer, renderer.domElement);
}

function pickAtPointer() {
  raycaster.setFromCamera(pointer, camera); // builds ray from camera + NDC pointer in one call
  const hits = raycaster.intersectObjects(pickableObjects, true); // true = recurse into children
  return hits[0] ?? null; // sorted nearest-first; [0] is the closest hit
}
```

- **`setFromCamera(ndcVector2, camera)`** — replaces manually building an `Vector3().unproject()`
  ray; handles both `PerspectiveCamera` and `OrthographicCamera` correctly. Prefer it over
  hand-rolled unprojection.
- **`intersectObjects(objects, recursive)`** — pass the **specific list** you want tested, not
  `scene.children` broadly, unless you actually want to hit everything (lights/helpers/gizmos
  included). `recursive: true` walks each object's descendants (needed for loaded GLTF scenes,
  which are typically a `Group` wrapping many `Mesh` children) — pass `false` only when you
  know every candidate is a direct, geometry-bearing object.
- **`intersectObject(object, recursive)`** — singular form, same semantics, for testing one
  known object/subtree.

## Reading an intersection result

Each entry in the returned array:

```js
const hit = hits[0];
hit.distance;  // ray-origin to hit-point distance, in world units — sort key, also useful for "closest" logic
hit.point;     // Vector3, world-space hit position
hit.object;    // the Mesh/Object3D actually hit — may be a deep child if recursive:true
hit.face;      // { a, b, c, normal } vertex indices + face normal (object space), or null for non-indexed/points/lines edge cases
hit.faceIndex; // index into geometry's face list
hit.uv;        // Vector2 UV at the hit point, if geometry has a uv attribute — undefined otherwise
hit.instanceId; // set when hit.object is an InstancedMesh — which instance was hit
```

`hit.object` is the leaf that owns the geometry — if you raycast a loaded character and want
"which top-level entity did I click," walk up with `hit.object.traverseAncestors(...)` or stash
an entity reference in `userData` on the root and read it off `hit.object` via a known
convention (e.g. always tag the root, then `hit.object.userData.entityRoot` or walk `.parent`
until found).

## Performance notes

- **Raycasting is O(triangles)** per object by default — `Raycaster` tests every triangle in a
  mesh's geometry unless the geometry has a `boundingSphere`/`boundingBox` precheck (three.js
  does this automatically as a cheap first-pass reject, but the full per-triangle test still
  runs for anything the bounding volume doesn't reject). Testing against hundreds of
  high-poly meshes every `pointermove` is a common frame-time sink.
- **Throttle pointermove picking** — hover highlighting doesn't need to raycast on every mouse
  event; debounce/rAF-gate it (see Pointer event wiring below) rather than raycasting
  synchronously in the DOM event handler.
- **Narrow the candidate list.** Maintain an explicit `pickableObjects` array instead of
  raycasting `scene.children` — skip lights, helpers, gizmos, and anything visually
  non-interactive.
- **`object.layers`** — use a dedicated layer for pickable objects and set
  `raycaster.layers.set(n)` to match, so the raycaster skips non-matching objects at the
  broadphase without you maintaining a separate array. See `references/core-scenegraph.md` for
  the `Layers` bitmask API; verify exact method names with `scripts/docs_lookup.mjs Layers`.
- **BVH acceleration for large static scenes** — for scenes with tens of thousands of triangles
  where per-frame raycasting becomes the bottleneck, the community library
  **three-mesh-bvh** builds a bounding-volume hierarchy per geometry and patches
  `Mesh.raycast` to use it, plus exposes a `firstHitOnly` mode on the raycaster that stops at
  the first accepted hit instead of collecting and sorting all of them — large win when you
  only need "did I hit anything," not the full sorted list. Not part of three core; add it only
  once profiling shows raycasting is actually the bottleneck (`references/performance.md`).

## Pointer event wiring

```js
const canvas = renderer.domElement;
let hoverPending = false;

canvas.addEventListener('pointermove', (event) => {
  updatePointerNDC(event, pointer, canvas);
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const hit = pickAtPointer();
    updateHoverState(hit);
  });
});

canvas.addEventListener('click', (event) => {
  updatePointerNDC(event, pointer, canvas);
  const hit = pickAtPointer();
  if (hit) handleSelect(hit.object);
});
```

- Prefer **`pointermove`/`pointerdown`/`pointerup`** over `mousemove`/`mousedown`/`mouseup` —
  pointer events unify mouse/touch/pen and are what OrbitControls/TransformControls use
  internally.
- rAF-gate `pointermove` picking (shown above) rather than raycasting on every DOM event —
  pointer events can fire far faster than the render loop on high-poll-rate mice/trackpads.
- `click` doesn't need the same throttling — it's already a discrete, low-frequency event.

## HTML ↔ 3D alignment

To position an HTML overlay (a tooltip, a label) at a 3D world point, project it to screen
space with `Vector3.project(camera)`:

```js
function worldToScreen(worldPos, camera, canvas) {
  const ndc = worldPos.clone().project(camera); // mutates a clone, not the original vector
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + ((ndc.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - ndc.y) / 2) * rect.height, // note the flip back to screen-Y-down
    visible: ndc.z < 1, // z > 1 means behind the camera / beyond far plane
  };
}
```

Call this every frame the camera or the tracked object can move (it's cheap — one matrix
multiply) and write the result to the overlay element's `style.transform`, not `left`/`top`
(avoids layout thrash). `Vector3.unproject(camera)` is the inverse — screen/NDC point back to
world space — useful for "place an object where the user clicked on a ground plane" type
interactions combined with a raycast against that plane.

In **React Three Fiber**, drei's `<Html>` component wraps this exact projection + a
`MutationObserver`/rAF sync loop for you — reach for it instead of hand-rolling the above in an
r3f app. See `references/react-three-fiber.md`.

## TransformControls (gizmo)

An addon (`three/addons/controls/TransformControls.js`) that renders a draggable
translate/rotate/scale gizmo attached to an object, and writes drag deltas straight into that
object's transform.

```js
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const orbit = new OrbitControls(camera, renderer.domElement);
const transform = new TransformControls(camera, renderer.domElement);
transform.attach(selectedMesh); // start controlling this object
scene.add(transform.getHelper()); // r160+: gizmo is added via a helper object, not the controls instance itself

transform.setMode('translate'); // 'translate' | 'rotate' | 'scale'

// The classic footgun: dragging the gizmo also drags the camera via OrbitControls underneath
// it, because both listen to the same pointer events. Disable orbit while actively dragging.
transform.addEventListener('dragging-changed', (event) => {
  orbit.enabled = !event.value;
});
```

- **`attach(object)` / `detach()`** — bind/unbind the gizmo to a target; `detach()` (or
  `transform.attach(null)` depending on version — verify with
  `scripts/docs_lookup.mjs TransformControls`) when nothing is selected, so the gizmo
  disappears rather than lingering on the last object.
- **`setMode('translate' | 'rotate' | 'scale')`** — switch gizmo type; common to bind to
  keyboard shortcuts (`w`/`e`/`r`) matching Blender/Maya conventions for a familiar editor feel.
- **The `dragging-changed` → disable-OrbitControls pattern is mandatory** whenever both
  controls share a canvas — without it, dragging a gizmo handle simultaneously orbits the
  camera underneath your cursor, which reads as the gizmo being broken/jittery. This is the
  single most common TransformControls bug report.
- **`getHelper()`** — recent three.js versions split the gizmo's actual scene-graph
  representation from the `TransformControls` controller instance (which itself is not an
  `Object3D` and isn't meant to be added to the scene). Add `transform.getHelper()` to the
  scene; older code that did `scene.add(transform)` directly targets a pre-split version — check
  the installed version's shape with `scripts/docs_lookup.mjs TransformControls` if unsure.
- **Dispose** — `transform.dispose()` on teardown, mirroring `orbit.dispose()` (invariant 6);
  also remove the `dragging-changed` listener if you added it as a named function rather than
  an inline arrow tied to the controls' own lifetime.
- Also emits `'change'` (gizmo moved, re-render if not already looping) and `'objectChange'`
  (the attached object's transform actually changed — hook app state sync here, e.g. pushing
  the new transform to a physics body or a React state store).

## Compact picker example

```js
import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selected = null;

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const [hit] = raycaster.intersectObjects(pickableObjects, true);

  if (selected) selected.material.emissive?.setHex(0x000000); // clear previous highlight
  selected = hit?.object ?? null;
  if (selected) selected.material.emissive?.setHex(0x333333); // highlight new selection
}

renderer.domElement.addEventListener('click', pick);
```

For a fuller worked version (hover highlight, click-to-select, cleanup), see
`assets/snippets/raycaster-picker.js` and the annotated walkthrough in
`recipes/raycasting-picker.md`.

## React Three Fiber note

r3f exposes picking as **built-in JSX pointer events** (`onPointerMove`, `onClick`,
`onPointerOver`, `onPointerOut`, etc.) on any mesh element — the raycaster, NDC math, and
per-frame event dispatch are handled internally by the reconciler's event system, so you don't
wire a `Raycaster` by hand in typical r3f code. See `references/react-three-fiber.md` for the
event props, event propagation/`stopPropagation()` semantics, and how `<TransformControls>`
(via drei) integrates with r3f's `<OrbitControls>`.

## See also

- `references/core-scenegraph.md` — `Layers` bitmask, `traverse`/`traverseAncestors` for
  resolving a hit back to a logical entity
- `references/performance.md` — profiling raycast cost, when to reach for three-mesh-bvh
- `references/react-three-fiber.md` — built-in pointer events, drei `<Html>`, drei
  `<TransformControls>`
- `assets/snippets/raycaster-picker.js`, `recipes/raycasting-picker.md` — full worked example
