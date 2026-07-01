# Custom shaders on WebGPU — TSL, node materials ★

★ **WebGPU (node) path.** Everything in this file targets `WebGPURenderer`
(`import * as THREE from 'three/webgpu'`) and the Three Shading Language
(`import { ... } from 'three/tsl'`). It does **not** apply to `WebGLRenderer` — `ShaderMaterial`,
`RawShaderMaterial`, and `onBeforeCompile` are WebGL-only (invariant 7) and don't exist in the
node-material world. If the project targets plain `three` (WebGL), stop here and read
`references/shaders-glsl.md` instead. If you're not sure which renderer you're targeting,
resolve that first in `SKILL.md` decision gate 1.

**TSL evolves fast** — node names and helper signatures shift release to release more than
core three.js API does. This file teaches the **pattern and mental model**, deliberately
avoids being an exhaustive node catalog, and repeatedly tells you to confirm exact node names
against `scripts/docs_lookup.mjs` and the live TSL docs before shipping. A guessed TSL node
name is the shader-authoring version of invariant-breaking: it fails at build/runtime, not
silently, but it still burns a cycle you can skip by checking first.

## The node-material mental model

Instead of writing a GLSL string, you build a **node graph**: small composable node objects
(`uniform()`, `texture()`, `positionWorld`, math functions like `mix()`/`sin()`) that you wire
together in JS/TS, then assign to slots on a **node material**
(`MeshStandardNodeMaterial`, or the node-ified form of the standard materials under
`three/webgpu`). The renderer compiles that graph down to WGSL (native WebGPU) or GLSL (when
`WebGPURenderer` is running its WebGL2 fallback) — you never write either target language
directly.

```js
import * as THREE from 'three/webgpu';
import { Fn, uniform, vec3, mix, sin, time, positionWorld, uv } from 'three/tsl';

const material = new THREE.MeshStandardNodeMaterial();
const uColor = uniform(new THREE.Color(0x3388ff));

material.colorNode = Fn(() => {
  const pulse = sin(time.mul(2.0).add(positionWorld.x)).mul(0.5).add(0.5);
  return vec3(uColor).mul(pulse);
})();
```

Key mental shift from GLSL: node graph expressions are **built once in JS** (at material setup
time), not re-evaluated as text per frame. The graph *describes* the computation; the renderer
compiles it once and runs the compiled shader per-vertex/per-fragment on the GPU, same as any
other shader — you're not paying JS-eval cost per frame, only graph-construction cost once.

## `Fn(() => {...})` and swizzles

`Fn` wraps a JS function into a node-graph function — the body runs once at graph-construction
time, building up node objects rather than computing plain numbers. Arithmetic on nodes uses
**method chaining**, not operators (`a.mul(b)` not `a * b`, `a.add(b)` not `a + b`) because JS
doesn't support operator overloading:

```js
const wobble = Fn(() => {
  const n = sin(positionWorld.x.mul(4.0).add(time));
  return n.mul(0.1);
})();
```

Vector nodes support GLSL-style **swizzles** as properties: `someVec3.xyz`, `someVec4.rgb`,
`someVec3.x`, reassignable in some contexts (`.assign()` / destructuring patterns vary by TSL
version) — verify current swizzle-write syntax with `scripts/docs_lookup.mjs` before relying on
it beyond simple reads.

## `uniform()` — CPU→GPU values you update per frame

```js
const uTime = uniform(0);              // float uniform, starting value 0
const uColor = uniform(new THREE.Color(0x3388ff)); // vec3 uniform from a Color

renderer.setAnimationLoop(() => {
  uTime.value = performance.now() / 1000; // mutate .value, same pattern as ShaderMaterial uniforms
  renderer.render(scene, camera);
});
```

`uniform()` infers the node type from the JS value you pass it (number → float, `Vector3`/
`Color` → vec3, `Vector2` → vec2, etc.) and returns a node you can plug into any graph
expression; update it per frame via `.value`, mirroring the `{ value }` pattern from
`ShaderMaterial` uniforms in `references/shaders-glsl.md` — same mutate-in-place discipline,
different wrapper. Many built-ins (`time`, discussed below) are provided **pre-wired** so you
often don't need to build your own time uniform at all.

## Assigning node slots on a node material

Node materials expose named slots you assign compiled node graphs to, instead of a monolithic
shader string:

| Slot | Replaces (GLSL mental model) |
|---|---|
| `material.colorNode` | base/albedo color output |
| `material.positionNode` | vertex position displacement |
| `material.emissiveNode` | emissive contribution |
| `material.normalNode` | normal perturbation (e.g. procedural bump) |
| `material.outputNode` | final fragment output override (less common — usually you only need `colorNode`) |

```js
material.positionNode = Fn(() => {
  const displaced = positionLocal.add(vec3(0, sin(time.add(positionLocal.x)).mul(0.2), 0));
  return displaced;
})();
```

