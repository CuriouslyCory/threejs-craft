# Performance

Renderer-agnostic in spirit — the frame-budget mindset and the "count your draw calls" lever
apply equally to WebGL and WebGPU — but the profiling tools and a few specifics (texture
compression, offscreen rendering) differ slightly. Flagged inline where it matters.

## The frame budget

At 60fps you have **16.6ms** per frame to do everything: your app logic, three.js's CPU-side
scene-graph walk (`updateMatrixWorld`, frustum culling, sorting), and the GPU's draw calls +
shading. At 120fps (increasingly common on phones/ProMotion displays) that budget halves to
**8.3ms**. Performance work is triage against that number, not a vague "make it faster" — use
`renderer.info` (below) to find out *which* half of the budget (CPU submission vs GPU work) is
actually the bottleneck before optimizing blind.

## It's slow → check these in order

1. **Draw call count.** `renderer.info.render.calls` — each call is CPU→GPU submission
   overhead independent of triangle count. Hundreds of small meshes each issuing their own
   draw call is the single most common three.js perf bug. Fix: instancing/`InstancedMesh`,
   `BatchedMesh`, or merging static geometry — see "Fewer draw calls" below and
   `references/geometry.md`.
2. **Triangle/vertex count.** `renderer.info.render.triangles` — high poly counts cost GPU
   vertex-shading time. Fix: simplify source geometry, use LOD (below) to swap in lower-poly
   versions at distance.
3. **Shadow cost.** Shadow maps re-render the scene from each shadow-casting light's
   perspective — a scene with 3 shadow-casting lights can be doing 4x the geometry submission
   of the same scene with shadows off. Fix: minimize `castShadow` lights, shrink
   `shadow.mapSize`, tighten the shadow camera's frustum to just what needs to receive shadows
   (`references/lighting-and-env.md`), or bake static shadows into a lightmap instead of
   real-time.
4. **Texture memory & fill rate.** `renderer.info.memory.textures` plus raw VRAM pressure from
   uncompressed textures — large PNGs/JPGs decode to full RGBA8 on the GPU regardless of file
   size on disk. Fix: KTX2/Basis compressed textures, generate mipmaps, cap texture resolution
   to what's actually visible on screen. See `references/textures.md`.
5. **Overdraw / fill rate from transparency.** Many overlapping transparent quads (particle
   systems, foliage cards) shade the same pixel repeatedly. Fix: reduce overlap, sort/cull
   aggressively, consider opaque alternatives (alpha-tested cutouts) where blending isn't
   strictly needed.
6. **Pixel ratio.** Rendering at `devicePixelRatio` 3 on a retina/4K display is ~9x the
   fragment work of 1x for a gain invisible past ~2x. Clamp it (invariant 5) — see below.
7. **CPU-side allocation/GC churn.** Allocating new `Vector3`/`Matrix4`/arrays inside the
   render loop creates garbage-collection pressure that shows up as periodic frame-time spikes
   (hitches), not a steady low framerate — a different symptom from the above, so don't chase
   draw calls if the profile shows sawtooth GC pauses instead. Fix: hoist scratch objects out
   of the loop and reuse them (`.copy()`/`.set()` into a pre-allocated instance instead of
   `new`).
8. **Continuous rendering when nothing changed.** A static scene (product viewer, architectural
   walkthrough with no animation) that renders every frame anyway wastes the entire GPU budget
   on identical pixels. Fix: render-on-demand — see below.

Work this list top to bottom; measure with `renderer.info` between changes rather than guessing
which line item applies — the profile tells you, the list just orders likely-frequency.

## `renderer.info` — the truth source

```js
console.log(renderer.info.render.calls);      // draw calls this frame
console.log(renderer.info.render.triangles);   // triangles submitted this frame
console.log(renderer.info.memory.geometries);  // live BufferGeometry count on GPU
console.log(renderer.info.memory.textures);    // live texture count on GPU
```

`renderer.info` is a live object three.js maintains internally — read it after a render call,
don't guess. `render.calls`/`render.triangles` reset each frame (they describe *that* frame's
work); `memory.geometries`/`memory.textures` are cumulative live counts and are your first
signal of a **disposal leak** (invariant 6) — if `memory.geometries` climbs every time you swap
scenes/models and never comes back down, something isn't calling `.dispose()`. Log these on a
`setInterval` or gate behind a debug key rather than every frame (the `console.log` call itself
has overhead).

