# Custom shaders on WebGL — ShaderMaterial, onBeforeCompile ★

★ **WebGL only.** Everything in this file — `ShaderMaterial`, `RawShaderMaterial`,
`onBeforeCompile`, GLSL string authoring — runs on `WebGLRenderer` (`import * as THREE from
'three'`) and does **not** work on `WebGPURenderer` (invariant 7). If you're on the WebGPU /
node-material path, stop here and read `references/shaders-tsl.md` instead. If you're not sure
which renderer you're targeting, resolve that first in `SKILL.md` decision gate 1.

## ShaderMaterial vs RawShaderMaterial

Both compile hand-written GLSL vertex + fragment shader strings. The difference is how much
three.js injects for you automatically:

| | `ShaderMaterial` | `RawShaderMaterial` |
|---|---|---|
| Precision qualifiers, `#define` version pragmas | injected | injected |
| Built-in uniforms (`modelViewMatrix`, `projectionMatrix`, `normalMatrix`, `cameraPosition`, etc.) | **auto-declared** | you declare every one yourself |
| Built-in attributes (`position`, `normal`, `uv`) | **auto-declared** | you declare every one yourself |
| Use case | the default — you still get the standard matrix/attribute plumbing | full manual control (e.g. porting a shader from Shadertoy/another engine with its own conventions, or avoiding name collisions with three's built-ins) |

Default to **`ShaderMaterial`**. Reach for `RawShaderMaterial` only when you specifically need
to avoid three's auto-injected declarations — e.g. the incoming GLSL already declares
`uniform mat4 modelViewMatrix` itself and you'd get a duplicate-declaration compile error under
`ShaderMaterial`.

## Uniforms object

Uniforms are a plain object of `{ value }` wrappers, passed once at construction and mutated
in place per frame — **don't replace the uniforms object**, mutate `.value`:

```js
import * as THREE from 'three';

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2() },
    uColor: { value: new THREE.Color(0x3388ff) },
    uTexture: { value: null }, // set after texture loads, or pass it in directly
  },
  vertexShader,
  fragmentShader,
});

renderer.setAnimationLoop((time) => {
  material.uniforms.uTime.value = time / 1000; // three passes elapsed ms into the loop callback
  renderer.render(scene, camera);
});
```

Common uniform types and what to pass as `.value`: `float`/`int` → JS number, `vec2/3/4` →
`Vector2`/`Vector3`/`Vector4` (or `Color` for `vec3` color data), `mat3/4` →
`Matrix3`/`Matrix4`, `sampler2D` → a `Texture` instance, array uniforms → a JS array of the
element type. Mismatching the GLSL type and the JS value type is a common silent-failure mode —
verify with `scripts/docs_lookup.mjs ShaderMaterial` if a uniform isn't reaching the shader.

## Attributes & varyings

- **Attributes** are per-vertex data from `BufferGeometry` (see `references/geometry.md`) —
  `position`/`normal`/`uv` come pre-declared under `ShaderMaterial`; custom per-vertex data
  (e.g. a per-vertex random seed for a particle effect) needs
  `geometry.setAttribute('aSeed', new THREE.BufferAttribute(seedArray, 1))` and a matching
  `attribute float aSeed;` declaration in the vertex shader.
- **Varyings** carry interpolated data from vertex → fragment stage; declare the same
  `varying vec2 vUv;` (or `out`/`in` under GLSL3 — see below) in both shaders, write it in
  `main()` in the vertex stage, read the interpolated value in the fragment stage.

## Vertex + fragment skeleton

```js
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + vWorldPosition.x);
    gl_FragColor = vec4(uColor * pulse, 1.0);
  }
`;
```

The `/* glsl */` comment is a convention that unlocks GLSL syntax highlighting in editors with
the right extension (e.g. `vscode-glsl-literal`) — cosmetic only, no runtime effect.

## Feeding time / resolution / textures as uniforms

```js
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(canvas.clientWidth, canvas.clientHeight) },
    uMap: { value: texture }, // a loaded THREE.Texture — see references/textures.md
  },
  vertexShader,
  fragmentShader,
});

function onResize() {
  material.uniforms.uResolution.value.set(canvas.clientWidth, canvas.clientHeight);
}
```

Update `uResolution` in the same resize handler that calls `renderer.setSize` (invariant 5) —
a shader reading stale resolution is a common cause of effects (e.g. screen-space distortion,
vignettes) looking correct at load but wrong after a window resize.

## `onBeforeCompile` — patching built-in materials

`onBeforeCompile` lets you inject GLSL into three's **built-in** materials (`MeshStandardMaterial`,
`MeshPhysicalMaterial`, etc.) instead of writing a full shader from scratch — useful when you
want PBR lighting/shadows/environment reflections "for free" from a standard material but need
one custom effect layered on (e.g. vertex displacement, a custom fresnel rim, triplanar
texturing).

```js
const material = new THREE.MeshStandardMaterial({ color: 0x888888 });