Assign only the slots you need — an unassigned slot falls back to the node material's normal
PBR-derived behavior (e.g. leaving `colorNode` unset on a `MeshStandardNodeMaterial` still
gives you the material's `color`/`map` driven appearance). This is the node-material analogue
of `onBeforeCompile` patching a built-in material, but structured and versioned rather than a
string-replace against internal chunk names — a real advantage over the GLSL path's fragility.

## Built-in nodes worth knowing by name

Import from `three/tsl`. Treat this list as "the ones stable enough to name here," not
exhaustive — confirm anything beyond this set with `scripts/docs_lookup.mjs` or the live TSL
docs before using it:

- **`uv`** — the primary UV coordinate node (vec2), fragment/vertex context-aware.
- **`positionLocal`** / **`positionWorld`** — vertex position in local vs world space (vec3);
  use `positionWorld` for effects that should stay consistent regardless of the object's own
  transform (e.g. a world-space triplanar or fog effect), `positionLocal` for effects relative
  to the mesh's own origin (e.g. object-space vertex displacement).
- **`normalWorld`** — world-space surface normal (vec3); common for rim/fresnel lighting
  effects, matching the world-space convention of `positionWorld`.
- **`time`** — a pre-wired elapsed-time float node, no manual uniform bookkeeping needed for
  the common "just give me seconds" case (you still reach for your own `uniform()` when you
  need app-controlled values like a scroll offset or a game-state float).
- **`texture(textureObject, uvNode?)`** — samples a `THREE.Texture`, returns a vec4 node;
  analogous to GLSL's `texture2D()`/`texture()`.
- Math/utility nodes mirroring GLSL built-ins — `mix()`, `sin()`, `cos()`, `smoothstep()`,
  `clamp()`, `mod()`, `pow()`, `length()`, `normalize()`, `dot()`, `cross()`, `vec2()`/`vec3()`/
  `vec4()` constructors, `float()`/`int()` casts. Same names/semantics as GLSL where they
  overlap, called as node-graph functions rather than inline GLSL syntax.

## TSL targets both WebGPU and WebGL2

A TSL node graph is **backend-agnostic** — `WebGPURenderer` compiles it to WGSL when running
true WebGPU, or to GLSL when running its automatic WebGL2 fallback (no `navigator.gpu`,
covered in `references/renderers-and-setup.md`). This is the payoff of the node-graph
indirection: you author once, and the same material works across both backends without a
GLSL/WGSL fork in your own code — unlike the WebGL path, where a `ShaderMaterial`'s GLSL string
is fundamentally not portable to WebGPU.

## Compute shaders (pointer, not a full guide)

WebGPU's native use case beyond rendering is **compute** — GPU-driven simulation (particles,
physics, procedural generation) without a full render pass. TSL exposes this via compute node
functions (e.g. a `Fn` marked for compute execution, dispatched with a workgroup count) that
run on `WebGPURenderer` but **not** on the WebGL2 fallback (compute is a genuinely WebGPU-only
capability, no GLSL equivalent exists to fall back to). This is a large enough surface area
that it deserves its own lookup pass rather than a guessed signature here — start with
`scripts/docs_lookup.mjs` for the compute-specific TSL exports and the official examples
(three.js's `webgpu_compute_*` examples) when you actually need this, rather than treating this
paragraph as sufficient to implement from.

## Verify before shipping

Because TSL's exact node names, import paths, and helper signatures move between three.js
minor versions faster than core API, treat every node beyond the handful named above as
**unverified until checked**:

```bash
node .claude/skills/threejs/scripts/docs_lookup.mjs --tsl              # the full official TSL reference
node .claude/skills/threejs/scripts/docs_lookup.mjs --tsl swizzle      # just the sections mentioning a topic
node .claude/skills/threejs/scripts/docs_lookup.mjs MeshStandardNodeMaterial   # a node-material's docs page
```

...and cross-check against the live TSL docs (three.js docs site's TSL section / the
`three/tsl` module's own exports) rather than relying on training-data recall — this file
intentionally teaches the graph-building pattern (`Fn`, `uniform`, swizzles, slot assignment,
built-in position/normal/uv/time nodes) over an exhaustive node list precisely because the list
goes stale faster than this skill can be kept in sync.

## See also

- ★ `references/shaders-glsl.md` — the WebGL fork of this file; if the project targets plain
  `three` (`WebGLRenderer`), none of the node-material content here applies.
- `references/materials.md` — node material catalog (`MeshStandardNodeMaterial` and friends),
  when to reach for a node material vs a plain built-in material
- `references/postprocessing.md` — node post-processing stack (`THREE.PostProcessing` + pass
  nodes), the WebGPU replacement for `EffectComposer`
- `references/renderers-and-setup.md` — WebGPU init, `await renderer.init()`, WebGL2 fallback
  mechanics referenced above
