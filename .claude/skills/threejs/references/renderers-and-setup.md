# Renderers & Setup ★

The renderer choice forks everything downstream (materials, shaders, post-processing — see
`references/materials.md`, `references/shaders-glsl.md`, `references/shaders-tsl.md`,
`references/postprocessing.md`). This file covers only the renderer itself: init, the render
loop, resize, and color/tone mapping. If the canvas is still black after following this, jump
to `references/debugging-and-gotchas.md`.

## Decision: which import do I use?

| Signal | Import | Renderer class |
|---|---|---|
| default, broadest compatibility, existing GLSL shaders | `three` | `WebGLRenderer` |
| TSL / node materials, compute shaders, cutting-edge post-fx | `three/webgpu` | `WebGPURenderer` |

`WebGPURenderer` auto-falls-back to WebGL2 on a device without WebGPU — so choosing
`three/webgpu` doesn't cost you browser reach, but it **does** commit you to the node-material
/ TSL authoring style. `ShaderMaterial`, `RawShaderMaterial`, and `onBeforeCompile` are
WebGL-only (invariant 7). Don't mix imports from `three` and `three/webgpu` in the same scene
— pick one per project. See `assets/reference-data/version-map.json` for the exact pinned
specifiers.

## Why WebGPU needs `await renderer.init()`

`WebGLRenderer`'s context is created synchronously in the constructor — you can call
`.render()` on the next line. `WebGPURenderer` requests the GPU adapter/device from the
browser, which is an **async** handshake (`navigator.gpu.requestAdapter()` under the hood).
If you call `.render()` before that handshake resolves, the call either no-ops or throws,
depending on version — the classic symptom is a **silently black canvas with no console
error**. Two ways to be correct:

1. **Explicit init** — `await renderer.init()` before the first render call. Best when you
   need the first frame to be correct immediately (screenshots, non-looping renders).
2. **`setAnimationLoop`** — pass your render callback to `renderer.setAnimationLoop(animate)`
   instead of calling `.render()` directly. The renderer internally waits for init before
   invoking your callback, so you never race the handshake. This is invariant 4 and is
   already mandatory for WebXR, so it's the natural default for both paths.

In practice: **always use `setAnimationLoop`** (never raw `requestAnimationFrame`), and
additionally `await renderer.init()` first if you need one-shot control or want init errors to
surface as a rejected promise instead of a silent no-render.

## Minimal end-to-end skeleton — side by side

Both skeletons hold all 7 invariants: ESM imports, resize handling, `setAnimationLoop`,
explicit color management, and a `dispose()` path for teardown.

### WebGL (`three`)

```js
import * as THREE from 'three';

const canvas = document.querySelector('#app');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 1, 5);

// ...add lights, geometry, materials here...

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});

// Teardown (route unmount / page navigation here):
function dispose() {
  renderer.setAnimationLoop(null);
  window.removeEventListener('resize', onResize);
  renderer.dispose();
  // also dispose geometries/materials/textures you created — see invariant 6
}
```

### WebGPU (`three/webgpu`)

```js
import * as THREE from 'three/webgpu';

const canvas = document.querySelector('#app');

const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

await renderer.init(); // async device handshake — see "Why WebGPU needs..." above

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 1, 5);

// ...add lights, node materials, geometry here (TSL: `three/tsl`)...

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});

// Teardown:
function dispose() {
  renderer.setAnimationLoop(null);
  window.removeEventListener('resize', onResize);
  renderer.dispose();
}
```

The only structural difference is the import specifier and the `await renderer.init()` line —
everything else (scene, camera, resize, loop, color management) is identical. That symmetry is
deliberate: it's why the renderer choice is a single decision gate rather than two divergent
codebases.

## WebGL2 auto-fallback

`WebGLRenderer` targets WebGL2 automatically when the browser supports it (all evergreen
browsers do) and falls back to WebGL1 only on old/embedded browsers — you don't opt into this,
there's no constructor flag. `WebGPURenderer` has its own, separate fallback: if
`navigator.gpu` is unavailable, it internally renders through a WebGL2 backend so your TSL/node
code keeps working, but performance characteristics and some node features can differ from true
WebGPU. Don't rely on WebGPU-only behavior (e.g. compute shaders) without checking
`renderer.backend.isWebGPUBackend` or equivalent — verify the exact property with
`scripts/docs_lookup.mjs WebGPURenderer`.

## `setPixelRatio` and `setSize`

```js
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // clamp — see below
renderer.setSize(width, height); // updateStyle=true by default: sets CSS width/height too
```

- **Clamp the pixel ratio.** Retina/4K displays report `devicePixelRatio` of 2–3+; rendering
  at full device resolution on a 3x display is ~9x the fragment work of 1x for no perceptible
  gain past ~2x. `Math.min(devicePixelRatio, 2)` is the standard clamp.
