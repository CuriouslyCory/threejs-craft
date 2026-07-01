# vanilla-webgpu-vite

**What this demonstrates:** the minimal correct three.js **WebGPU** setup with a real bundler —
a lit, rotating `MeshStandardMaterial` cube with `OrbitControls`, on `WebGPURenderer`, pinned to
three **0.185.1** and built with Vite **7**.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (typically http://localhost:5173) in a WebGPU-capable browser
(recent Chrome/Edge; see fallback note below).

Other scripts:

```bash
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

## Files

- `package.json` — pins `three@0.185.1` and `vite@^7`; `"type": "module"`.
- `index.html` — Vite entry point, loads `/src/main.js` as a module.
- `src/main.js` — the scene: `WebGPURenderer`, camera, lights, cube, `OrbitControls`, resize,
  render loop, and a `dispose()` teardown hook (also wired into Vite's HMR dispose).
- `.gitignore` — excludes `node_modules` and `dist`.

## WebGPU specifics (read this before you extend the demo)

- **Import specifier:** `import * as THREE from 'three/webgpu'` — not `'three'`. Mixing imports
  from `three` and `three/webgpu` in the same scene is unsupported; pick one per project.
- **Async init:** `WebGPURenderer` requests the GPU adapter/device asynchronously
  (`navigator.gpu.requestAdapter()` under the hood), unlike `WebGLRenderer` which is ready
  synchronously after construction. This template both `await renderer.init()`s before building
  the scene *and* drives the loop with `renderer.setAnimationLoop(...)` — see the comment in
  `src/main.js` for why both together is the documented-correct combination (skipping this is
  the classic "silently black canvas" bug).
- **Materials/shaders fork here.** `MeshStandardMaterial` (used in this template) works
  unchanged under `WebGPURenderer`. `ShaderMaterial`, `RawShaderMaterial`, and
  `onBeforeCompile` do **not** work on `WebGPURenderer` — for custom shaders on this path, use
  node materials + TSL (`import ... from 'three/tsl'`). This template intentionally stays on
  `MeshStandardMaterial` rather than hand-authoring a node material, to avoid guessing an exact
  TSL export name; see `references/shaders-tsl.md` in the skill when you're ready to go there.
- **Post-processing forks too.** `EffectComposer` + passes are the WebGL path only; WebGPU uses
  the node post-processing stack (`THREE.PostProcessing` + pass nodes).

## WebGL2 auto-fallback

`WebGPURenderer` automatically falls back to a WebGL2 backend when `navigator.gpu` is
unavailable (older browsers, some mobile browsers, WebGPU disabled) — so this template still
renders everywhere `vanilla-webgl-vite` does. Your TSL/node authoring code keeps working
unchanged on the fallback, but performance characteristics and some node features (e.g. compute
shaders) can differ from true WebGPU. Don't rely on WebGPU-only behavior without checking the
renderer's backend at runtime.