material.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = { value: 0 }; // register the uniform on the compiled shader object
  material.userData.shader = shader;    // stash a reference so the render loop can update it

  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `
    #include <begin_vertex>
    transformed.y += sin(position.x * 4.0 + uTime) * 0.1;
    `,
  );
};

renderer.setAnimationLoop((time) => {
  if (material.userData.shader) {
    material.userData.shader.uniforms.uTime.value = time / 1000;
  }
  renderer.render(scene, camera);
});
```

### The fragile string-replace reality

`onBeforeCompile` works by **string-replacing** inside three's generated GLSL — every built-in
material is assembled from named `#include <chunkName>` fragments
(`node_modules/three/src/renderers/shaders/ShaderChunk/`). This is inherently brittle:

- The exact chunk names, their contents, and where they're included **change between three.js
  releases** without deprecation warnings, because they're an internal implementation detail,
  not a public API. A patch that works on r183 can silently stop matching (and silently no-op,
  since `.replace()` on a non-matching string just returns the original) on r186.
- Don't guess chunk names from memory — read the actual generated shader
  (`console.log(shader.vertexShader)` inside the callback) or check
  `node_modules/three/src/renderers/shaders/ShaderChunk/` for the installed version before
  writing a replace target.
- Prefer targeting well-known, long-stable anchor chunks (`#include <begin_vertex>`,
  `#include <color_fragment>`, `#include <normal_fragment_maps>`) over chunks that see frequent
  internal refactors.

### `material.customProgramCacheKey`

three caches compiled shader programs keyed by material configuration; if your
`onBeforeCompile` output varies based on something three doesn't already fingerprint (e.g. a
uniform's *presence* rather than its value, or a code branch chosen by a JS-side flag), you
must add `material.customProgramCacheKey = () => someString` so materials that need genuinely
different compiled code don't incorrectly share a cached program. Symptom of skipping this:
two materials that should render differently end up looking identical because one "won" the
cache and both reused its compiled shader.

### GLSL version — GLSL1 vs GLSL3

`material.glslVersion = THREE.GLSL3` switches from GLSL ES 1.00 syntax (`varying`,
`gl_FragColor`, `texture2D`) to GLSL ES 3.00 (`in`/`out`, a manually declared `out vec4`
instead of `gl_FragColor`, `texture` instead of `texture2D`). Needed for features GLSL1 lacks
(e.g. `texture2DArray` sampling, certain integer operations). Default (unset) is GLSL1 —
three's built-in materials and most addon shaders target GLSL1 for the widest compatibility, so
only opt into GLSL3 when you specifically need a GLSL3-only feature.

## colorSpace / output caveats

- Fragment shader output is written in **linear space**; three.js applies the renderer's
  `outputColorSpace` conversion (typically sRGB) and tone mapping as a post-step on the
  default framebuffer — you generally do **not** hand-roll an sRGB encode in your fragment
  shader's final `gl_FragColor`/`out vec4` write, or you'll double-encode and get washed-out
  colors (invariant 3's failure mode, shader edition).
- If you sample a `sampler2D` uniform backed by a color texture (albedo-like data), remember
  the texture's own `colorSpace` (`references/textures.md`) still applies at sample time for
  three's built-in materials' internal chunks, but a **raw custom shader's `texture2D()` /
  `texture()` call reads the raw stored texel values** — no automatic colorSpace conversion
  happens inside your own GLSL. For a texture uploaded with `colorSpace = SRGBColorSpace`,
  three converts on upload/sampling within its own built-in chunks; a fully custom
  `ShaderMaterial` sampling that same texture needs you to reason about whether the bytes
  you're reading are sRGB-encoded or linear, and decode manually (`pow(color, vec3(2.2))`
  as an approximation, or rely on the texture's `colorSpace` triggering an implicit conversion
  depending on version/config) — verify current behavior with
  `scripts/docs_lookup.mjs Texture` and a visual check rather than assuming; this is a
  frequently-wrong-from-memory corner.
- `OutputPass` (post-processing) is where final colorSpace + tone mapping actually gets applied
  when using `EffectComposer` — see `references/postprocessing.md`. A custom `ShaderPass`
  inserted **before** `OutputPass` in the chain is working in linear HDR space; one inserted
  **after** is working in the final display-encoded space. Mixing this up is a common
  post-processing color bug.

## See also

- ★ `references/shaders-tsl.md` — the WebGPU/node-material fork of this file; if the project
  targets `three/webgpu`, none of the GLSL string-authoring content here applies.
- `references/materials.md` — built-in material catalog, when to patch vs replace entirely
- `references/textures.md` — texture colorSpace, wrapping, mipmaps feeding a sampler uniform
- `references/postprocessing.md` — `ShaderPass`/`EffectComposer`, where GLSL full-screen
  effects plug into the WebGL post-processing chain
- `recipes/shader-effect.md` — full annotated walkthrough building a custom effect