- **`setSize` drives layout too.** By default it sets the canvas's CSS `width`/`height` in
  addition to the drawing-buffer resolution. If you're embedding the canvas in a container
  that already controls size via CSS (e.g. `position: absolute; inset: 0`), pass
  `renderer.setSize(width, height, false)` to skip the style writes and avoid fighting your
  layout.
- Call both on resize, not just once at startup (invariant 5) — see the skeletons above.

## Color management & tone mapping

Set these once on the renderer, not per-material:

```js
renderer.outputColorSpace = THREE.SRGBColorSpace; // default since r152; be explicit anyway
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // brightness dial once tone mapping is on
```

`toneMapping` options (all on `THREE.*`): `NoToneMapping` (raw linear→sRGB, no filmic
rolloff — highlights clip harshly), `LinearToneMapping`, `ReinhardToneMapping`,
`CineonToneMapping`, `ACESFilmicToneMapping` (industry-standard filmic curve, good default for
PBR scenes with HDR lighting), `AgXToneMapping` (newer, better highlight desaturation —
increasingly preferred over ACES for scenes with bright/saturated lights). Try `AgXToneMapping`
if ACES is blowing out colors specifically.

Tone mapping only matters once your scene has HDR-range lighting (multiple lights, bright
environment maps) — a flat-lit scene with `NoToneMapping` can look fine. But leaving it off by
accident when you *do* have bright lights is a common washed-out/blown-out symptom; see
`references/debugging-and-gotchas.md` for the full triage.

Per-texture, set `colorSpace` explicitly (invariant 3) — that's covered in depth in
`references/textures.md`; the short version: `SRGBColorSpace` for albedo/emissive/env color
textures, leave normal/roughness/metalness/AO textures at their default linear space.

## `antialias` and transparent/alpha canvas

```js
new THREE.WebGLRenderer({ antialias: true, alpha: true });
```

- `antialias: true` enables MSAA on the default framebuffer. It's a constructor-only option
  (can't be toggled after creation) and costs GPU time proportional to sample count — leave it
  off for performance-critical mobile targets and lean on post-process AA (SMAA) instead if
  needed.
- `alpha: true` makes the canvas's clear color transparent so page content behind it shows
  through — needed for compositing a 3D scene over an HTML background. Pair with
  `renderer.setClearColor(0x000000, 0)` if you need to be explicit about the clear alpha, and
  make sure nothing (e.g. a full-screen background mesh) is unintentionally opaque.
- `WebGPURenderer` accepts the same `antialias`/`alpha` constructor options; MSAA sample count
  handling differs internally but the surface API matches.

## Import-map (no-bundler) path vs Vite

Both paths use the **same code** — the only difference is how the bare specifiers `three`,
`three/webgpu`, `three/tsl`, and `three/addons/*` resolve.

**Vite / bundler path (default):** `three` is an npm dependency; imports resolve through
`node_modules` via the package's `exports` map. Nothing special to configure.

**Import-map path (single HTML file, no build step):** declare the specifiers explicitly in a
`<script type="importmap">` before your module script, pointing at a CDN build. Pull the exact
pinned URLs from `assets/reference-data/version-map.json` → `cdnImportmap` rather than
hand-typing a version:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.tsl.js"
  }
}
</script>
<script type="module" src="./main.js"></script>
```

Note the **trailing slash** on `"three/addons/"` — it's a prefix mapping, so
`import { OrbitControls } from 'three/addons/controls/OrbitControls.js'` resolves against the
CDN's `examples/jsm/` folder. Only pull in `three/webgpu` / `three/tsl` entries if you're
actually on the WebGPU path — no need to map specifiers you don't import. See
`assets/reference-data/addons-importmap.json` for per-addon paths (controls, loaders,
post-processing) and which ones are WebGL-only vs WebGPU-only.

## WebGL vs WebGPU — quick comparison

| | WebGL (`three`) | WebGPU (`three/webgpu`) |
|---|---|---|
| Renderer class | `WebGLRenderer` | `WebGPURenderer` |
| Init | synchronous, ready after constructor | async — `await renderer.init()` and/or `setAnimationLoop` |
| Custom shaders | `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` (GLSL) | node materials + TSL (`three/tsl`) — see `references/shaders-tsl.md` |
| Post-processing | `EffectComposer` + passes (`three/addons/postprocessing/*`) | node post-processing (`THREE.PostProcessing` + pass nodes) |
| Fallback | WebGL1 on very old browsers (automatic) | WebGL2 backend if no `navigator.gpu` (automatic) |
| Browser support | universal | modern evergreen only (pre-fallback) |
| Compute shaders | not supported | supported (native use case) |

## Next steps

- Colors look wrong, canvas is black, or nothing renders → `references/debugging-and-gotchas.md`
- Building the scene graph (Object3D, groups, transforms) → `references/core-scenegraph.md`
- Choosing a camera / adding OrbitControls → `references/cameras-and-controls.md`
- In a React/Next app → `references/react-three-fiber.md` (the `<Canvas>` component wraps
  most of this setup for you, but the same invariants apply underneath)
