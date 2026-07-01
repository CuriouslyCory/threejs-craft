# Core scene graph — Object3D, transforms, world space

Renderer-agnostic: everything here is identical on WebGL and WebGPU. The scene graph lives
in `three` core, not in either renderer.

## Scene, Group, Object3D

`Scene` and `Group` are both plain `Object3D` subclasses with no geometry/material of their
own — they exist purely to hold children and apply a transform to them.

- **`Object3D`** — the base class for anything with a position in the graph: `Mesh`,
  `Light`, `Camera`, `Group`, `Bone`, etc. Has the transform trio, `children`, `parent`.
- **`Group`** — use to organize/transform a bundle of objects together (e.g. wheels of a
  car, so you can rotate the wheel group without rebuilding hierarchy). Prefer it over a
  bare `Object3D` for this purpose — same behavior, but the name documents intent.
- **`Scene`** — the root you pass to `renderer.render(scene, camera)`. Adds `background`,
  `environment`, `fog` properties on top of `Object3D`. Only one scene is "active" per
  render call, but nothing stops you creating several (e.g. a picking scene).

```js
const wheelGroup = new THREE.Group();
wheelGroup.add(frontLeftWheel, frontRightWheel, rearLeftWheel, rearRightWheel);
car.add(wheelGroup);
```

## add / remove / attach

- **`parent.add(child)`** — inserts `child` into `parent.children`. This does **not**
  preserve the child's world transform: the child keeps its *local* position/rotation/scale,
  which now gets composed with the new parent's transform. If the parent has any transform,
  the child visually jumps.
- **`parent.attach(child)`** — same insertion, but recomputes the child's local transform
  first so its **world** transform is unchanged. Use this when re-parenting an object that's
  already positioned in the scene (e.g. picking up an object and attaching it to a hand
  bone) and you don't want it to teleport.
- **`parent.remove(child)`** — removes from `children`. Does not dispose GPU resources —
  see invariant 6, disposal is a separate step.

```js
// Wrong: sword jumps to align with hand's local origin
handBone.add(sword);

// Right: sword keeps its current world position/rotation, then tracks the hand
handBone.attach(sword);
```

## traverse

Walk the subtree rooted at any `Object3D`:

```js
model.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true;
    obj.receiveShadow = true;
  }
});
```

`traverse` visits the node itself, then recurses into children depth-first. Use
`traverseVisible` to skip subtrees where `visible === false`, and `traverseAncestors` to walk
upward from a node to the root. Common use: after loading a GLTF, `traverse` to enable
shadows or swap materials on every mesh, since you don't know the hierarchy shape up front.

## The transform trio: position, rotation, quaternion, scale

Every `Object3D` has four transform properties, three of which represent the *same*
rotation in different encodings:

| Property | Type | Notes |
|---|---|---|
| `position` | `Vector3` | Local offset from parent |
| `rotation` | `Euler` | XYZ order by default; human-readable, but gimbal-locks and doesn't interpolate cleanly |
| `quaternion` | `Quaternion` | The actual internal rotation representation; always in sync with `rotation` |
| `scale` | `Vector3` | Local scale factor per axis; non-uniform scale is legal but skews normals — prefer uniform scale unless you need the skew |

`rotation` and `quaternion` are two views of one underlying rotation — three.js keeps them
synced automatically when you mutate either. **You still shouldn't mix authoring styles
within one animation**: pick Euler for hand-authored, single-axis, human-tunable rotation
(e.g. a dial in a GUI), and quaternion for anything programmatic — interpolation
(`Quaternion.slerp`), "look toward" math, combining rotations, or values coming from an
animation clip/physics engine. Euler interpolation (lerping angles) does not produce the
shortest rotational path and can gimbal-lock; quaternion slerp does.

```js
// Euler: fine for a one-shot, human-tuned rotation
mesh.rotation.set(0, Math.PI / 4, 0);

// Quaternion: fine for interpolating between two orientations
const q = new THREE.Quaternion();
q.slerpQuaternions(startQuat, endQuat, t);
mesh.quaternion.copy(q);
```

## lookAt

`object.lookAt(x, y, z)` or `object.lookAt(vector3)` orients the object so its local -Z axis
points at the target, computed in world space. Works on cameras, meshes, lights (for lights
that don't already target via `light.target`, e.g. `DirectionalLight`/`SpotLight`, which use
a separate `target` object instead). `lookAt` writes to `quaternion`, so calling it and then
also setting `rotation` afterward will fight — pick one per frame.

## Matrices: local vs world, and when they update

Each `Object3D` has:

- **`matrix`** — local transform, composed from position/quaternion/scale.
- **`matrixWorld`** — the accumulated transform through every ancestor up to the scene root;
  this is what actually places the object for rendering.

`matrixWorld` is recomputed by `updateMatrixWorld()`, which the renderer calls automatically
once per render, walking the whole graph. **This means reading `matrixWorld` (or anything
derived from it, like `getWorldPosition`) right after you set `position` in the same frame,
before a render has happened, gives you stale data.** If you need up-to-date world data
before the next render — e.g. right after parenting or moving an object, for a physics or
gameplay check — call `object.updateMatrixWorld(true)` (the `true` forces the whole subtree,
not just dirty nodes) or `object.updateWorldMatrix(true, true)` (updates parents too, then
this object and descendants).

