# Recipe: Instanced Field (thousands of objects, one draw call)

**What you'll build:** a field of thousands of copies of one geometry (grass, rocks, crowd
extras, bullets, UI grid cells) rendered as a single draw call via `InstancedMesh`, with
per-instance color, per-frame animation of a subset of instances, and click/hover picking
against individual instances. **When to use this:** any time you need "the same mesh, many
times" and per-object draw calls (one `Mesh` each) are or would become the bottleneck — see
`references/performance.md` for how draw-call count dominates frame time at this scale.

Pinned versions: three 0.185.1 (r185), r3f 9.6.1, drei 10.7.7. Full instancing API reference:
`references/geometry.md`; broader draw-call framing: `references/performance.md`.

## Table of contents

- [The core idea](#the-core-idea)
- [Vanilla three.js](#vanilla-threejs)
- [React Three Fiber](#react-three-fiber)
- [When to graduate to BatchedMesh](#when-to-graduate-to-batchedmesh)
- [Pitfalls](#pitfalls)
- [Cross-references](#cross-references)

## The core idea

`InstancedMesh` is one `geometry` + one `material` + a GPU buffer of per-instance 4x4 transform
matrices (and optionally per-instance colors). The GPU draws the same triangles `count` times in
a single draw call, reading a different matrix (and color) per instance — instead of `count`
separate `Mesh` objects each costing their own CPU→GPU submission overhead. This is the single
biggest draw-call win available before reaching for a custom GPU-driven pipeline (see
`references/performance.md`, "Fewer draw calls: the primary lever").

The workflow, every time you touch instance transforms:

1. Mutate a **scratch `Object3D`** (`dummy`) — never allocate a new one per instance.
2. Call `dummy.updateMatrix()`.
3. `instancedMesh.setMatrixAt(i, dummy.matrix)`.
4. **Once**, after the loop: `instancedMesh.instanceMatrix.needsUpdate = true`.

Step 4 is the one people forget — without it the GPU buffer never gets re-uploaded and nothing
visibly changes, silently.

## Vanilla three.js

### Setup: geometry, material, count

```js
import * as THREE from 'three';

const geometry = new THREE.ConeGeometry(0.2, 0.6, 6); // e.g. a simple "grass blade" stand-in
const material = new THREE.MeshStandardMaterial({ roughness: 0.8 });
const count = 5000;

const field = new THREE.InstancedMesh(geometry, material, count);
field.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // hint: matrices update often — see Pitfalls
scene.add(field);
```

`count` is the **capacity**, fixed at construction — it is not a live count you resize on the
fly. To render fewer than the full capacity, set `field.count = n` (`n <= count`) rather than
constructing a new `InstancedMesh`.

### Placement: dummy Object3D + setMatrixAt

```js
const dummy = new THREE.Object3D(); // reused scratch transform — allocate once, outside the loop

for (let i = 0; i < count; i++) {
  const radius = 20 * Math.sqrt(Math.random()); // sqrt for uniform disk distribution, not clumped at center
  const angle = Math.random() * Math.PI * 2;

  dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  dummy.rotation.y = Math.random() * Math.PI * 2;
  dummy.scale.setScalar(0.7 + Math.random() * 0.6);
  dummy.updateMatrix(); // writes position/rotation/scale into dummy.matrix — required before reading it

  field.setMatrixAt(i, dummy.matrix);
}
field.instanceMatrix.needsUpdate = true; // one flag, after the whole batch — not per-call
```

### Per-instance color

```js
const color = new THREE.Color();
for (let i = 0; i < count; i++) {
  color.setHSL(0.3 + Math.random() * 0.1, 0.5, 0.3 + Math.random() * 0.2); // greens, some variance
  field.setColorAt(i, color); // lazily allocates field.instanceColor on first call
}
field.instanceColor.needsUpdate = true;
```

`setColorAt` requires the material to actually consume per-instance color — `MeshStandardMaterial`
and friends do this automatically once `instanceColor` exists (no separate `vertexColors` flag
needed for `InstancedMesh` specifically, unlike plain vertex-color geometries — verify current
exact behavior for your pinned version with `scripts/docs_lookup.mjs InstancedMesh` if colors
aren't showing). See `references/geometry.md` for the full instancing API including this
caveat.

### Animate a subset of instances

Updating all 5000 matrices every frame is legitimate at this scale but costs a full buffer
re-upload each time (see Pitfalls). A common middle ground: only touch the instances that are
actually animating (e.g. wind-sway on grass near the camera, or bullets currently in flight),
leave the rest static after initial placement:

```js
const animatedIndices = [/* subset chosen once, e.g. nearest N to camera */];

function animateField(elapsed) {
  for (const i of animatedIndices) {
    field.getMatrixAt(i, dummy.matrix); // read current transform back out
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
    dummy.rotation.z = Math.sin(elapsed * 2 + i) * 0.05; // subtle sway
    dummy.updateMatrix();
    field.setMatrixAt(i, dummy.matrix);
  }
  field.instanceMatrix.needsUpdate = true; // still once per batch, even though the batch is a subset
}
```

If instead you're regenerating a full-field procedural animation every frame (e.g. a wave
simulation touching all instances), just loop `0..count` each frame — the point above is that
you're not *obligated* to touch every instance just because the buffer supports it.

### Raycast against instances

`Raycaster.intersectObject` works on an `InstancedMesh` like any other object, but the hit
result carries an extra field:

```js
const raycaster = new THREE.Raycaster();
// ...NDC pointer math, see references/interaction.md...

const [hit] = raycaster.intersectObject(field);
if (hit) {
  const instanceId = hit.instanceId; // which specific instance was hit — undefined for non-instanced meshes
  field.getMatrixAt(instanceId, dummy.matrix);
  // highlight: e.g. scale this one instance up, or set its color
  field.setColorAt(instanceId, new THREE.Color(0xffaa00));
  field.instanceColor.needsUpdate = true;
}
```

`instanceId` is the index you'd pass back into `setMatrixAt`/`setColorAt`/`getMatrixAt` — it's
the same indexing space you used to place instances. Full raycasting flow (pointer→NDC, hover
throttling): `references/interaction.md` and `recipes/raycasting-picker.md`.

### Render loop + dispose

```js
renderer.setAnimationLoop(() => {
  animateField(clock.getElapsedTime());
  renderer.render(scene, camera);
});

function dispose() {
  field.geometry.dispose();
  field.material.dispose();
  scene.remove(field);
}
```

Disposing an `InstancedMesh` follows the same rules as a regular `Mesh` (invariant 6) — the
instance matrix/color buffers are owned by the `InstancedMesh` itself and released with it; no
separate disposal step needed for them.

## React Three Fiber

### Direct `<instancedMesh>` (imperative-ish, closest to vanilla)

For full control (thousands of instances, custom placement logic), drop to the raw JSX element
and drive it the same way as vanilla, inside a ref:

```jsx
import { useRef, useMemo, useLayoutEffect } from 'react';
import * as THREE from 'three';

function InstancedField({ count = 5000 }) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const radius = 20 * Math.sqrt(Math.random());
      const angle = Math.random() * Math.PI * 2;
      dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      color.setHSL(0.3 + Math.random() * 0.1, 0.5, 0.3 + Math.random() * 0.2);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, dummy]);

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <coneGeometry args={[0.2, 0.6, 6]} />
      <meshStandardMaterial roughness={0.8} />
    </instancedMesh>
  );
}
```

- **`args={[null, null, count]}`** — `InstancedMesh`'s constructor is `(geometry, material,
  count)`; passing `null, null` lets r3f wire up the geometry/material from the child JSX
  elements instead (same pattern as a plain `<mesh>`), while `count` still needs to go through
  `args` since it's constructor-only, not a settable prop afterward.
- **`useLayoutEffect`, not `useEffect`**, for the initial matrix fill — you want the buffer
  populated before the first paint, matching r3f's own layout-effect-timed internal work; using
  `useEffect` here risks one visible frame of default (identity/zero) transforms.
- Same `needsUpdate` rule as vanilla — r3f doesn't change this contract, it just gives you a JSX
  handle to the same imperative `InstancedMesh` API.

### Declarative: drei `<Instances>` / `<Instance>`

For a more React-idiomatic API where each instance is its own component (easier to add/remove
instances reactively, bind per-instance state, or attach per-instance event handlers), drei's
`<Instances>` manages the underlying `InstancedMesh` and exposes each instance as a JSX element:

```jsx
import { Instances, Instance } from '@react-three/drei';

function InstancedField({ items }) {
  // items: [{ id, position, rotationY, color }, ...]
  return (
    <Instances limit={items.length} range={items.length}>
      <coneGeometry args={[0.2, 0.6, 6]} />
      <meshStandardMaterial roughness={0.8} />
      {items.map((item) => (
        <Instance
          key={item.id}
          position={item.position}
          rotation={[0, item.rotationY, 0]}
          color={item.color}
          onClick={() => console.log('clicked', item.id)}
          onPointerOver={() => console.log('hover', item.id)}
        />
      ))}
    </Instances>
  );
}
```

- **`<Instances>`** owns the shared geometry/material (declared as its JSX children, same
  pattern as `<instancedMesh>`) and the underlying `InstancedMesh`; `limit` sets buffer
  capacity (analogous to vanilla's constructor `count` — size it to your expected max, oversizing
  wastes GPU memory, undersizing silently drops instances beyond the limit).
  `range` bounds how many are actually rendered — useful for progressively revealing instances
  without reallocating.
- **`<Instance>`** is a per-item component with normal-looking `position`/`rotation`/`scale`/
  `color` props — drei translates prop changes into the underlying `setMatrixAt`/`setColorAt` +
  `needsUpdate` calls for you, and **each `<Instance>` gets real r3f pointer events**
  (`onClick`, `onPointerOver`, etc.) with `instanceId` resolution already done — no manual
  raycaster `instanceId` bookkeeping (contrast with the vanilla raycasting section above).
- Best fit when instance count is in the hundreds-to-low-thousands and driven by reactive
  application state (a list of placed objects, filtered/toggled by UI); for tens of thousands of
  purely-procedural instances with no per-item React state, the direct `<instancedMesh>` +
  `useLayoutEffect` approach avoids per-item component overhead.

### Animating instances in r3f

```jsx
import { useFrame } from '@react-three/fiber';

useFrame((state) => {
  const mesh = meshRef.current;
  if (!mesh) return;
  const t = state.clock.getElapsedTime();
  for (const i of animatedIndices) {
    mesh.getMatrixAt(i, dummy.matrix);
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
    dummy.rotation.z = Math.sin(t * 2 + i) * 0.05;
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
});
```

Same underlying imperative API and `needsUpdate` requirement as vanilla — `useFrame` is just
r3f's hook into the shared `setAnimationLoop` (r3f drives one internally, satisfying invariant 4
— never call `requestAnimationFrame` yourself in r3f code). With drei `<Instances>`, prefer
updating the mapped `items` state (letting `<Instance>` re-render) for state-driven animation,
and drop to a `ref`-based `useFrame` loop like above only for high-frequency per-frame
procedural motion where React re-renders would be wasteful.

## When to graduate to BatchedMesh

`InstancedMesh` assumes every instance shares the **exact same geometry**. Once you need several
*different* geometries batched together in few draw calls (e.g. 4 distinct rock variants
scattered across a terrain, not identical copies of one rock), that's `BatchedMesh` instead of N
separate `InstancedMesh`es — see `references/geometry.md` for the full comparison table and the
version-sensitivity warning (BatchedMesh's API has shifted across recent three.js releases;
verify with `scripts/docs_lookup.mjs BatchedMesh` before writing it from memory). If instead your
instances are static and never move individually, merging (`BufferGeometryUtils.mergeGeometries`)
beats both — see the same reference file's decision table.

## Pitfalls

- **Forgetting `needsUpdate`.** The single most common bug: matrices/colors written via
  `setMatrixAt`/`setColorAt` are invisible until `instanceMatrix.needsUpdate = true` /
  `instanceColor.needsUpdate = true` is set, once, after the batch. No error, no console
  warning — just stale/default-looking instances.
- **Updating every instance's matrix every frame when only a few actually move.** Each
  `needsUpdate = true` triggers a full GPU buffer re-upload of the instance buffer. Fine at
  hundreds to low thousands of instances; worth profiling (`renderer.info`, see
  `references/performance.md`) and switching to the "only touch the animated subset" pattern
  above once you're pushing tens of thousands.
- **Allocating a new `Object3D` (or `Vector3`/`Matrix4`) per instance per frame** instead of
  reusing one scratch `dummy` — this is the classic render-loop GC-churn pattern flagged in
  `references/performance.md` ("CPU-side allocation/GC churn"), and it's easy to introduce by
  accident inside a `.map()`-style placement loop.
- **Treating `count` as resizable.** It's fixed at construction; use `mesh.count = n` (`n <=
  constructorCount`) to draw fewer instances, or plan capacity upfront and rebuild the
  `InstancedMesh` (not just mutate `count`) if you genuinely need more than the original
  capacity.
- **Expecting per-instance color without calling `setColorAt` at least once.** `instanceColor`
  is lazily allocated on first `setColorAt` call — reading it before that (e.g. to check if it
  exists) returns `null`.
- **Raycasting the whole scene instead of just the field**, and doing it on every
  `pointermove` unthrottled — same perf footgun as regular picking, worse at instance-field
  scale since `intersectObject` still does per-triangle testing across all `count` instances
  under the hood. Throttle via rAF-gating (see `references/interaction.md`) and pass a narrow
  candidate list.

## Cross-references

- `references/geometry.md` — full `InstancedMesh` API, `BatchedMesh`, merging, the
  instancing-vs-batching-vs-merging decision table
- `references/performance.md` — draw-call budget reasoning, `renderer.info`, GC-churn profiling
- `references/interaction.md` — raycasting fundamentals, pointer throttling, `instanceId`
- `recipes/raycasting-picker.md` — full picker walkthrough, including an instanced-mesh section
- drei `<Instances>`/`<Instance>` — see `references/react-three-fiber.md` for broader drei
  helper conventions
