# r3f-webgpu-vite

**What this demonstrates:** the minimal React Three Fiber scene wired to
`WebGPURenderer` (from `three/webgpu`) instead of the default
`WebGLRenderer` — a lit, rotating mesh using a node material
(`MeshStandardNodeMaterial`) and drei `<OrbitControls>`. Copy this folder as
the starting point for a WebGPU/TSL-flavored r3f scene.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (default `http://localhost:5173`).
`WebGPURenderer` auto-falls-back to WebGL2 in browsers without WebGPU
support, so this runs everywhere — but the authoring API (node materials,
TSL) is what you get either way.

```bash
npm run build     # production build to dist/
npm run preview   # preview the production build locally
```

## Stack

- react `19.2.x`, react-dom `19.2.x`
- three `0.185.1`
- @react-three/fiber `9.6.1`
- @react-three/drei `10.7.7`
- vite `^7`, @vitejs/plugin-react

r3f 9 requires `react` / `react-dom` **>=19 <19.3** as peer deps — don't bump
React past that range without checking `@react-three/fiber`'s peer
requirements first.

## The WebGPU wiring, explained

Three things differ from the plain WebGL template (`r3f-webgl-vite/`), all
in `src/App.jsx`:

1. **Import `three/webgpu`, not `three`.**
   ```js
   import * as THREE from "three/webgpu";
   ```
   This build exports `WebGPURenderer` and the "Node" material family
   (`MeshStandardNodeMaterial`, `MeshBasicNodeMaterial`, ...) that
   `WebGPURenderer`'s node-based pipeline requires. Per this skill's
   invariant 7, the classic `ShaderMaterial` / `RawShaderMaterial` /
   `onBeforeCompile` and `Mesh*Material` classes are WebGL-only — don't mix
   imports from `three` and `three/webgpu` in one scene.

2. **`extend(THREE)` before using any JSX tag from it.** r3f only ships
   built-in JSX intrinsics for the default `three` catalog; node materials
   have to be registered explicitly:
   ```js
   import { extend } from "@react-three/fiber";
   extend(THREE);
   ```
   This registers every export under its lowerCamelCase tag name, so
   `THREE.MeshStandardNodeMaterial` becomes `<meshStandardNodeMaterial>` in
   JSX — used in place of `<meshStandardMaterial>`, which throws under
   `WebGPURenderer` ("NodeMaterial: Material ... is not compatible").

3. **An async `gl` factory that awaits `renderer.init()`.**
   ```js
   gl={async (props) => {
     const renderer = new THREE.WebGPURenderer(props);
     await renderer.init();
     return renderer;
   }}
   ```
   `WebGLRenderer`'s context is ready synchronously; `WebGPURenderer` has to
   request the GPU adapter/device from the browser first
   (`navigator.gpu.requestAdapter()`), which is asynchronous. r3f v9's
   `gl` prop accepts an async factory and awaits it before starting the
   render loop, so this is the supported way to avoid racing the device
   handshake. Skipping `await renderer.init()` is a classic **silent black
   canvas with no console error** — see
   `references/renderers-and-setup.md` in this skill for the underlying
   three.js explanation (invariant 4).

This template intentionally uses plain lights instead of drei
`<Environment>` — Environment's default HDRI/PMREM pipeline targets the
WebGL path, and this template stays deliberately minimal rather than
guessing at its behavior under the node-material pipeline.

### If something here doesn't match current r3f behavior

r3f's WebGPU support is the most version-sensitive corner of this skill —
it moved fast across r3f v8 → v9 and is still evolving. If `extend(THREE)`,
the async `gl` factory, or the `MeshStandardNodeMaterial` JSX tag stop
working as installed:

- Re-check against the live `@react-three/fiber` docs before changing
  anything — don't guess a replacement API.
- See `references/react-three-fiber.md` in this skill for the router
  entry on r3f-specific gotchas.
- Run `node .claude/skills/threejs/scripts/doctor.mjs` to confirm the
  installed `@react-three/fiber` / `three` versions match this template's
  pins (`@react-three/fiber@9.6.1`, `three@0.185.1`) before assuming the
  pattern itself is wrong.

## Using this inside the Next.js 16 host app

This is a standalone Vite template, not a Next.js app. To drop the
`<Canvas>` scene into a Next.js (App Router) page:

1. Copy `src/App.jsx` (or its contents) into a component file marked as a
   Client Component:

   ```tsx
   // app/scene/three-scene.tsx
   "use client";

   import { Canvas, useFrame, extend } from "@react-three/fiber";
   import { OrbitControls } from "@react-three/drei";
   import * as THREE from "three/webgpu";
   // ...same component code as src/App.jsx
   ```

2. Import it with `next/dynamic` and `ssr: false` from the Server Component
   page that renders it — `@react-three/fiber` and `navigator.gpu` don't
   exist during server rendering:

   ```tsx
   // app/scene/page.tsx
   import dynamic from "next/dynamic";

   const ThreeScene = dynamic(() => import("./three-scene"), { ssr: false });

   export default function Page() {
     return <ThreeScene />;
   }
   ```

3. Install the same pinned dependencies (`three@0.185.1`,
   `@react-three/fiber@9.6.1`, `@react-three/drei@10.7.7`) in the host repo,
   respecting the React `>=19 <19.3` peer constraint above.
