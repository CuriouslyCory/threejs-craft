# Router (expanded)

Fallback index when you're not sure which file to open. `SKILL.md` has the compact version of
this table — read it first if you haven't; this one adds snippets/templates/recipes/scripts
routing and two quick decision recaps. Read the **one** file your task needs, not everything
here.

## Which renderer path am I on?

Resolve this before opening any ★ file — WebGL and WebGPU fork materials, shaders, and
post-processing.

| Signal in the request | Path | Import |
|---|---|---|
| default / "just make it work" / broad browser support / existing GLSL | WebGL | `three` |
| compute shaders, TSL, node materials, "WebGPU", cutting-edge post-fx | WebGPU | `three/webgpu` |

Unsure or unstated → default to **WebGL**. Full rationale and side-by-side setup in
`references/renderers-and-setup.md`.

## Which authoring style am I on?

| Signal | Style |
|---|---|
| React / Next.js app, JSX, "component", existing React codebase | React Three Fiber (`@react-three/fiber` + `@react-three/drei`) |
| plain JS/TS, no framework, imperative control | Vanilla three.js |

This repo is Next.js + React 19 → r3f is the default here unless vanilla is explicitly
requested. Full r3f subsystem detail in `references/react-three-fiber.md`.

## Task/symptom → reference file

| If the task is… | Read |
|---|---|
| set up / init / import map / renderer choice / render loop / resize / tone mapping | `references/renderers-and-setup.md` ★ |
| scene graph, Object3D, transforms, groups, coordinate system, units, world vs local | `references/core-scenegraph.md` |
| camera choice, fov/frustum, OrbitControls/MapControls and friends | `references/cameras-and-controls.md` |
| build/modify geometry, BufferGeometry attributes, instancing, BatchedMesh, merging | `references/geometry.md` |
| material choice, PBR (standard/physical), transparency, node materials | `references/materials.md` ★ |
| load/apply textures, colorSpace, wrapping, mipmaps, anisotropy, KTX2/Draco, video | `references/textures.md` |
| lights, shadows, IBL/PMREM/HDRI environment, RoomEnvironment, baking | `references/lighting-and-env.md` |
| load a `.glb`/`.gltf`/`.fbx`/`.obj`/`.usdz`, Draco/KTX2 decoder wiring, LoadingManager | `references/loaders-and-assets.md` |
| animation, AnimationMixer, clips, skinning, morph targets, keyframe tracks | `references/animation.md` |
| raycasting/picking, pointer events, HTML↔3D alignment, TransformControls (gizmo) | `references/interaction.md` |
| custom shader on **WebGL** (ShaderMaterial, uniforms, onBeforeCompile) | `references/shaders-glsl.md` ★ |
| custom shader on **WebGPU** (TSL nodes, node materials, WGSL/GLSL transpile) | `references/shaders-tsl.md` ★ |
| post-processing / bloom / DOF / outline / SSAO | `references/postprocessing.md` ★ |
| "it's slow" / too many draw calls / GC hitches / frame budget / LOD / culling | `references/performance.md` |
| anything in a React/Next app, JSX scene, drei helpers, r3f hooks, Canvas props | `references/react-three-fiber.md` ★ |
| WebXR, VR/AR, controllers, hand tracking | `references/xr.md` |
| **"screen is black" / nothing renders** / wrong colors / z-fighting / transparency sort / context loss | `references/debugging-and-gotchas.md` ★ |

★ = forks by renderer path (WebGL vs WebGPU). Resolve the renderer-path decision above before
reading these.

## Beyond references/ — snippets, templates, recipes, scripts

The reference files explain concepts and curate high-frequency API. When you need something
more concrete than an explanation, reach one level down:

| You need… | Reach for… |
|---|---|
| a small paste-ready fragment to drop into existing code | `assets/snippets/` |
| a whole new project skeleton you `npm install` and run | `assets/templates/` |
| an annotated walkthrough of building one feature end-to-end, adapted into an existing project | `recipes/` |
| the exact signature of a class/method you're not confident about | `scripts/docs_lookup.mjs <ClassName>` |
| to detect the installed three/r3f/drei versions before writing anything version-sensitive | `scripts/doctor.mjs` |
| to scaffold a known-good starter instead of hand-assembling one | `scripts/scaffold.mjs --renderer=... --authoring=... --delivery=... --out=...` |
| to statically check generated/edited scene code against the 7 invariants | `scripts/validate.mjs ./path/to/file` |
| to sanity-check that a scene actually paints something (headless smoke test) | `scripts/smoke_render.mjs` |

### `assets/snippets/` — paste-ready fragments

Small, self-contained, copy the function/block in:

- `resize-and-loop.js` — the resize handler + `setAnimationLoop` pairing (invariants 4 + 5)
- `color-management.js` — the `outputColorSpace`/`toneMapping`/per-texture `colorSpace` pattern (invariant 3)
- `gltf-draco-ktx2-loader.js` — wiring `GLTFLoader` with `DRACOLoader` + `KTX2Loader` decoders
- `orbit-controls.js` — minimal `OrbitControls` setup + damping in the render loop
- `raycaster-picker.js` — pointer → NDC → raycast → intersected-object pattern

### `assets/templates/` vs `recipes/` — don't confuse them

- **`assets/templates/`** = runnable scaffolds. Copy the whole folder, `npm install`,
  `npm run dev`, it renders. Minimal and boring on purpose. `scaffold.mjs` copies from here.
  Use this to **start** a new project.
- **`recipes/`** = annotated walkthroughs (prose + code) teaching how to build one feature
  (model viewer, instanced field, picker, shader effect) and the reasoning behind each step.
  You adapt the code into an existing project; you don't install a recipe. Use this to **add a
  feature** to something that already exists.

### Scripts, in the order you'd actually run them

1. `scripts/doctor.mjs` — run first, always. Prints installed `three`/`@react-three/fiber`/
   `@react-three/drei` versions and flags deltas from what this skill assumes. Never assume a
   version; detect it.
2. `scripts/scaffold.mjs` — after the three decision gates (renderer/authoring/delivery) are
   resolved, generates a known-good starting project instead of hand-assembling one.
3. `scripts/docs_lookup.mjs <Class>` — anytime you're about to write a constructor option,
   method, or property not covered in a reference file. Never guess a three.js signature.
4. `scripts/validate.mjs <file>` — after generating or editing scene code. Static, fast, no
   runtime needed; catches global `THREE`, removed APIs, wrong import specifier for the chosen
   renderer, `ShaderMaterial`/`onBeforeCompile` under WebGPU, missing color management, missing
   disposal. This is the required floor before calling a task done.
5. `scripts/smoke_render.mjs` — optional, heavier: an actual headless render check for "does
   it paint," when `validate.mjs` isn't enough confidence for the stakes of the task.

## The hard rule, restated

For anything not covered in a reference file — any constructor option, method, or property you
aren't confident about — run `scripts/docs_lookup.mjs <Class>` rather than guessing. This
applies doubly to WebGPU/TSL, where the API is newer and less represented in training data. See
`SKILL.md` for the full rationale.
