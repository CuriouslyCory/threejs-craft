# Post-processing ★

Full-screen effects (bloom, DOF, outline, SSAO, tone-mapping-as-a-pass, custom color grading)
applied after the scene renders to a texture, rather than per-object in a material. This is one
of the hardest forks between renderer paths — **the WebGL pipeline (`EffectComposer` + passes)
and the WebGPU pipeline (node-based `PostProcessing`) are structurally different APIs, not just
different import paths** (invariant 7). Pick the one matching your renderer choice from
`references/renderers-and-setup.md`; don't mix them.

## Decision: which pipeline?

| Signal | Pipeline |
|---|---|
| `WebGLRenderer` (`three`) — the default path | `EffectComposer` + passes (`three/addons/postprocessing/*`) |
| `WebGPURenderer` (`three/webgpu`) | node-based `PostProcessing` (`three/webgpu` + `three/tsl`) |
| React/Next app, either renderer | `@react-three/postprocessing` — see r3f note below |

`EffectComposer` passes **do not run on `WebGPURenderer`** — they're built on WebGL-specific
render-target/shader plumbing. If you started on WebGL with `EffectComposer` and later switch
to `three/webgpu`, the post-processing stack has to be rewritten against the node pipeline, not
just re-imported.

## WebGL path: `EffectComposer`

### Import paths (from `assets/reference-data/addons-importmap.json` → `webglOnly`)

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
```

All of these are addons (not core `three` exports) — same "not in the npm package, ship as
source in `examples/jsm`" story as loaders/controls. Never hand-roll the composer/pass base
classes; use these.

### Structure: composer = ordered list of passes

`EffectComposer` owns a chain of render targets and runs each `Pass` in sequence, feeding one
pass's output texture into the next pass's input:

```js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.8,  // strength
  0.4,  // radius
  0.85, // threshold
);
composer.addPass(bloomPass);

composer.addPass(new OutputPass()); // must be last — see below