## Fewer draw calls: the primary lever

Draw-call count usually dominates over triangle count for "many small objects" scenes (forests,
crowds, particle-like props, tiled level geometry). Three mechanisms, in order of how much
flexibility you give up:

- **`InstancedMesh`** — one geometry + one material, N per-instance transforms (and optionally
  per-instance color), submitted as a single draw call. Best when objects share geometry exactly
  and you only need per-instance transform/color variation. See `references/geometry.md` for
  the instancing API.
- **`BatchedMesh`** — like instancing but allows *different* geometries (still one material) in
  one draw call, with per-instance visibility/transform. Use when objects are similar but not
  identical (e.g. a handful of rock variants) and you don't want N `InstancedMesh` objects.
- **Merging static geometry** (`BufferGeometryUtils.mergeGeometries`) — collapse many
  never-individually-moving meshes into one big `BufferGeometry` + one draw call. Loses
  per-object transform/visibility control entirely (it's now one mesh), so only do this for
  geometry that's genuinely static and doesn't need to be picked/toggled individually.

Full API and code for all three: `references/geometry.md`.

## Render-on-demand (don't render frames nobody sees)

If nothing in the scene changed since the last frame — no animation, no camera movement, no
user interaction — rendering it again burns GPU for identical output. Default three.js render
loops (`setAnimationLoop`) run continuously; opt into on-demand rendering when the scene is
mostly static (CAD viewers, product configurators, architectural walkthroughs between camera
moves).

**Vanilla:** track a dirty flag and only call `renderer.render()` when it's set, clearing it
after. OrbitControls fires a `change` event on user interaction — wire that to mark dirty.

```js
let needsRender = true;
controls.addEventListener('change', () => { needsRender = true; });
window.addEventListener('resize', () => { needsRender = true; });

renderer.setAnimationLoop(() => {
  if (!needsRender) return;
  renderer.render(scene, camera);
  needsRender = false;
});
```

**r3f:** set `<Canvas frameloop="demand">` and call `invalidate()` (from `useThree`) whenever
something outside r3f's own reactivity changes the scene (e.g. a value updated in an
imperative `useFrame`-free effect, or an external animation library tick). r3f already
invalidates automatically on prop changes to its managed JSX tree and on `OrbitControls`
interaction via drei — you mainly need manual `invalidate()` for side-channel mutations. See
`references/react-three-fiber.md`.

Don't reach for on-demand rendering on a scene with continuous animation (spinning object,
particle sim, physics) — there `needsRender` would be `true` every frame anyway, so it's pure
overhead with no benefit.

## LOD (Level of Detail)

`THREE.LOD` swaps between pre-authored mesh variants (high/medium/low poly) based on
camera distance, reducing triangle count for distant objects without visibly changing anything
up close:

```js
const lod = new THREE.LOD();
lod.addLevel(highDetailMesh, 0);    // distance 0–threshold1: high detail
lod.addLevel(medDetailMesh, 20);    // 20+: medium
lod.addLevel(lowDetailMesh, 50);    // 50+: low
scene.add(lod);
```

`LOD` requires `lod.update(camera)` to be called each frame (the renderer does this
automatically for `LOD` objects present in the rendered scene graph — verify the exact
auto-update behavior for your version with `scripts/docs_lookup.mjs LOD` if relying on it
outside a standard render call). Author level meshes as reduced-poly exports from your DCC tool
or a decimation step — three.js doesn't generate LOD meshes for you.

## Frustum culling & manual culling

Automatic frustum culling (`mesh.frustumCulled`, default `true`, invariant covered in
`references/core-scenegraph.md`) already skips off-screen objects from the draw call list at
essentially zero cost — this is "free" and you don't need to do anything to get it, just avoid
disabling it accidentally. Beyond that:

- **Occlusion culling** (skipping objects hidden *behind* other objects, not just outside the
  frustum) isn't built into three.js core. For scenes where this matters (dense interiors,
  city-scale scenes), implement manual visibility zones/portals at the app level, or accept the
  overdraw if the scene isn't that dense — profile before adding this complexity.
- **Manual distance culling** — for very large scenes (open world, instanced foliage fields),
  cull instances beyond a radius at the app level before they ever reach the GPU, rather than
  relying on per-triangle frustum culling alone. Cross-reference `references/geometry.md` for
  patterns that combine this with instancing.

