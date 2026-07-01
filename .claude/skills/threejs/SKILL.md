---
name: threejs
description: >-
  Expert three.js and React Three Fiber (r3f/drei) development for games, interactive
  3D, data-viz, product configurators, model viewers, and WebXR on the web. Use this
  skill whenever a task involves three.js, @react-three/fiber, @react-three/drei, Threlte,
  WebGL or WebGPU rendering, a 3D scene/camera/mesh/material/light, loading a .glb/.gltf/
  .fbx/.obj/.usdz model, GLSL or TSL shaders, node materials, post-processing/bloom,
  raycasting/picking, instancing/performance tuning, or debugging a "black screen"/
  washed-out-colors/z-fighting 3D bug — even if the user never says "three.js" and just
  says "3D scene", "WebGL", "render a model in the browser", or "make a browser game".
  Prevents the two dominant failure modes: version drift (three ships ~monthly with
  breaking changes) and hallucinated API signatures.
---

# three.js / React Three Fiber Expert

Building correct three.js is less about knowing the API and more about (1) pinning to the
**installed version** because three ships breaking changes almost monthly, (2) picking the
right **renderer path** because WebGL and WebGPU fork the code you write, and (3) never
inventing a class signature — three has hundreds of classes and a guessed method is the
second-fastest way to ship a broken scene.

This file is a **router + invariants**. Establish the world (Step 0), hold the invariants,
then jump to the one subsystem file your task needs. Don't read every reference — read the
one the router points at.

## Step 0 — Establish the world (do this first)

Run the doctor to pin the installed version and detect WebGPU support, then resolve three
decision gates. If `three` is already a dependency, **never** assume the version — detect it.

```bash
node .claude/skills/threejs/scripts/doctor.mjs        # prints installed versions + relevant deltas
```

**Decision gate 1 — Renderer path** (this forks materials, shaders, and post-processing):

| Signal in the request | Path |
|---|---|
| default / "just make it work" / broad browser support / lots of existing GLSL | **WebGL** (`three`) |
| compute shaders, TSL, node materials, "WebGPU", cutting-edge post-fx, heavy GPU work | **WebGPU** (`three/webgpu`) |

Default to **WebGL** unless the request signals otherwise — it's the most broadly compatible
and best-documented path. WebGPURenderer auto-falls-back to WebGL2, but the *authoring APIs
differ* (node materials/TSL vs GLSL), so pick deliberately.

**Decision gate 2 — Authoring style:**

| Signal | Style |
|---|---|
| React / Next.js app, JSX, "component", existing React codebase | **React Three Fiber** (`@react-three/fiber` + `@react-three/drei`) |
| plain JS/TS, no framework, smallest footprint, imperative control | **Vanilla** three.js |

This repo is a **Next.js + React 19** app, so **r3f is the default here** unless the user
asks for a standalone vanilla scene. See `references/react-three-fiber.md`.

**Decision gate 3 — Delivery:**

| Signal | Delivery |
|---|---|
| default, any real project, TypeScript, npm deps | **Vite** (or the app's existing bundler, e.g. Next.js) |
| single HTML file, no build step, quick demo/CodePen-style | **import-map + ESM CDN** |

Default to a **bundler**. Only use the import-map path for a deliberately build-less demo.

Once resolved, scaffold a known-good starter instead of hand-assembling:

```bash
node .claude/skills/threejs/scripts/scaffold.mjs --renderer=webgl --authoring=r3f --delivery=vite --out=./my-scene
```

## The invariants (hold these regardless of subsystem)

These are the non-negotiables. Most "looks right, renders wrong" bugs are a violated
invariant. `scripts/validate.mjs` statically checks the greppable ones.

1. **ESM only.** Import from `three` / `three/webgpu` / `three/addons/*` / `three/tsl`.
   Never a `<script>` tag exposing a global `THREE`, never a deep import of a `build/` file.
2. **BufferGeometry only.** `Geometry`, `Face3`, and `JSONLoader` were removed years ago.
   If you see them, the source is stale — port it.
3. **Explicit color management.** `ColorManagement` is on by default (r152+). Set
   `colorSpace = SRGBColorSpace` on *color* textures (albedo/emissive/env); leave *data*
   textures (normal/roughness/metalness/AO) linear. Washed-out or too-dark colors almost
   always trace back to this.
4. **`setAnimationLoop`, not raw `requestAnimationFrame`.** It's mandatory for WebGPU (the
   device inits asynchronously) and WebXR (frame timing comes from the headset). For WebGPU,
   either `await renderer.init()` before rendering or rely on `setAnimationLoop` — otherwise
   the first frames render nothing and fail silently.