renderer.setAnimationLoop(() => {
  composer.render(); // replaces renderer.render(scene, camera)
});
```

Once you're using a composer, call `composer.render()` instead of `renderer.render(scene,
camera)` in the animation loop — the composer owns the final blit to the canvas.

### Why `OutputPass` goes last

`RenderPass` renders the scene into a linear HDR-range render target — tone mapping and
colorSpace conversion (`renderer.toneMapping` / `renderer.outputColorSpace` from
`references/renderers-and-setup.md`) normally happen as part of `renderer.render()`'s final
output stage, but that stage is bypassed while intermediate passes are working in linear space
(bloom, blur, and similar effects need to operate on linear HDR data, not already-tone-mapped
sRGB data, or they'll double up the curve and look wrong). `OutputPass` is what actually applies
tone mapping and colorSpace conversion at the *end* of the chain, once — omitting it, or putting
another pass after it, produces washed-out or incorrectly-toned output even though
`renderer.toneMapping` is set correctly. Rule: **`OutputPass` is always the last pass added.**

### Resize handling

The composer and every pass with an internal render-target size (bloom, SSAO, blur passes) need
to be resized alongside the renderer and camera (invariant 5) — the composer does not do this
automatically:

```js
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight); // passes with size-dependent buffers
}
window.addEventListener('resize', onResize);
```

Forgetting `composer.setSize` after a window resize is a common "post-fx looks blurry/wrong
resolution after resizing the browser" bug — the render targets stay at the old size while the
canvas itself resizes.

### Other common passes

- **`SMAAPass`** — post-process antialiasing; useful when `antialias: true` on the renderer
  isn't enough (e.g. you disabled MSAA for perf and want cheaper AA, or need AA on effects that
  MSAA doesn't cover).
- **`ShaderPass`** — wraps a custom `ShaderMaterial`-style shader (uniforms + fragment shader)
  as a full-screen pass; this is how you plug in bespoke color grading / custom effects into the
  composer chain. Signature and uniform wiring: verify with
  `scripts/docs_lookup.mjs ShaderPass` — don't guess the uniform naming convention.
- Other stock passes (SSAO, outline, DOF, film grain, etc.) live under
  `three/addons/postprocessing/*` following the same `new XPass(...)` + `composer.addPass()`
  pattern; look up exact constructor args per pass with `scripts/docs_lookup.mjs <PassName>`
  rather than assuming signatures are uniform across passes — they aren't.

## WebGPU path: node-based `PostProcessing`

WebGPU replaces the composer/pass object model with a **node graph**: you describe the
post-processing pipeline as a TSL expression (pass output → effect nodes → output), and
`THREE.PostProcessing` evaluates that graph, similar to how node materials replace
`ShaderMaterial` (see `references/shaders-tsl.md`).

```js
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const postProcessing = new THREE.PostProcessing(renderer);

const scenePass = pass(scene, camera);
const bloomNode = bloom(scenePass, 0.8, 0.4, 0.85); // strength/radius/threshold — verify exact signature

postProcessing.outputNode = scenePass.add(bloomNode);

renderer.setAnimationLoop(() => {
  postProcessing.render(); // replaces renderer.render(scene, camera)
});
```

This is the **documented shape** of the API (per `assets/reference-data/addons-importmap.json`
→ `webgpuOnly`), not a signature guaranteed byte-for-byte stable across three.js releases — the
node post-processing stack is newer and moves faster than the WebGL composer API. Treat the
above as a pattern to adapt, and **verify the exact `PostProcessing` API and `bloom()` signature**
with `scripts/docs_lookup.mjs PostProcessing` and current three.js WebGPU examples before
shipping — don't hand-extend this snippet with guessed node names.

Key differences from the WebGL path:

- No separate "add a resize call to every pass" step in the same way — node-based passes
  generally derive their render-target sizing from the renderer, but still verify resize
  behavior for any effect node holding its own internal buffers (e.g. bloom's blur mip chain).
- Tone mapping/colorSpace output handling is part of the renderer's node pipeline, not a
  bolted-on final pass like `OutputPass` — but exactly how/where to set it in a custom
  `outputNode` graph is version-sensitive; check `scripts/docs_lookup.mjs PostProcessing` if
  output looks untone-mapped.
- `mrt()` (multiple render targets) from `three/tsl` lets a single scene pass output several
  buffers at once (e.g. color + normal + depth) for effects that need more than color input
  (SSAO-style effects); this has no direct `EffectComposer` equivalent — WebGL SSAO passes
  typically re-render extra passes instead.

## r3f: `@react-three/postprocessing`

In a React Three Fiber app, don't hand-wire `EffectComposer` imperatively — use
`@react-three/postprocessing` (pmndrs' React wrapper around the [`postprocessing`] library,
*not* three.js's own `EffectComposer`/addons passes) for the WebGL path:

```jsx
import { EffectComposer, Bloom, Noise } from '@react-three/postprocessing';

<Canvas>
  {/* scene contents */}
  <EffectComposer>
    <Bloom intensity={0.8} luminanceThreshold={0.4} />
    <Noise opacity={0.02} />
  </EffectComposer>
</Canvas>
```

This is a different underlying implementation from `three/addons/postprocessing/*` (the
`postprocessing` npm package has its own pass architecture, generally considered higher
performance than three.js's stock `EffectComposer`), so effect names and prop shapes don't map
1:1 onto the vanilla `UnrealBloomPass`-style API above — treat it as its own surface. For the
WebGPU + r3f combination, node-based post-processing in r3f is newer/less standardized; verify
current support via `scripts/docs_lookup.mjs PostProcessing` and the r3f docs before assuming a
JSX wrapper exists. Full r3f setup (Canvas, hooks, WebGPU renderer wiring):
`references/react-three-fiber.md`.

## See also

- `references/renderers-and-setup.md` ★ — renderer choice, tone mapping, resize
- `references/shaders-tsl.md` ★ — TSL node basics that `bloom()`/custom effect nodes build on
- `references/shaders-glsl.md` ★ — `ShaderPass`/custom `ShaderMaterial` for bespoke WebGL effects
- `references/react-three-fiber.md` ★ — `@react-three/postprocessing` in a Next.js app
