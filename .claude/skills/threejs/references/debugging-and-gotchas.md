# Debugging & Gotchas ★

Symptom-indexed lookup — scan for your symptom, don't read top to bottom. Each entry is
symptom → cause → fix. For renderer init/setup itself, see
`references/renderers-and-setup.md`; this file assumes setup is roughly right and something
still looks wrong.

## Table of contents

- [Screen is black / nothing renders — the checklist](#screen-is-black--nothing-renders--the-checklist)
- [Washed-out or too-dark colors](#washed-out-or-too-dark-colors)
- [Z-fighting](#z-fighting)
- [Transparency sort order & depthWrite](#transparency-sort-order--depthwrite)
- [Context loss](#context-loss)
- [Flipped normals / backface culling](#flipped-normals--backface-culling)
- [Texture appears black](#texture-appears-black)
- [React Three Fiber-specific gotchas](#react-three-fiber-specific-gotchas)

## Screen is black / nothing renders — the checklist

Work through these in order — they're sorted by frequency, cheapest checks first.

1. **Camera is inside, behind, or coincident with the geometry.** A mesh at the origin with
   the camera also at `(0,0,0)` (the default `PerspectiveCamera` position) renders nothing —
   you're inside it. Set `camera.position.set(x, y, z)` away from your content and confirm
   with `camera.lookAt(0, 0, 0)` or OrbitControls' target.
2. **No light in the scene, and the material needs one.** `MeshStandardMaterial`,
   `MeshPhysicalMaterial`, `MeshLambertMaterial`, and `MeshPhongMaterial` are all lit — with
   zero lights and no environment map they render pure black. `MeshBasicMaterial` is the only
   common material that ignores lighting entirely; swap to it temporarily to isolate whether
   the problem is lighting or geometry/camera.
3. **Renderer's canvas was never appended to the DOM, or the container has zero size.** If you
   constructed the renderer but forgot `document.body.appendChild(renderer.domElement)` (or
   equivalent), there's nothing to look at. Separately, if the parent element has `height: 0`
   (common with flex/grid containers that don't have an explicit height), `renderer.setSize`
   computes to `0x0` and the canvas is invisibly tiny.
4. **Forgot to actually kick off rendering.** You wrote the render function but never called
   `renderer.setAnimationLoop(animate)` (or, for a one-shot render, never called
   `renderer.render(scene, camera)` at all).
5. **WebGPU used without `init()`.** `WebGPURenderer`'s device setup is async; calling
   `.render()` before it resolves silently no-ops. Use `setAnimationLoop` and/or
   `await renderer.init()` — see `references/renderers-and-setup.md`.
6. **NaN in geometry.** A `BufferAttribute` with `NaN` positions (common after a bad
   divide-by-zero in a procedural generation step, or a malformed loaded model) makes three.js
   compute an invalid bounding sphere and can cull the whole object or throw deep in the WebGL
   driver with an unhelpful error. Check `geometry.attributes.position.array` for `NaN`/
   `Infinity`, or call `geometry.computeBoundingSphere()` and inspect `geometry.boundingSphere`.
7. **Object is outside the camera frustum, or beyond `near`/`far`.** A huge scene where the
   camera's `far` is too small clips the object out; conversely a tiny/close-up scene where
   `near` is too large clips it too. Also check the object isn't positioned way outside what
   the `fov`/`aspect` frustum covers at its distance.
8. **`material.visible === false` or `material.opacity === 0`** (with `transparent: true`).
   Both are easy to leave set from a previous debugging pass or a copy-pasted material config.

If you've checked all eight and it's still black, add `scene.background = new
THREE.Color(0x222222)` as a sanity probe — if the background shows but geometry doesn't, the
bug is in steps 1/2/6/7/8 (something about the object); if the background itself stays black,
the bug is upstream in renderer setup (steps 3/4/5) — go to
`references/renderers-and-setup.md`.

## Washed-out or too-dark colors

**Symptom:** colors look flat/gray compared to the source asset (e.g. a texture that looks
vivid in an image viewer looks muddy in the scene), or conversely everything is blown out to
white.

**Cause:** almost always a `colorSpace` or tone-mapping mismatch (invariant 3). Common
specific causes:
- A color texture (albedo/emissive/env) was loaded without `texture.colorSpace =
  THREE.SRGBColorSpace`, so it's treated as linear data and looks washed out/desaturated.
- A data texture (normal/roughness/metalness/AO) *was* given `SRGBColorSpace` by mistake — this
  double-applies a gamma curve to non-color data and corrupts the values (subtle, not
  obviously "wrong" — normal maps look slightly off, roughness responds strangely to light).
- `renderer.outputColorSpace` isn't set to `SRGBColorSpace` (should be the default since r152,
  but verify if working with an older upgraded project).
- Bright/HDR lighting with `NoToneMapping` (the default) clips highlights to white instead of
  rolling off — set `renderer.toneMapping = THREE.ACESFilmicToneMapping` or
  `AgXToneMapping`. If ACES still looks blown out on saturated colors, try `AgXToneMapping` —
  it desaturates highlights more gracefully.
- `toneMappingExposure` left at a non-1.0 value from earlier tuning.

**Fix:** audit every `texture.colorSpace` assignment against the color-vs-data rule (invariant
3, detailed in `references/textures.md`), confirm `renderer.outputColorSpace =
SRGBColorSpace`, and pick a tone-mapping curve deliberately rather than leaving the default.

## Z-fighting

**Symptom:** two overlapping/coplanar surfaces flicker or interleave noisily as the camera
moves — classic on thin coplanar geometry (decals, coincident planes, CAD-style models).

**Cause:** depth-buffer precision is nonlinear across `near`→`far`; a `near`/`far` ratio that's
too large (e.g. `near = 0.01, far = 10000`) starves precision at typical viewing distances, so
two nearly-coincident depths round to the same buffer value.

**Fix, in order of preference:**
1. **Tighten `near`/`far`.** Push `near` as far from the camera as your closest visible
   geometry allows, and pull `far` as close as your farthest visible geometry allows. This is
   the highest-leverage fix — depth precision is a function of the *ratio*, not the absolute
   values.
2. **`logarithmicDepthBuffer: true`** on the `WebGLRenderer` constructor options — trades a
   small perf cost for much better precision distribution across a large `near`/`far` range.
   Good for large open-world scenes where you can't tighten the ratio.
3. **`polygonOffset`** on the material (`polygonOffset: true, polygonOffsetFactor: 1,
   polygonOffsetUnits: 1`, tune sign/magnitude) — nudges one surface's depth values slightly
   so it consistently wins/loses the depth test. Best for a specific known-coplanar pair
   (e.g. a decal over a base mesh), not a general-purpose fix.

## Transparency sort order & depthWrite

**Symptom:** transparent objects render in the wrong order — something that should be behind
another transparent object shows in front, or a transparent object incorrectly occludes
something behind it.

**Cause:** three.js sorts transparent objects back-to-front per-frame by object origin (not
per-triangle), which is a heuristic, not exact — it breaks down for intersecting transparent
geometry, transparent objects sharing an origin, or many overlapping transparent layers.
Separately, transparent materials still write to the depth buffer by default
(`depthWrite: true`), so a transparent surface rendered first can occlude a transparent surface
behind it even though visually you'd expect them to blend.

**Fix:**
- For simple cases, set `depthWrite: false` on transparent materials so they don't block each
  other in the depth buffer — this trades away self-occlusion correctness for correct blending
  order in common cases.
- For a small fixed set of transparent layers, control `renderOrder` explicitly (lower renders
  first) rather than relying on automatic sorting.
- For complex overlapping transparency, consider splitting the object into non-overlapping
  chunks, or accept the heuristic's limits — true order-independent transparency requires
  techniques (depth peeling, weighted OIT) beyond default three.js sorting.

## Context loss

**Symptom:** the canvas suddenly goes black mid-session (not on load) — common after a laptop
sleep/wake, GPU driver crash/reset, or too many WebGL contexts open in the same browser
(each tab/canvas holds one; browsers cap the total).

**Cause:** the browser can force-lose the WebGL context at any time; it's a normal event
you're expected to handle, not a rare edge case in a long-running app.

**Fix:** listen for `webglcontextlost` and `webglcontextrestored` on `renderer.domElement`:

```js
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault(); // required to allow context restoration
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  // GPU resources (textures, buffers, compiled programs) are gone — re-upload/rebuild as needed.
  // three.js will recreate most GPU-side state automatically on the next render for objects
  // still in the scene graph, but any manual GPU work you did outside three's tracking needs
  // to be redone here.
});
```

Keep the number of live renderers/contexts on a page low — don't create a new `WebGLRenderer`
per component instance in a list; share one where possible.

## Flipped normals / backface culling

**Symptom:** a mesh is invisible from certain angles, or lighting looks inverted (dark where
you'd expect bright), especially on imported/procedurally-generated geometry.

**Cause:** `Material.side` defaults to `THREE.FrontSide`, which culls back-facing triangles —
triangles whose winding order (as seen from the camera) is the "wrong" way relative to their
normal don't render at all. This happens from negative-scale transforms (mirroring an object
via `scale.x = -1` flips winding without flipping normals), bad export/import normal
generation, or hand-built `BufferGeometry` with inconsistent winding.

**Fix:**
- Quick diagnostic: set `material.side = THREE.DoubleSide` — if the object appears, the root
  cause is winding/normals, not something else.
- Proper fix depends on cause: if it's a negative-scale mirror, prefer flipping geometry data
  instead of using negative scale, or explicitly reverse winding; if it's bad imported normals,
  regenerate them (`geometry.computeVertexNormals()`) or fix the export pipeline.
- `DoubleSide` is a valid permanent choice for thin/open geometry (leaves, cloth, cards) where
  both faces should always be visible — it's not just a debugging crutch — but it costs
  roughly 2x fragment shading, so don't reach for it as a blanket default on closed meshes.

## Texture appears black

**Symptom:** a texture renders as solid black instead of the expected image.

**Cause, most likely first:**
1. **Texture hasn't loaded yet and you're reading it before the load completes.** If you
   assign a texture synchronously (e.g. `new THREE.TextureLoader().load(url)` returns
   immediately with a placeholder texture that fills in async) but something downstream reads
   pixel data or dimensions before `onLoad` fires, you get black/empty. Usually not an issue
   for normal `map` assignment (the material re-renders once the texture arrives), but is an
   issue for anything reading `image.width` / doing synchronous canvas work.
2. **Missing `colorSpace`, combined with a renderer expecting sRGB output** can crush a
   texture toward black if the texture's actual content is near-black in the wrong space —
   less common than the washed-out case above but worth checking if the washed-out fix doesn't
   apply.
3. **CORS failure loading a cross-origin texture** — the browser silently taints the texture
   or blocks the pixel data; check the console for a CORS error separately from three.js's own
   logging, and confirm the image server sends `Access-Control-Allow-Origin`.
4. **Wrong texture slot for the material/shader** — e.g. assigning a texture to `map` when a
   custom shader actually samples a differently-named uniform, so the actually-sampled texture
   is an unset/default black texture.

## React Three Fiber-specific gotchas

**`<Canvas>` renders zero height.** r3f's `<Canvas>` fills its *parent* via CSS (`width: 100%;
height: 100%`) — it does not have an intrinsic size. If the parent element (or any ancestor up
to a sized block) doesn't have an explicit height, the canvas computes to `0px` tall and
nothing is visible even though the scene is otherwise correct. Fix: give the `Canvas`'s parent
container an explicit height (`height: 100vh`, a flex/grid item with sizing, etc.) — this is
the r3f-flavored version of checklist item 3 above.

**StrictMode double-mount.** React 19 StrictMode (dev only) mounts, unmounts, and remounts
components to surface effect-cleanup bugs. In r3f this means your scene's setup effects run
twice — if a `useEffect` creates a resource (texture, geometry, subscription) without a cleanup
function that undoes it, StrictMode's mount/unmount/remount cycle can leak a duplicate or leave
stale state. r3f itself manages the renderer/scene lifecycle correctly under StrictMode; the
gotcha is almost always in *your* effects that touch resources outside r3f's declarative tree
(imperative refs, manual `three` object creation inside `useEffect`). Always return a cleanup
function from effects that allocate GPU resources.

See `references/react-three-fiber.md` for the full r3f subsystem reference.