`matrixAutoUpdate` (default `true`, set on each `Object3D`, mirrors
`Object3D.DEFAULT_MATRIX_AUTO_UPDATE`) controls whether `matrix` is rebuilt from
position/quaternion/scale each frame. Set it `false` on truly static objects as a minor perf
win, but then you must call `object.updateMatrix()` yourself if you ever do change the
transform — otherwise your change is silently ignored. Don't reach for this unless you've
profiled a scene with many thousands of static objects; it's easy to introduce a "moved it
but nothing happened" bug for negligible gain elsewhere. For genuinely static geometry at
scale, prefer instancing (`references/geometry.md`) over hand-tuning `matrixAutoUpdate`.

## Local vs world space conversions

- **`object.localToWorld(vector3)`** — mutates and returns `vector3`, converting a point in
  `object`'s local space to world space.
- **`object.worldToLocal(vector3)`** — the inverse.
- **`object.getWorldPosition(target)`**, **`getWorldQuaternion(target)`**,
  **`getWorldScale(target)`** — extract just one component of `matrixWorld` into a
  pre-allocated `target` vector/quaternion (you must pass `target`; these do not allocate for
  you, so reuse a scratch vector in a render loop rather than `new Vector3()` every frame).

```js
// Parent a mesh, then read its resolved world position
const group = new THREE.Group();
group.position.set(5, 0, 0);
scene.add(group);

const mesh = new THREE.Mesh(geometry, material);
mesh.position.set(0, 2, 0); // local to group
group.add(mesh);

group.updateMatrixWorld(true); // force-resolve before reading, since no render has run yet

const worldPos = new THREE.Vector3();
mesh.getWorldPosition(worldPos); // -> (5, 2, 0)
```

## Coordinate system & units

three.js is **right-handed**: +X right, +Y up, +Z toward the camera (out of the screen) in
the default view convention. `PerspectiveCamera` looks down its local -Z. Positive rotation
around an axis is counter-clockwise when looking from the positive end of that axis toward
the origin (standard right-hand rule).

**Convention, not enforcement: 1 unit = 1 meter.** three.js does not hard-code units, but the
entire ecosystem assumes meters — glTF's spec mandates meters, physics engines (Rapier,
Cannon, Ammo) default their gravity/mass/friction tuning to a meters assumption, default
camera `near`/`far` and light intensities (physically-correct photometric units, e.g. lumens
for `PointLight`) are meter-scaled, and default `PerspectiveCamera` FOV plus typical `near`
values (~0.1) produce sane z-fighting behavior at meter scale. If you import a GLTF authored
in centimeters without rescaling, physics bodies, shadow camera frustums, and light falloff
will all look "wrong" in ways that are individually confusing but collectively trace back to
this one assumption. See `references/lighting-and-env.md` for photometric light units and
`references/debugging-and-gotchas.md` for near/far z-fighting.

## userData

`object.userData` is a plain `{}` bag three.js never reads internally (with the exception of
some loaders round-tripping glTF `extras` into it). Use it for app-level metadata attached to
a node — entity IDs, gameplay flags, original-material references for hover/selection swaps.
It survives `object.clone()` (shallow-copied) but you own serialization if you need it
persisted.

## Layers (brief)

`object.layers` is a 32-bit bitmask (`THREE.Layers`) used to select which objects a camera
renders or a raycaster tests, independent of scene graph position. Default: every object and
every camera is on layer `0`. Common use: put gizmos/helpers on a layer the main camera
excludes but a debug camera includes, via `object.layers.set(n)` /
`camera.layers.enable(n)`. Full raycaster-layer interaction lives in
`references/interaction.md`; verify exact method names (`set`/`enable`/`disable`/`toggle`/
`test`) with `scripts/docs_lookup.mjs Layers`.

## Visibility & frustum culling

- **`object.visible`** (default `true`) — skips the object (and, since it's checked during
  traversal, its children too) during render. Cheaper than add/remove for toggling, and
  avoids the re-parent/dispose churn.
- **`mesh.frustumCulled`** (default `true`) — per-mesh opt-out of automatic frustum culling.
  three.js culls using `geometry.boundingSphere`; if you mutate vertex positions in a vertex
  shader or via a compute pass such that the mesh visually moves outside its CPU-computed
  bounding sphere (e.g. GPU-driven vertex displacement, wind sway, skinning with large bone
  offsets), the renderer can wrongly cull it. Symptom: mesh "disappears" at certain camera
  angles despite being visibly on-screen. Fix by setting `frustumCulled = false` on that mesh
  (cheap for a handful of meshes, avoid globally) or by inflating/recomputing
  `geometry.boundingSphere` to cover the true displaced extent. Cross-reference:
  `references/performance.md` for culling at scale, `references/debugging-and-gotchas.md` for
  the "mesh vanishes" symptom.

## See also

- `references/performance.md` — instancing/batching/LOD when the graph gets large
- `references/geometry.md` — BufferGeometry, bounding volumes, instancing internals
- `references/interaction.md` — raycasting, layers for picking, TransformControls gizmo
- `references/animation.md` — AnimationMixer driving position/quaternion/scale over time
