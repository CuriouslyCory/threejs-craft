# React Three Fiber (r3f) & drei ★

The highest-value file in **this repo** — a Next.js 16 + React 19 app defaults to r3f per
`SKILL.md` decision gate 2. This file covers the r3f/drei authoring layer on top of `three`;
the underlying renderer/scene/material/loader concepts are unchanged and documented in their
own sibling files — this file maps them into JSX, it doesn't re-explain them.

## Table of contents

- [Mental model](#mental-model)
- [`<Canvas>`](#canvas)
- [Declaring objects: args, props, attach](#declaring-objects-args-props-attach)
- [The `extend()` escape hatch](#the-extend-escape-hatch)
- [Core hooks](#core-hooks)
- [drei essentials](#drei-essentials)
- [Disposal](#disposal)
- [Next.js integration (this repo)](#nextjs-integration-this-repo)
- [WebGPU in r3f](#webgpu-in-r3f)
- [Mapping vanilla subsystems into r3f](#mapping-vanilla-subsystems-into-r3f)
- [Minimal working example](#minimal-working-example)

## Mental model

JSX in r3f **is** the three.js scene graph — `<mesh>` isn't a wrapper around `THREE.Mesh`, it
*is* a `THREE.Mesh` instance, created and configured by r3f's reconciler and inserted into the
real `Scene` graph maintained underneath. Nesting JSX nests `Object3D`s the same way
`parent.add(child)` would (`references/core-scenegraph.md`); component boundaries are just JS
organization, not scene-graph structure. Lowercase JSX tags (`<mesh>`, `<boxGeometry>`,
`<meshStandardMaterial>`) map to `THREE.Mesh`, `THREE.BoxGeometry`, `THREE.MeshStandardMaterial`
by naming convention — camelCase the class name. This mapping is r3f's core trick and is why
almost the entire `three` API surface "just works" in JSX with zero explicit binding code.

## `<Canvas>`

`<Canvas>` is the root component: it creates the `WebGLRenderer` (or a custom renderer via
`gl`, see WebGPU section below), a default `Scene`, a default `PerspectiveCamera`, sets up
resize handling, and starts the render loop — everything `references/renderers-and-setup.md`'s
vanilla skeleton does by hand, `<Canvas>` does for you, already holding all 7 invariants out of
the box (ESM, `setAnimationLoop` internally, resize wired to its container, `SRGBColorSpace` +
`ACESFilmicToneMapping` defaults, automatic disposal on unmount).

```jsx
<Canvas
  camera={{ position: [3, 2, 4], fov: 50 }}   // constructs the default PerspectiveCamera
  gl={{ antialias: true }}                     // forwarded to the WebGLRenderer constructor
  shadows                                      // enables renderer.shadowMap
  dpr={[1, 2]}                                 // pixel ratio clamp — [min, max], same idea as invariant 5
>
  {/* scene JSX */}
</Canvas>
```

Key props: `camera` (object = construct a default camera with these props, or pass a `<camera>`
element as a child instead for full control), `gl` (renderer constructor options, or a factory
function — see WebGPU below), `shadows` (bool or shadow-map-type string), `dpr` (pixel ratio,
array form clamps like `Math.min(devicePixelRatio, 2)`), `frameloop` (`"always"` default |
`"demand"` | `"never"` — see `references/performance.md` for render-on-demand), `scene`
(pass an existing `THREE.Scene` instead of letting Canvas create one). Full prop list: verify
uncommon ones with `scripts/docs_lookup.mjs Canvas` — r3f's own docs are the authority here more
than three.js's, since `Canvas` is an r3f concept with no direct three.js class.

## Declaring objects: args, props, attach

- **`args`** — constructor arguments, passed as an array, because JSX props are named and three
  constructors are positional: `<boxGeometry args={[1, 1, 1]} />` → `new THREE.BoxGeometry(1, 1,
  1)`. Changing `args` **recreates** the underlying instance (r3f can't hot-patch constructor
  params); changing a regular prop **mutates** the existing instance in place. This distinction
  matters for perf — don't put a frequently-changing value in `args` if a prop assignment would
  do.
- **Props** — anything that isn't `args` is set as a property (or called as a method, for
  vector-like properties — see below) on the created instance after construction:
  `<mesh position={[0, 1, 0]} />` sets `mesh.position`. r3f is smart about `Vector3`/`Euler`/
  `Color`-typed properties: passing an array (`position={[0, 1, 0]}`) or a number
  (`intensity={1.2}`) calls `.set(...)` under the hood rather than replacing the object
  reference, so reactivity keeps working correctly.
- **`attach`** — controls *where* on the parent this object is assigned, beyond default
  child-array insertion. `<meshStandardMaterial attach="material" />` inside a `<mesh>` sets
  `mesh.material = <instance>` rather than adding it as a scene-graph child (materials/
  geometries aren't `Object3D`s and don't belong in `children`). Most built-in elements
  (`*Geometry`, `*Material`) already have the correct default `attach` inferred from their name
  — you only specify it explicitly for non-standard attachment points (e.g. attaching a render
  target texture to a specific uniform).

```jsx
<mesh position={[0, 1, 0]} rotation={[0, Math.PI / 4, 0]}>
  <boxGeometry args={[1, 1, 1]} />
  <meshStandardMaterial color="royalblue" roughness={0.4} />
</mesh>
```

## The `extend()` escape hatch

Not every three.js class (and definitely not every addon or third-party class) has a built-in
JSX tag — r3f only auto-registers core `THREE.*` exports. For anything else (addons like
`OrbitControls` if not using drei's wrapper, custom `ShaderMaterial` subclasses, a class from a
physics/particle library), register it once with `extend()` to make it available as a lowercase
JSX tag:

```jsx
import { extend } from '@react-three/fiber';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

extend({ TextGeometry });
// now usable as: <textGeometry args={[...]} />
```

Call `extend()` at module scope (once, not per-render). This is also how custom `ShaderMaterial`/
node-material subclasses become JSX-usable — declare the class, `extend()` it, then use it like
any built-in material tag. See `references/shaders-glsl.md` / `references/shaders-tsl.md` for
the material classes themselves.

## Core hooks

- **`useThree()`** — read the current `{ camera, scene, gl (renderer), size, viewport, clock,
  invalidate, ... }` from anywhere inside `<Canvas>`. This is how you reach the renderer/camera/
  scene imperatively without prop-drilling — e.g. `const { gl } = useThree()` to read
  `renderer.info` for `references/performance.md`-style profiling.
- **`useFrame((state, delta) => { ... })`** — **this IS the render loop.** Every mounted
  `useFrame` callback runs once per frame, driven by r3f's single internal
  `setAnimationLoop` call (invariant 4 is already satisfied for you — never call
  `renderer.setAnimationLoop` or `requestAnimationFrame` yourself inside an r3f app). `state` is
  the same shape as `useThree()`'s return value; `delta` is seconds since the last frame — use it
  to scale animation speed frame-rate-independently (`mesh.rotation.y += delta * 0.5`, not a
  fixed per-frame increment). Mutate refs directly in `useFrame` rather than `useState` —
  driving animation through React state/re-render every frame defeats the purpose and is
  measurably slower; r3f's whole performance model assumes imperative mutation inside
  `useFrame` and declarative JSX for everything else.
- **`useLoader(Loader, url)`** — load an asset with any three.js loader (`GLTFLoader`,
  `TextureLoader`, `RGBELoader`, ...), cached by `(Loader, url)` so repeated calls for the same
  asset don't re-fetch. Suspends — wrap the consuming component in `<Suspense
  fallback={...}>` so React shows a fallback while loading rather than rendering with an
  undefined result:

  ```jsx
  function Model() {
    const gltf = useLoader(GLTFLoader, '/model.glb');
    return <primitive object={gltf.scene} />;
  }

  <Suspense fallback={null}>
    <Model />
  </Suspense>
  ```

  For Draco/KTX2-compressed GLTF needing extra loader configuration, pass a third `extensions`
  callback argument to configure the loader instance before it loads — see
  `references/loaders-and-assets.md` for the decoder-wiring details (same underlying
  `GLTFLoader.setDRACOLoader`/`setKTX2Loader` calls, just invoked through `useLoader`'s
  configure callback instead of by hand).
- **`invalidate()`** (from `useThree()`, or imported standalone) — manually request one more
  render when `<Canvas frameloop="demand">` is active. r3f already invalidates automatically for
  prop changes within its own reactive JSX tree and for drei `OrbitControls` interaction; call
  `invalidate()` yourself when something outside r3f's reactivity changed the scene (an external
  animation library tick, a WebSocket-driven data update mutating a ref directly). See
  `references/performance.md` for the full render-on-demand rationale.

## drei essentials

`@react-three/drei` is a large collection of pre-built r3f components/hooks wrapping common
three.js patterns so you don't hand-roll them. High-frequency ones:

| Component | Wraps | Notes |
|---|---|---|
| `OrbitControls` | `three/addons/controls/OrbitControls.js` | Auto-wires to the Canvas's camera/renderer DOM element and the render loop; no manual `.update()` call needed like vanilla. |
| `Environment` | PMREM-processed HDRI / preset IBL | `<Environment preset="city" />` for a quick physically-plausible lighting setup; see `references/lighting-and-env.md` for PMREM/IBL fundamentals. |
| `useGLTF` / `<Gltf>` | `GLTFLoader` (+ Draco/KTX2 auto-configured) | `useGLTF(url)` is a `useLoader` convenience specialization with sane decoder defaults already wired; `useGLTF.preload(url)` warms the cache before the component mounts. |
| `Html` | `Vector3.project(camera)` + DOM sync | Positions real DOM content at a 3D world point, staying in sync every frame — see `references/interaction.md` for the underlying projection math this replaces. |
| `Bounds` | camera-fit-to-content math | Wrap content in `<Bounds fit clip observe>` to auto-frame the camera to whatever's inside, useful for model viewers with unknown content extents. |
| `Center` | bounding-box centering | Recenters children around the origin without you computing a bounding box by hand. |
| `ContactShadows` | baked blob-shadow render target | Cheap fake ground shadow, much less costly than a real shadow-casting light for a simple "grounded" look. |
| `PerspectiveCamera` (drei) | `THREE.PerspectiveCamera` as a JSX-settable/`makeDefault` camera | Use when you need a camera that isn't the Canvas's implicit default, or want to switch active cameras at runtime via `makeDefault`. |
| `Stats` | `three/addons/libs/stats.module.js` | Drop-in FPS/ms overlay — JSX wrapper around the same stats.js from `references/performance.md`. |

This table is the ~20% covering most scenes. drei has many more components (postprocessing
wrappers, physics helpers, text, cameras, staging); for anything not listed here, check the
drei README/docs rather than guessing a prop shape — drei's API surface changes across major
versions independent of three.js's own version.

## Disposal

Mostly automatic (invariant 6) — this is one of r3f's biggest ergonomic wins over vanilla.
Unmounting a component whose JSX created geometries/materials/textures (`<boxGeometry>`,
`<meshStandardMaterial>`, etc.) disposes them automatically; unmounting `<Canvas>` disposes the
renderer/context too.

**Exceptions — you still own disposal for:**
- Objects constructed **imperatively** outside JSX (inside a `useEffect`, a ref callback, or a
  plain `new THREE.Texture(...)` you attach manually) — r3f only tracks what it created.
- Resources shared/cached across components (e.g. `useLoader`'s cache, or a texture atlas you
  intentionally keep alive across unmounts) — disposing on every unmount would break the sharing;
  you manage the lifecycle explicitly instead.
- Anything you pass into r3f via `<primitive object={...} />` — `primitive` attaches an
  already-constructed object (common for `gltf.scene` from `useGLTF`) but does **not** assume
  ownership for disposal the same way a native JSX element does; verify per-case whether the
  loader's own cache handles it or you need a manual `dispose()` in a cleanup effect.

## Next.js integration (this repo)

`<Canvas>` touches `window`, creates a `WebGLRenderer`, and runs a continuous render loop — none
of that can run during server rendering. Three requirements, all standard Next.js App Router
patterns:

1. **Mark the Canvas-owning component `'use client'`.** Any file that imports
   `@react-three/fiber`/`drei` and renders `<Canvas>` needs the directive at the top of the file
   (or a client-marked ancestor already covers it).
2. **Disable SSR for it explicitly**, even inside a Client Component — `<Canvas>` still runs
   during the client-render pass of SSR/hydration unless excluded, which can throw on `window`/
   `WebGL` access during the server pass. Use `next/dynamic` with `ssr: false`:

   ```tsx
   'use client';
   import dynamic from 'next/dynamic';

   const Scene = dynamic(() => import('./Scene'), { ssr: false });

   export default function Page() {
     return <Scene />;
   }
   ```

   This repo is Next.js 16 App Router — verify `next/dynamic`'s `ssr: false` option is still
   supported for the component you're wrapping (App Router moved some dynamic-import behavior
   around across Next major versions); if it errors, the fallback is a plain client-only mount
   guard (`useEffect` flipping a `mounted` state before rendering `<Canvas>`).
3. **React 19 + StrictMode double-invoke.** Dev-mode StrictMode mounts/unmounts/remounts once to
   surface effect-cleanup bugs. r3f's own Canvas lifecycle handles this correctly; the gotcha is
   in *your* effects that touch resources outside r3f's declarative tree — see the full writeup
   in `references/debugging-and-gotchas.md` under "React Three Fiber-specific gotchas." Always
   return a cleanup function from any effect that allocates a GPU resource imperatively.

Once inside the client boundary, everything else in this file behaves identically to any other
React app — Next.js's App Router/RSC split only affects *where* the Canvas boundary starts, not
r3f's internals.

## WebGPU in r3f

Pass a custom renderer via `Canvas`'s `gl` prop as an **async factory function** that constructs
a `WebGPURenderer` and awaits its init handshake before r3f proceeds — mirroring the vanilla
`await renderer.init()` requirement from `references/renderers-and-setup.md`:

```jsx
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three/webgpu';

<Canvas
  gl={async (props) => {
    const renderer = new THREE.WebGPURenderer(props);
    await renderer.init();
    return renderer;
  }}
>
  {/* scene using node materials / TSL — see references/shaders-tsl.md */}
</Canvas>
```

This is the **documented pattern**, not a signature guaranteed stable across r3f minor versions
— async `gl` factory support and exactly how r3f awaits it have shifted before. Treat the above
as a starting point and **verify against `assets/templates/r3f-webgpu-vite/` and current r3f
docs** before relying on it in a real build; if the template doesn't exist yet in this skill,
fall back to `scripts/docs_lookup.mjs Canvas` plus the r3f GitHub examples for the current
WebGPU wiring. Once the renderer is up, node materials/TSL (`references/shaders-tsl.md`) and
node-based post-processing (`references/postprocessing.md`) work the same way they do in
vanilla three/webgpu — r3f doesn't change the TSL authoring model, only how the renderer gets
constructed.

## Mapping vanilla subsystems into r3f

| Vanilla concept | r3f equivalent |
|---|---|
| `new THREE.Mesh(geo, mat); scene.add(mesh)` | `<mesh><boxGeometry /><meshStandardMaterial /></mesh>` |
| `new THREE.DirectionalLight(...)` + `scene.add` | `<directionalLight position={[...]} intensity={...} />` |
| `GLTFLoader().load(url, cb)` | `useLoader(GLTFLoader, url)` or drei's `useGLTF(url)`, both Suspense-based |
| `raycaster.intersectObjects(...)` + manual pointer wiring | JSX pointer event props directly on a mesh: `onClick`, `onPointerOver`, `onPointerOut`, `onPointerMove` — see `references/interaction.md`, the "React Three Fiber note" |
| `renderer.setAnimationLoop(animate)` | `useFrame((state, delta) => { ... })` — never call `setAnimationLoop` yourself in r3f |
| `orbitControls.update()` in the render loop | drei `<OrbitControls />` — self-updating, no manual call |
| Manual `.dispose()` calls on unmount | Mostly automatic — see Disposal above |

`onPointerOver`/`onPointerOut`/`onClick` etc. fire per-object based on r3f's internal raycasting
against whatever's under the pointer, including propagation/bubbling semantics similar to DOM
events (`event.stopPropagation()` works to stop a hit from also triggering handlers on objects
behind it along the ray). This replaces hand-rolled `Raycaster` + NDC math entirely for
interactive meshes — reach for a manual `useThree().raycaster` only for non-mesh-target picking
(e.g. raycasting against an infinite ground plane that isn't itself an interactive element).

## Minimal working example

```jsx
'use client';
import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';

function Spinner() {
  const ref = useRef(null);
  useFrame((_state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.6;
  });
  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#5b8def" roughness={0.4} />
    </mesh>
  );
}

export default function Scene() {
  return (
    <Canvas camera={{ position: [3, 2, 4], fov: 50 }} shadows>
      <Suspense fallback={null}>
        <Environment preset="city" />
      </Suspense>
      <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
      <ambientLight intensity={0.2} />
      <Spinner />
      <OrbitControls enableDamping />
    </Canvas>
  );
}
```

For a full runnable scaffold (package.json, Vite config, entry point) rather than a single
component, copy `assets/templates/r3f-webgl-vite/` via `scripts/scaffold.mjs` — it's the same
shape as the example above, wired into a standalone project. For this repo's Next.js
integration specifically, wrap the equivalent component per the Next.js section above.

## See also

- `references/renderers-and-setup.md` ★ — what `<Canvas>` sets up for you under the hood
- `references/interaction.md` — raycasting fundamentals that r3f's pointer events wrap
- `references/performance.md` — `frameloop="demand"`, `renderer.info` via `useThree().gl.info`
- `references/postprocessing.md` ★ — `@react-three/postprocessing` in r3f
- `references/shaders-tsl.md` ★ — node materials/TSL for the r3f WebGPU path
- `references/debugging-and-gotchas.md` ★ — Canvas zero-height, StrictMode double-mount
- `references/xr.md` — `@react-three/xr` for WebXR in r3f