## Texture memory

Covered in depth in `references/textures.md`; the performance-relevant summary: prefer KTX2/
Basis compressed textures over raw PNG/JPG for anything shipped at scale (compressed textures
are smaller on disk *and* smaller in GPU memory, unlike PNG/JPG which only compress the file,
not the decoded VRAM footprint), generate mipmaps (`generateMipmaps`, default `true` for
power-of-two-ish sizes) so distant/minified textures sample a smaller pre-filtered version
instead of aliasing and thrashing the texture cache, and cap resolution to what's actually
visible — a 4K texture on a mesh that's 50px on screen is pure waste.

## Pixel ratio clamp

```js
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

Invariant 5. Retina/4K report `devicePixelRatio` 2–3+; the fragment-shading cost scales with
the *square* of pixel ratio, so 3x vs 2x is already 2.25x the fragment work for marginal visual
gain. Clamp at 2 as the standard default; drop to 1–1.5 on mobile/low-end targets if profiling
shows fragment-bound frames.

## Disposal (invariant 6, perf angle)

Every geometry/material/texture/render-target you create and stop using but don't `.dispose()`
stays resident in GPU memory — `renderer.info.memory.*` climbing across scene
swaps/remounts without returning is the tell. In vanilla three.js this is entirely manual:

```js
geometry.dispose();
material.dispose();
texture.dispose();
renderTarget.dispose();
```

In r3f, unmounting a JSX-managed `<mesh>`/`<primitive>` triggers disposal automatically for
objects r3f created — the exceptions (shared/cached resources via `useLoader`'s cache, manually
constructed `three` objects held in a ref) are covered in `references/react-three-fiber.md`.
Pooling (reusing a geometry/material instance across many objects instead of creating N copies)
is both a memory win and a draw-call-adjacent perf win when it enables instancing.

## Offscreen rendering & workers (pointer, not a full guide)

For CPU-bound scenes where the main thread is contended by app logic (heavy UI, physics,
layout), `OffscreenCanvas` lets you move the three.js render loop into a Web Worker, freeing the
main thread. This is a substantial architectural change (event/input handling has to be proxied
into the worker) and only worth it once you've confirmed the main thread — not the GPU — is the
bottleneck. Treat this as a high-level pointer, not a pattern to reach for by default; verify
current `OffscreenCanvas` + `WebGLRenderer`/`WebGPURenderer` support and setup via
`scripts/docs_lookup.mjs WebGLRenderer` and the three.js examples before committing to it.

## Profiling tools

- **`renderer.info`** — always available, zero setup, the numbers above. Start here.
- **stats.js / stats-gl** — an on-screen FPS/ms/memory overlay. Import from
  `three/addons/libs/stats.module.js` (see `assets/reference-data/addons-importmap.json`):

  ```js
  import Stats from 'three/addons/libs/stats.module.js';

  const stats = new Stats();
  document.body.appendChild(stats.dom);

  renderer.setAnimationLoop(() => {
    stats.update();
    renderer.render(scene, camera);
  });
  ```

  `stats-gl` (separate package, not bundled in `three/addons`) extends this with GPU timing via
  the `EXT_disjoint_timer_query` extension where available — reach for it when CPU-side stats.js
  numbers look fine but the frame is still slow, meaning the bottleneck is GPU-side.
- **Browser DevTools Performance tab** — for CPU-side hitches/GC pauses (list item 7 above);
  the flame chart shows whether time is going into three.js internals, your app code, or GC.
- **Spector.js** (browser extension) — captures a single frame's full sequence of WebGL calls,
  invaluable for "why does this frame issue N draw calls" or diagnosing redundant state
  changes/shader recompiles. WebGL-only; it doesn't inspect WebGPU command buffers — for WebGPU,
  use the browser's native GPU inspector (e.g. Chrome's `chrome://gpu` and DevTools WebGPU
  support) instead.

## See also

- `references/geometry.md` — instancing/`BatchedMesh`/merging API details
- `references/textures.md` — KTX2/mipmaps/anisotropy
- `references/lighting-and-env.md` — shadow map cost tuning
- `references/react-three-fiber.md` — `frameloop="demand"` + `invalidate()`
- `references/debugging-and-gotchas.md` — when perf issues masquerade as correctness bugs (e.g.
  frustum-culled mesh vanishing)
