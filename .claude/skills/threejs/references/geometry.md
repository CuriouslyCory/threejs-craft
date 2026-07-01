# Geometry — BufferGeometry, primitives, instancing, batching

Renderer-agnostic: `BufferGeometry` and its addons are shared by `three` and `three/webgpu` —
only the material/shader layer forks by renderer. Everything below applies to both paths.

## Table of contents

- [BufferGeometry is the only geometry](#buffergeometry-is-the-only-geometry)
- [Built-in primitives](#built-in-primitives)
- [Building custom BufferGeometry](#building-custom-buffergeometry)
- [Groups for multi-material](#groups-for-multi-material)
- [Instancing — InstancedMesh](#instancing--instancedmesh)
- [BatchedMesh](#batchedmesh)
- [Merging geometries](#merging-geometries)
- [Disposing geometry](#disposing-geometry)

## BufferGeometry is the only geometry

Invariant 2: `Geometry`, `Face3`, and the old vertex/face array API were removed years ago.
Every mesh's geometry is a `BufferGeometry` — a container of typed-array **attributes**
(`position`, `normal`, `uv`, `color`, ...) plus an optional index buffer. If you encounter
code calling `new THREE.Geometry()` or `geometry.vertices.push(...)`, it's stale — port it to
`BufferGeometry` rather than trying to run it as-is.

## Built-in primitives

All live in `three` core (no addon import needed) and construct a ready-to-use
`BufferGeometry`. Segment counts default low for performance — raise them only where the
silhouette needs it (e.g. a close-up sphere).

| Class | Key constructor params |
|---|---|
| `BoxGeometry` | `width, height, depth, widthSegments, heightSegments, depthSegments` |
| `SphereGeometry` | `radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength` (theta/phi args let you carve a partial sphere) |
| `PlaneGeometry` | `width, height, widthSegments, heightSegments` — lies in XY plane, faces +Z by default |
| `CylinderGeometry` | `radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded` |
| `ConeGeometry` | same as Cylinder with `radiusTop` implicitly 0 (thin wrapper over CylinderGeometry) |
| `TorusGeometry` | `radius, tube, radialSegments, tubularSegments, arc` |
| `CircleGeometry` | `radius, segments, thetaStart, thetaLength` — flat disc in XY plane |
| `RingGeometry` | `innerRadius, outerRadius, thetaSegments, phiSegments` |
| `TorusKnotGeometry` | `radius, tube, tubularSegments, radialSegments, p, q` |
| `CapsuleGeometry` | `radius, length, capSegments, radialSegments` |

For anything beyond this high-frequency set (`LatheGeometry`, `ExtrudeGeometry`,
`TubeGeometry`, `PolyhedronGeometry` variants, `ShapeGeometry`, `EdgesGeometry`,
`WireframeGeometry`...), don't guess the constructor signature — run
`scripts/docs_lookup.mjs <ClassName>`.

## Building custom BufferGeometry

A `BufferGeometry` is attributes (`BufferAttribute`, one typed array per vertex property)
plus an optional index. Build one from scratch when procedurally generating a mesh (terrain,
particle field base, custom primitive):

```js
const geometry = new THREE.BufferGeometry();

// Non-indexed: 3 verts per triangle, duplicated at shared edges
const positions = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  0, 1, 0,
]);
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); // itemSize=3 for vec3

const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2)); // itemSize=2 for vec2

geometry.computeVertexNormals(); // derives smooth per-vertex normals from triangle winding — skip only if you're supplying normals yourself
```

- **Indexed vs non-indexed.** Non-indexed geometry repeats a vertex's full attribute set for
  every triangle that uses it (no sharing). Indexed geometry (`geometry.setIndex([...])`,
  a `Uint16Array`/`Uint32Array` of vertex indices) stores each unique vertex once and
  references it by index per triangle — smaller memory footprint and fewer vertices for the
  GPU to shade when a mesh has significant edge-sharing (most closed/manifold meshes). Prefer
  indexed for anything beyond a handful of triangles.

```js
geometry.setIndex([0, 1, 2, 2, 1, 3]); // two triangles sharing an edge, referencing 4 unique verts
```

- **`computeVertexNormals()`** — averages face normals at each shared vertex to produce
  smooth shading. Must be called after positions (and index, if indexed) are set; call again
  if you mutate positions afterward — it does not auto-recompute.
- **`setAttribute(name, bufferAttribute)`** / **`getAttribute(name)`** — the general
  attribute API; `position`/`normal`/`uv`/`color` are just conventional names materials look
  for, but you can add arbitrary custom attributes (e.g. `aInstanceSeed`) for a custom shader
  to read (`references/shaders-glsl.md` / `references/shaders-tsl.md`).
- **Bounding volumes** — `geometry.computeBoundingBox()` / `computeBoundingSphere()` populate
  `geometry.boundingBox` / `boundingSphere`, used for frustum culling
  (`mesh.frustumCulled`, see `references/core-scenegraph.md`) and raycasting broad-phase.
  three.js computes these lazily/automatically in most paths, but call them explicitly after
  procedurally mutating `position` data (e.g. a displacement pass on the CPU) so culling and
  picking stay correct.

## Groups for multi-material

`geometry.addGroup(start, count, materialIndex)` (or the `groups` array directly) splits a
single geometry's index range into sub-ranges, each rendered with a different entry of a
`material` array passed to the `Mesh` — e.g. a box with a different material per face, or a
mesh needing two materials in one draw call (opaque body + transparent visor). This trades
one geometry for `N` draw calls (one per group), so it doesn't reduce draw calls the way
instancing does — it's for **visual** multi-material needs, not a performance tool.

## Instancing — InstancedMesh

Use when you're drawing the **same geometry + material many times** with only per-instance
transform/color varying (trees, rocks, bullets, UI grid cells, crowd extras). `InstancedMesh`
issues one draw call for all instances instead of one draw call per mesh, which is the
single biggest draw-call win available before reaching for a custom GPU-driven pipeline. See
`references/performance.md` for the broader "when do draw calls actually matter" framing.

```js
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial();
const count = 1000;

const instancedMesh = new THREE.InstancedMesh(geometry, material, count);

const dummy = new THREE.Object3D(); // scratch transform helper — reused, not allocated per-instance
for (let i = 0; i < count; i++) {
  dummy.position.set(Math.random() * 20 - 10, 0, Math.random() * 20 - 10);
  dummy.rotation.y = Math.random() * Math.PI * 2;
  dummy.updateMatrix();
  instancedMesh.setMatrixAt(i, dummy.matrix);
}
instancedMesh.instanceMatrix.needsUpdate = true; // required or the GPU never sees the new matrices

scene.add(instancedMesh);
```

- **`count`** is fixed at construction — it's the max instance capacity, not a live count you
  resize. To draw fewer than `count`, set `instancedMesh.count = n` (n <= the constructor
  count) rather than reallocating.
- **`setMatrixAt(index, matrix)`** writes a 4x4 matrix into the instance buffer; always pair
  a batch of `setMatrixAt` calls with a single `instanceMatrix.needsUpdate = true` afterward
  (not per-call) — the flag just tells the renderer to re-upload the buffer once.
- **Per-instance color**: construct with `instancedMesh.instanceColor` support by calling
  `instancedMesh.setColorAt(index, color)` (this lazily allocates the `instanceColor`
  attribute on first call) and set `instancedMesh.instanceColor.needsUpdate = true`
  afterward, same pattern as the matrix. The material must have
  `vertexColors: true`-compatible shading to actually use it — verify exact material
  requirements with `scripts/docs_lookup.mjs InstancedMesh` if colors aren't showing.
- Updating matrices/colors **every frame** for thousands of instances (e.g. animated
  particles) is legitimate but costs a full buffer re-upload each time — fine at hundreds to
  low thousands of instances, worth profiling beyond that.

## BatchedMesh

`BatchedMesh` (three core, no addon import) draws **multiple different geometries** — not
just multiple copies of one geometry — sharing one material, in as few draw calls as
possible. It's the tool when InstancedMesh doesn't fit because your instances aren't
identical geometry (e.g. a handful of distinct rock/prop variants you want batched together
rather than one InstancedMesh per variant). Documented pattern: you `addGeometry()` each
distinct geometry into the batch to get a geometry ID, then `addInstance(geometryId)` per
placed copy to get an instance ID, and set each instance's transform via
`setMatrixAt(instanceId, matrix)` — structurally similar to InstancedMesh's per-instance
matrix API but with an added geometry-selection step.

**This API is comparatively new and has shifted across recent three.js releases** (capacity
management, `optimize()`/culling behavior, and color/visibility setters have all seen
changes) — treat every method name and constructor option here as unverified. Do not write
`BatchedMesh` code from memory; before using it, run
`scripts/docs_lookup.mjs BatchedMesh` and confirm the constructor signature
(`maxInstanceCount`/`maxVertexCount`/`maxIndexCount` or similar capacity args — exact param
names not certain), `addGeometry`, `addInstance`, `setGeometryAt`/`deleteGeometry`, and
`setMatrixAt`/`setVisibleAt` against the pinned r185 docs.

## Merging geometries

For genuinely **static** geometry that never needs independent transforms — terrain chunks,
baked scenery, decoration you'll never move individually — merging into one `BufferGeometry`
beats instancing, because it's zero per-instance overhead (one mesh, one transform, one draw
call) at the cost of losing per-piece identity/transform control.

```js
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const merged = mergeGeometries([geometryA, geometryB, geometryC], /* useGroups= */ false);
const mesh = new THREE.Mesh(merged, material);
```

- Pass `useGroups: true` if the source geometries need **different materials** post-merge —
  this populates `groups` (see above) so you can still pass a material array. Leave `false`
  when they'll share one material; it avoids the extra draw-call-per-group overhead.
  Confirm the exact second-argument shape (some versions take an options object instead of a
  boolean) with `scripts/docs_lookup.mjs mergeGeometries` since `BufferGeometryUtils` is an
  addon and evolves independently of core.
  Full path per `assets/reference-data/addons-importmap.json` conventions:
  `three/addons/utils/BufferGeometryUtils.js`.
- All input geometries must share the same attribute set (same names/itemSizes) or the merge
  will silently drop mismatched attributes — a frequent "merged mesh lost its UVs" bug when
  one source geometry was built without UVs.
- Merging is one-time/CPU-side, not automatic — if source geometries change afterward, you
  must re-merge; it doesn't stay "live."

## Instancing vs BatchedMesh vs merging — quick pick

| Need | Use |
|---|---|
| Same geometry, many placements, transforms change per-frame (or per-interaction) | `InstancedMesh` |
| Different geometries, one material, want them batched into few draw calls, transforms may still change | `BatchedMesh` (verify API — see above) |
| Static geometry, never moves individually, want the fewest possible draw calls | Merge via `BufferGeometryUtils.mergeGeometries` |

Cross-reference `references/performance.md` for the draw-call-budget reasoning behind
reaching for any of these, and `references/materials.md` for how material choice interacts
with instancing (e.g. per-instance color needing `vertexColors`).

## Disposing geometry

`BufferGeometry` instances hold GPU buffers that aren't reclaimed by JS garbage collection —
call `geometry.dispose()` when you're done with a geometry (mesh removed permanently, scene
torn down, procedurally regenerating and replacing it). This is invariant 6. In vanilla
three.js this is on you; a common leak pattern is regenerating procedural geometry every
frame or on every parameter change (e.g. a GUI-driven terrain) without disposing the old one
first:

```js
function rebuildTerrain(params) {
  const newGeometry = buildTerrainGeometry(params);
  mesh.geometry.dispose(); // free the old GPU buffers before dropping the reference
  mesh.geometry = newGeometry;
}
```

Disposing a geometry does not dispose the material or any textures it's paired with — those
are separate objects with their own `dispose()` (see `references/materials.md` and
`references/textures.md`). In React Three Fiber, drei/r3f handles disposal automatically on
unmount for objects it created via JSX — see `references/react-three-fiber.md` for the
`dispose={null}` escape hatch when you need to opt out (e.g. sharing a geometry across
components).
