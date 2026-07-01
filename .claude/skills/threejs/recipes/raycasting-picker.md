# Recipe: Raycasting Picker (click/hover to select objects)

**What you'll build:** click-to-select and hover-to-highlight against scene objects, done
correctly — pointer position converted to normalized device coordinates (NDC), a `Raycaster`
built from the camera, hover state swapped via material/emissive changes, and the same pattern
extended to `InstancedMesh`. **When to use this:** any "click an object in the 3D scene to
select/inspect/interact with it" feature — configurators, editors, games with clickable
entities, data-viz with hoverable points/instances.

Pinned versions: three 0.185.1 (r185), r3f 9.6.1, drei 10.7.7. Full API reference:
`references/interaction.md`; paste-ready fragment: `assets/snippets/raycaster-picker.js`.

## Table of contents

- [The flow](#the-flow)
- [Vanilla three.js](#vanilla-threejs)
- [Hover highlight](#hover-highlight)
- [Picking InstancedMesh](#picking-instancedmesh)
- [React Three Fiber: the native way](#react-three-fiber-the-native-way)
- [Pitfalls](#pitfalls)
- [Cross-references](#cross-references)

## The flow

Four steps, always in this order:

1. **Pointer event → client coordinates.** `event.clientX`/`clientY` from a `pointermove`/
   `click` listener.
2. **Client coordinates → NDC.** Normalize against the *canvas's* bounding rect (not the
   window), producing `x, y` both in `[-1, 1]` with **+Y up** — screen/DOM coordinates are Y-down,
   so this conversion includes a sign flip that's the single most common mistake in this flow.
3. **NDC → ray.** `raycaster.setFromCamera(ndcVector2, camera)` builds a world-space ray from the
   camera through that NDC point — handles perspective and orthographic cameras correctly, so
   prefer it over hand-rolling `unproject()`.
4. **Ray → intersections.** `raycaster.intersectObjects(candidates, recursive)` returns hits
   sorted nearest-first; `hits[0]` is what the user is actually pointing at.

Full narrative and API detail for each step: `references/interaction.md`.

## Vanilla three.js

### Pointer → NDC

```js
import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointerNDC(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; // note the negation — Y flip
}
```

**Always use `getBoundingClientRect()`**, not `window.innerWidth/innerHeight` — this is what
makes the math correct when the canvas isn't full-viewport or has been offset/resized by CSS
(a common miss that only shows up once the canvas stops being exactly the size of the window).

### Raycast against a narrow candidate list

```js
const pickableObjects = []; // populate with the specific meshes you want pickable — not scene.children

function pickAtPointer(camera) {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickableObjects, true); // true = recurse into children
  return hits[0] ?? null;
}
```

Pass the objects you actually want testable, not `scene.children` broadly — otherwise you're
raycasting lights, helpers, and gizmos too. `recursive: true` is usually what you want for loaded
models (a glTF scene is a `Group` wrapping many `Mesh` children) — see
`references/interaction.md` for when `false` is correct instead.

### Click to select

```js
const canvas = renderer.domElement;
let selected = null;

canvas.addEventListener('click', (event) => {
  updatePointerNDC(event, canvas);
  const hit = pickAtPointer(camera);
  selected = hit?.object ?? null;
  onSelectionChanged(selected);
});
```

`click` doesn't need throttling — it's already a discrete, low-frequency event, unlike
`pointermove` below.

## Hover highlight

Hover needs two things beyond click: **throttling** (pointermove fires far more often than your
render loop, especially on high-poll-rate mice) and **state cleanup** (un-highlight whatever was
previously hovered before highlighting the new target, including the "moved off everything" case).

```js
let hovered = null;
let hoverPending = false;

function setHovered(object) {
  if (hovered === object) return; // no-op if nothing changed — avoids redundant material writes
  if (hovered) hovered.material.emissive?.setHex(0x000000); // clear previous highlight
  hovered = object;
  if (hovered) hovered.material.emissive?.setHex(0x333333); // apply new highlight
}

canvas.addEventListener('pointermove', (event) => {
  updatePointerNDC(event, canvas);
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const hit = pickAtPointer(camera);
    setHovered(hit?.object ?? null);
  });
});
```

- **rAF-gating** (the `hoverPending` flag) collapses a burst of `pointermove` events into at most
  one raycast per rendered frame — raycasting synchronously inside the DOM event handler is the
  perf footgun called out in `references/interaction.md` and `references/performance.md`.
- **Swapping material vs emissive**: the snippet above mutates `emissive` in place (cheap, works
  for any `MeshStandardMaterial`/`MeshPhysicalMaterial`-family object already in the scene). The
  alternative — swap the whole `material` reference to a pre-built highlight material and restore
  the original on un-hover — is better when the highlight look needs to differ more than a
  color tint (e.g. wireframe overlay, different shader), at the cost of remembering the original
  material per object (`object.userData.originalMaterial = object.material` before swapping).
- **`selected === hovered` interaction**: if you also support click-to-select, decide whether a
  selected object keeps a distinct highlight from a merely-hovered one (typically yes — e.g.
  outline for selected, subtle emissive for hovered) and make sure `setHovered` doesn't clobber
  the selected object's outline when the pointer moves off it.

Full compact example (click + hover + cleanup) as a paste-ready fragment:
`assets/snippets/raycaster-picker.js`.

## Picking InstancedMesh

Raycasting an `InstancedMesh` works exactly like a regular mesh, but the hit carries an
`instanceId` telling you *which* instance was hit:

```js
const [hit] = raycaster.intersectObject(instancedField, false); // InstancedMesh has no children to recurse into

if (hit) {
  const instanceId = hit.instanceId;
  // Per-instance highlight: swap that instance's color, leave the rest alone.
  instancedField.setColorAt(instanceId, new THREE.Color(0xffaa00));
  instancedField.instanceColor.needsUpdate = true;

  // Un-highlighting the previous instance requires remembering its original color —
  // stash a Map<instanceId, THREE.Color> at placement time if hover-highlight needs to restore it.
}
```

There is no per-instance `material`/`emissive` to swap (all instances share one material) — the
highlight mechanism for instanced picking is necessarily per-instance **color**
(`setColorAt`/`instanceColor`) rather than a material swap. See `recipes/instanced-field.md` for
the full instancing setup this builds on, and `references/geometry.md` for the `setColorAt` API.

## React Three Fiber: the native way

r3f exposes picking as **built-in JSX pointer events** on any mesh element — you don't
hand-wire a `Raycaster` at all in typical r3f code. The reconciler runs one shared raycaster
internally and dispatches synthetic pointer events per-object, per-frame:

```jsx
import { useState } from 'react';

function PickableBox({ position }) {
  const [hovered, setHovered] = useState(false);

  return (
    <mesh
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation(); // prevent this event from also firing on objects behind it
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        console.log('clicked', e.object, 'at', e.point);
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#5b8def"
        emissive={hovered ? '#333333' : '#000000'}
      />
    </mesh>
  );
}
```

- **`onPointerOver`/`onPointerOut`/`onClick`/`onPointerMove`/`onPointerDown`/`onPointerUp`** —
  standard-looking DOM-style handlers, but backed by r3f's internal raycasting against every
  mesh with a handler attached, run once per frame (already throttled to the render loop — you
  don't rAF-gate this yourself the way you do in vanilla).
- **`e.stopPropagation()`** matters because r3f dispatches to *every* intersected object along
  the ray by default (like DOM event bubbling but for 3D depth-sorted hits), not just the
  nearest one — without it, hovering a box in front of another box fires `onPointerOver` on
  both. Call it on the frontmost handler you care about to stop propagation to occluded objects.
- **The event object** (`e`) carries the same intersection data as a raw `Raycaster` hit —
  `e.object`, `e.point`, `e.distance`, `e.face`, `e.uv`, and `e.instanceId` when the target is an
  `<instancedMesh>` — so instanced picking in r3f reads identically to the vanilla `instanceId`
  pattern above, just delivered as an event property instead of a manual `intersectObject`
  return value.
- drei's `<Instance>` (from `<Instances>`, see `recipes/instanced-field.md`) goes one step
  further and resolves `instanceId` back to the specific `<Instance>` component automatically —
  its own `onClick`/`onPointerOver` fire already scoped to that one instance, no manual
  `instanceId` lookup needed.

### Contrast with manual raycasting in r3f

You *can* still drop to `useThree(({ raycaster, camera, pointer }) => ...)` and call
`raycaster.intersectObjects(...)` by hand inside a `useFrame` — useful when picking logic doesn't
map cleanly onto per-mesh JSX handlers (e.g. picking against a dynamically-changing candidate
list, or running a raycast test that isn't tied to a pointer event at all, like a "what's under
the crosshair" always-on game-style reticle). But for the common "click/hover this specific
object" case, prefer the built-in event props — they're already correctly throttled, NDC-mapped
against the canvas's actual rect (accounting for `<Canvas>` sizing/DPR automatically), and
integrated with r3f's render loop. See `references/react-three-fiber.md` for the full event
system reference (propagation semantics, `pointer-events: none`-style opt-outs, and how this
interacts with drei's `<Html>` overlays).

## Pitfalls

- **NDC math off by DPR/canvas offset.** Using `window.innerWidth/innerHeight` instead of
  `canvas.getBoundingClientRect()` breaks as soon as the canvas isn't exactly full-viewport —
  picking drifts increasingly the further the canvas is offset/resized from the window. Always
  derive from the canvas's own rect. (r3f handles this for you via built-in events — this
  pitfall is vanilla-specific.)
- **Forgetting the Y flip.** NDC is +Y-up; DOM/screen coordinates are Y-down. Omitting the
  negation in `pointer.y = -(...) * 2 + 1` produces a vertically mirrored pick — clicks near the
  top of the screen resolve near the bottom of the scene and vice versa.
- **Raycasting the whole scene on every `pointermove`, unthrottled.** This is the classic perf
  footgun: `intersectObjects(scene.children, true)` walks every object (including
  lights/helpers) and is O(triangles) per candidate mesh, run on every mouse-move event — which
  can fire far faster than your render loop on a high-poll-rate mouse. Narrow the candidate list
  and rAF-gate (vanilla), or rely on r3f's already-throttled built-in events.
- **Not resetting hover state when the pointer leaves everything.** A hover handler that only
  handles "now hovering X" and never handles "hovering nothing" leaves a stale highlight when
  the cursor moves off the last-hovered object into empty space. In r3f, `onPointerOut` covers
  per-object exit, but also handle the "moved to empty canvas space" case if your highlight
  logic lives outside individual mesh state.
- **Missing `e.stopPropagation()` in r3f**, causing hover/click to fire on multiple
  depth-overlapping objects at once when you only wanted the frontmost.
- **Instanced picking without a way to restore the previous instance's color** — unlike a
  regular mesh (swap `material.emissive` back to a known default), an instance's *original*
  per-instance color has to be remembered explicitly (e.g. a side array/Map keyed by
  `instanceId`) before you overwrite it for a highlight.

## Cross-references

- `references/interaction.md` — full raycasting API, `TransformControls` gizmo, HTML↔3D
  alignment, `three-mesh-bvh` for large-scene raycast performance
- `references/performance.md` — why unthrottled raycasting shows up as a frame-time sink
- `recipes/instanced-field.md` — the `InstancedMesh` setup this recipe's instanced-picking
  section assumes
- `references/react-three-fiber.md` — full r3f pointer-event system, propagation semantics,
  `useThree`
- `assets/snippets/raycaster-picker.js` — paste-ready vanilla click+hover fragment