5. **Handle resize.** On resize update `camera.aspect` (perspective), call
   `camera.updateProjectionMatrix()`, and `renderer.setSize(...)`; clamp
   `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` so retina doesn't tank perf.
6. **Dispose on teardown.** Geometries, materials, textures, render targets, and controls
   hold GPU memory that GC won't reclaim. In r3f most of this is automatic; in vanilla it's
   on you. A remount without disposal is a classic leak.
7. **WebGPU forks the shader + post-processing story.** `ShaderMaterial`,
   `RawShaderMaterial`, and `onBeforeCompile` do **not** work on `WebGPURenderer`; use node
   materials + TSL. `EffectComposer` passes are replaced by the node post-processing stack.

## Router — task/symptom → reference file

Read the **one** file that matches. Each is a subsystem cheat-sheet; the `★` files fork by
renderer path.

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
| unsure which file / want the expanded map | `references/00-router.md` |

For a **paste-ready fragment** (loop, color mgmt, GLTF+Draco+KTX2 loader, OrbitControls,
raycaster), grab it from `assets/snippets/`. For an **end-to-end annotated build** you adapt
wholesale (model viewer, instanced field, picker, shader effect), read `recipes/`.

## The hard rule against hallucinated signatures

For any class, constructor option, method, or property **not** covered in a reference file,
do **not** guess it. Look it up:

```bash
node .claude/skills/threejs/scripts/docs_lookup.mjs GLTFLoader     # class → params/props/methods
node .claude/skills/threejs/scripts/docs_lookup.mjs standardmaterial   # partial/misspelled → suggests matches
node .claude/skills/threejs/scripts/docs_lookup.mjs --tsl uniform      # TSL (WebGPU shading) reference, by topic
```

A guessed three.js signature is the second-biggest failure mode after version drift. The
reference files curate the high-frequency ~20%; the long tail lives in the live docs on
purpose (mirroring them here would go stale within a month).

three.js now ships **LLM-first docs** and `docs_lookup.mjs` reads them: every class has a
clean markdown page at `threejs.org/docs/pages/<Class>.html.md`, TSL has a dedicated
reference, and `docs/llms.txt` + `docs/llms-full.txt` capture the project's own
code-generation guidance (which matches the invariants above). URLs are in
`assets/reference-data/version-map.json` → `docsResources`. When in doubt, these are ground
truth — and for a version-specific breaking change, check the migration guide linked there.

## Verify loop (the safe floor)

After generating or editing scene code, run the static validator. It's fast, needs no
runtime, and catches the greppable footguns (global `THREE`, removed APIs, wrong import
specifier for the chosen renderer, `ShaderMaterial`/`onBeforeCompile` under WebGPU, missing
color management, missing disposal).

```bash
node .claude/skills/threejs/scripts/validate.mjs ./path/to/scene.{js,ts,jsx,tsx}
```

Workflow: **scaffold → wire up the subsystem → `validate.mjs` → fix findings → (optional) build & run.**
`validate.mjs` is the required floor. A real headless render is out of scope for the safe
floor — trust `validate.mjs` plus a manual browser check for "does it actually paint."

## templates/ vs recipes/ — don't confuse them

- **`assets/templates/`** = *runnable scaffolds*. Copy the whole folder, `npm install`, `npm run dev`,
  and it renders. Minimal, correct, boring on purpose. `scaffold.mjs` copies from here. This is
  the starting skeleton.
- **`recipes/`** = *annotated walkthroughs*. Prose + code that teaches how to build one feature
  (a model viewer, an instanced field) and the reasoning behind each step. You adapt the code
  into an existing project; you don't `npm install` a recipe.

Rule of thumb: reach for a **template** to start a new project, a **recipe** to add a feature
to an existing one.
