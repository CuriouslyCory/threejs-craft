# Cameras & controls

Renderer-agnostic: cameras and `three/addons/controls/*` behave identically on WebGL and
WebGPU — they only manipulate the camera's transform/projection, never touch the render
pipeline.

## PerspectiveCamera

```js
const camera = new THREE.PerspectiveCamera(
  fov,    // vertical field of view, in degrees (not radians) — typical 40-75
  aspect, // width / height of the viewport
  near,   // distance to near clip plane
  far,    // distance to far clip plane
);
```

- **`fov`** is the *vertical* FOV in degrees; horizontal FOV is derived from `aspect`.
  Larger fov = more fisheye/wide-angle distortion at the edges; 50-60 reads as "normal lens."
- **`aspect`** must track the canvas's actual pixel aspect ratio (`width / height`), not the
  window's — recompute on every resize (see below).
- **`near` / `far` and the z-fighting link.** Depth buffer precision is *not* linear between
  `near` and `far` — it's heavily weighted toward `near`, so precision collapses as the
  `far / near` ratio grows. A camera with `near = 0.001, far = 100000` (ratio 10^8) will
  z-fight on any two coplanar-ish surfaces far from the camera, even though each value looks
  individually reasonable. Rule of thumb: keep `near` as large as the scene allows (don't
  default to `0.001` "to be safe") and `far` as small as the scene allows, minimizing the
  ratio. Full symptom/fix writeup lives in `references/debugging-and-gotchas.md` — read that
  file if you're actively chasing a z-fighting bug.

**Any time you change `fov`, `aspect`, `near`, `far`, `zoom`, or the orthographic frustum
edges, you must call `camera.updateProjectionMatrix()`** — the camera does not recompute its
projection matrix automatically on property mutation, only on construction. Forgetting this
after a resize is one of the most common "viewport looks stretched" bugs.

## OrthographicCamera

```js
const camera = new THREE.OrthographicCamera(
  left, right, top, bottom, // frustum edges in world units (a box, not a cone)
  near, far,
);
```

No perspective foreshortening — parallel lines stay parallel, object size on screen doesn't
change with distance from camera. Use for:

- **2.5D / isometric games** — consistent sprite/tile sizing regardless of depth.
- **CAD-style / blueprint / technical viewers** — measurements should read true-to-scale.
- **Orthographic minimaps or UI-adjacent 3D** — predictable, distortion-free framing.

Frustum edges are in world units, not degrees, and must be kept in sync with the aspect ratio
yourself — a common pattern is deriving `left/right` from a fixed `top/bottom` times aspect:

```js
const frustumSize = 10;
const aspect = width / height;
camera.left = (-frustumSize * aspect) / 2;
camera.right = (frustumSize * aspect) / 2;
camera.top = frustumSize / 2;
camera.bottom = -frustumSize / 2;
camera.updateProjectionMatrix();
```

Same rule applies: any edit to `left/right/top/bottom/near/far/zoom` needs
`updateProjectionMatrix()` afterward.

## Resize handling

Both camera types need their projection recomputed on resize, alongside updating the
renderer's output size and pixel ratio (invariant 5). The canonical pattern —
recompute `camera.aspect` (perspective) or frustum edges (orthographic), call
`updateProjectionMatrix()`, then `renderer.setSize(width, height)` and clamp
`renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` — is captured once, ready to paste,
in `assets/snippets/resize-and-loop.js`. Don't hand-roll this per project; that snippet also
bundles the `setAnimationLoop` render loop so resize and the loop stay consistent.

## Controls (`three/addons/controls/*`)

Controls are not part of three.js core — they're addon modules you compose with a camera
manually. Two invariants apply to **every** controls class:

1. If damping/inertia is enabled, you must call **`controls.update()` every frame** in the
   render loop, or the camera never actually settles into the damped position.
2. Call **`controls.dispose()`** on teardown to remove the event listeners it attached to the
   DOM element — otherwise a remounted scene leaks listeners onto a detached canvas
   (invariant 6).

### OrbitControls

The default for "let the user look around a model." Orbits around a `target` point using
pointer drag (rotate), wheel/pinch (dolly/zoom), and right-drag or two-finger drag (pan).

```js
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;      // inertia; requires controls.update() per frame
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);       // point the camera orbits around
controls.minDistance = 2;           // dolly-in clamp
controls.maxDistance = 20;          // dolly-out clamp
controls.minPolarAngle = 0;         // radians; 0 = straight down from above
controls.maxPolarAngle = Math.PI;   // radians; Math.PI = straight up from below
controls.enablePan = true;          // false to lock panning (e.g. product viewers that should stay centered)
controls.update();                  // call once after setting target/position, then every frame if damping

// render loop
renderer.setAnimationLoop(() => {
  controls.update(); // required when enableDamping (or autoRotate) is true
  renderer.render(scene, camera);
});

// teardown
controls.dispose();
```

`minPolarAngle`/`maxPolarAngle` are the most common clamp for "don't let the user flip the
camera under the floor" — constrain the polar range instead of clamping position manually.
A ready-to-paste version of this exact setup lives in `assets/snippets/orbit-controls.js`.

### MapControls

Same class family as OrbitControls but with rotate/pan mouse buttons swapped to match
map-editor conventions (left-drag pans, right-drag rotates) — used for top-down/RTS-style or
level-editor camera rigs. Same damping/`update()`/`dispose()` rules apply. Import from
`three/addons/controls/MapControls.js`; verify constructor/options parity with
`scripts/docs_lookup.mjs MapControls` since it's a thinner wrapper and less frequently
touched than OrbitControls.

### TransformControls (brief)

A draggable gizmo (translate/rotate/scale handles) for manipulating an object's transform
in-scene — think a Blender-style move/rotate/scale widget, not a camera control. It attaches
to an object via `controls.attach(object)`, and because it renders its own gizmo mesh into
the scene, it needs to be added to the scene graph itself (`scene.add(transformControls)` in
older versions, or `.getHelper()` in newer ones — **verify the current attach/add pattern
with `scripts/docs_lookup.mjs TransformControls`**, this is exactly the kind of
constructor/API shape that shifts between versions). It also fires a `dragging-changed` event
you typically use to disable OrbitControls while the gizmo is being dragged, since both
listen to the same pointer events. Full picking + gizmo integration walkthrough (raycasting
to select the target object, wiring the `dragging-changed` handoff) lives in
`references/interaction.md` — read that file when you're actually wiring up a gizmo, this
section is just the routing note.

## r3f note

In a React Three Fiber app (this repo's default authoring style per `SKILL.md`), don't
hand-instantiate `OrbitControls` — use drei's `<OrbitControls />` component, which wraps the
same addon class but wires lifecycle (creation, `update()` in the r3f render loop, and
`dispose()` on unmount) into React automatically. Same props (`enableDamping`, `target`,
`minDistance`, etc.) map directly onto the underlying instance. See
`references/react-three-fiber.md` for drei control components and the r3f render-loop model.

## See also

- `references/debugging-and-gotchas.md` — z-fighting from a bad near/far ratio
- `references/interaction.md` — raycasting/picking, TransformControls gizmo wiring
- `references/react-three-fiber.md` — drei `<OrbitControls />` and friends
- `assets/snippets/resize-and-loop.js` — resize + `setAnimationLoop` boilerplate
- `assets/snippets/orbit-controls.js` — the OrbitControls setup above, paste-ready
