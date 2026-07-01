# Recipe: Custom Shader Effect (WebGL GLSL vs WebGPU TSL)

**What you'll build:** the same visual effect — an animated gradient with vertex displacement —
implemented twice: once as a WebGL `ShaderMaterial` (hand-written GLSL) and once as a WebGPU
node material (TSL). **When to use this:** any time a built-in material (`MeshStandardMaterial`
etc.) can't produce the look you need and you have to write shader code directly — energy
fields, dissolve effects, procedural terrain coloring, stylized water, portal/hologram looks.

This recipe makes **invariant 7 concrete**: "WebGPU forks the shader + post-processing story."
`ShaderMaterial`/`RawShaderMaterial`/`onBeforeCompile` work only on `WebGLRenderer`; they do not
run on `WebGPURenderer` at all. There is no shared code path — you pick one based on your
renderer choice (`SKILL.md` decision gate 1) and write that version, full stop. This recipe
shows both so you can see the mapping between them, not so you write both in the same project.

Pinned versions: three 0.185.1 (r185). Full references: `references/shaders-glsl.md` (WebGL),
`references/shaders-tsl.md` (WebGPU), `references/materials.md` (the ★ fork point).

## Table of contents

- [Pick one based on renderer path](#pick-one-based-on-renderer-path)
- [The effect: animated gradient + vertex displacement](#the-effect-animated-gradient--vertex-displacement)
- [WebGL: ShaderMaterial + GLSL](#webgl-shadermaterial--glsl)
- [WebGPU: TSL node material](#webgpu-tsl-node-material)
- [Driving `time` from the render loop](#driving-time-from-the-render-loop)
- [r3f versions](#r3f-versions)
- [Pitfalls](#pitfalls)
- [Cross-references](#cross-references)

## Pick one based on renderer path

| Your renderer | Your material | Your shader language |
|---|---|---|
| `WebGLRenderer` (`three`) | `ShaderMaterial` / `RawShaderMaterial` | GLSL, hand-written vertex + fragment strings |
| `WebGPURenderer` (`three/webgpu`) | Node material (e.g. `MeshBasicNodeMaterial`, or a plain `THREE.Mesh` + node graph) | TSL (`three/tsl`), a JS function-composition graph — no string shader source |

Resolve this **before** writing any shader code — per `SKILL.md` decision gate 1, default to
WebGL unless the task explicitly signals WebGPU/TSL/compute/node materials. Don't mix: a scene
built on `three/webgpu` cannot fall back to `ShaderMaterial` for one troublesome effect — the
TSL equivalent has to be built instead (see `references/shaders-tsl.md` for the full node
vocabulary this recipe only samples).

## The effect: animated gradient + vertex displacement

Deliberately simple so the *mapping* between GLSL and TSL is the point, not the effect: a plane
whose vertices bob in a sine wave over time (vertex stage) and whose fragment color animates
between two colors based on a moving gradient (fragment stage). Both stages read the same `time`
uniform, driven once per frame from the render loop.

## WebGL: ShaderMaterial + GLSL

```js
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 displaced = position;
    displaced.z += sin(position.x * 3.0 + uTime) * 0.15; // vertex displacement, driven by time
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vUv;

  void main() {
    float mixFactor = sin(vUv.x * 6.0 + uTime * 1.5) * 0.5 + 0.5; // moving gradient, 0..1
    vec3 color = mix(uColorA, uColorB, mixFactor);
    gl_FragColor = vec4(color, 1.0); // see colorspace pitfall below
  }
`;

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uColorA: { value: new THREE.Color(0x1a2a6c) },
    uColorB: { value: new THREE.Color(0xfdbb2d) },
  },
  vertexShader,
  fragmentShader,
});

const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4, 64, 64), material);
scene.add(mesh);
```

- **`uniforms`** — the JS↔GLSL data bridge. Each entry's `.value` is what you mutate per frame;
  three.js uploads it to the GPU automatically on render (you never manually "send" a uniform).
- **Built-in attributes/uniforms** (`position`, `uv`, `normal`, `projectionMatrix`,
  `modelViewMatrix`, `modelMatrix`, `viewMatrix`, `normalMatrix`, `cameraPosition`, etc.) are
  injected by three.js automatically into every `ShaderMaterial` — you don't declare or set
  these yourself, only your custom `uniform`s.
- **`varying`** passes data from vertex to fragment stage, interpolated per-fragment across the
  triangle (`vUv` above). Declared identically in both shader strings.
- Segment count matters for vertex displacement: `PlaneGeometry(4, 4, 64, 64)` has enough
  subdivisions for the sine displacement to look smooth; a low-segment plane would displace only
  a handful of vertices and look faceted.

For extending an *existing* built-in material (keep its lighting response, inject custom
displacement/color logic) instead of writing a fully custom shader from scratch, see
`onBeforeCompile` in `references/shaders-glsl.md` — that's the other WebGL-only escape hatch
invariant 7 refers to, complementary to `ShaderMaterial`.

## WebGPU: TSL node material

TSL (Three.js Shading Language) is not a shader source string — it's a graph of composable JS
functions that three.js compiles to the target backend's shader language (WGSL for native
WebGPU, GLSL for the WebGL2 fallback) at build time. You author the *same conceptual pipeline*
(vertex displacement, fragment color) as function composition instead of string interpolation:

```js
import * as THREE from 'three/webgpu';
import { Fn, uniform, uv, sin, mix, color, positionLocal, vec3, time } from 'three/tsl';

const uColorA = uniform(color(0x1a2a6c));
const uColorB = uniform(color(0xfdbb2d));

const displacedPosition = Fn(() => {
  const displaced = positionLocal.toVar();
  displaced.z.addAssign(sin(positionLocal.x.mul(3.0).add(time)).mul(0.15));
  return displaced;
})();

const gradientColor = Fn(() => {
  const mixFactor = sin(uv().x.mul(6.0).add(time.mul(1.5))).mul(0.5).add(0.5);
  return mix(uColorA, uColorB, mixFactor);
})();

const material = new THREE.MeshBasicNodeMaterial();
material.positionNode = displacedPosition;
material.colorNode = gradientColor;

const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4, 64, 64), material);
scene.add(mesh);
```

- **`time`** — TSL's built-in node reading the renderer's elapsed clock automatically; unlike
  the GLSL version you don't manually create-and-update a `uTime` uniform for basic elapsed time
  (though you still can via `uniform()` for anything not auto-driven — see the driving-uniforms
  section below).
- **`positionLocal`** — the TSL node reading the mesh's local-space vertex position, the node
  equivalent of GLSL's `position` attribute. Assigning to `material.positionNode` overrides
  where the material sources vertex position from — analogous to writing `gl_Position` in GLSL,
  but you're composing the *input* position value, not the final clip-space output; three.js's
  node material internals still apply the model/view/projection transforms around whatever
  `positionNode` produces.
- **`material.colorNode`** — overrides the material's base color computation, the node
  equivalent of writing `gl_FragColor`'s RGB in GLSL.
- **`Fn(() => { ... })()`** wraps a block of TSL statements into a reusable node function;
  `.toVar()` creates a mutable node-graph variable (TSL nodes are otherwise more like an
  expression graph than imperative code — `toVar()` is how you get local-variable-like
  mutation semantics such as `.addAssign()`).

**This file is deliberately conservative on exact TSL node names and chaining methods.** TSL is
newer than core three.js, moves faster, and is under-represented in most models' training data
compared to GLSL — the pattern above (uniform/time/position/color nodes, `Fn`, node-method
chaining like `.mul()`/`.add()`/`.toVar()`) is the *shape* of TSL code, not a guarantee every
method name above is exactly right for r185. **Before shipping TSL code, verify the specific
node names and method signatures you're using:**

```bash
node .claude/skills/threejs/scripts/docs_lookup.mjs MeshBasicNodeMaterial
node .claude/skills/threejs/scripts/docs_lookup.mjs positionLocal
```

Full node vocabulary, the WGSL/GLSL transpile model, and more worked patterns:
`references/shaders-tsl.md`.

## Driving `time` from the render loop

### WebGL: update the uniform by hand every frame

```js
import * as THREE from 'three';

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  material.uniforms.uTime.value = clock.getElapsedTime();
  renderer.render(scene, camera);
});
```

`ShaderMaterial` uniforms never update themselves — you own writing `.value` every frame for
anything time-driven. This is the single most common "shader effect is frozen" bug: the shader
compiles and runs fine, but nothing changes because `uTime.value` was set once and never again.

### WebGPU: `time` auto-updates, custom uniforms still need driving

TSL's `time` node is wired to the renderer's internal clock automatically — no manual per-frame
`.value` write needed for it specifically. Any **other** custom `uniform()` you create (a color
picked from UI state, a scroll-driven progress value) still needs manual updates, same as GLSL:

```js
renderer.setAnimationLoop(() => {
  uScrollProgress.value = getScrollProgress(); // custom uniform — still your job to drive
  renderer.render(scene, camera);
});
```

Both loops must use `setAnimationLoop` (invariant 4), not raw `requestAnimationFrame` — mandatory
for WebGPU's async device init, and the consistent convention either way. See
`references/renderers-and-setup.md`.

## r3f versions

### WebGL: `shaderMaterial` via drei, or raw `<shaderMaterial>`

```jsx
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';
import * as THREE from 'three';

const GradientMaterial = shaderMaterial(
  { uTime: 0, uColorA: new THREE.Color(0x1a2a6c), uColorB: new THREE.Color(0xfdbb2d) },
  /* vertex */ `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec3 displaced = position;
      displaced.z += sin(position.x * 3.0 + uTime) * 0.15;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
  `,
  /* fragment */ `
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying vec2 vUv;
    void main() {
      float mixFactor = sin(vUv.x * 6.0 + uTime * 1.5) * 0.5 + 0.5;
      gl_FragColor = vec4(mix(uColorA, uColorB, mixFactor), 1.0);
    }
  `,
);
extend({ GradientMaterial }); // registers <gradientMaterial> as a JSX intrinsic

function GradientPlane() {
  const matRef = useRef();
  useFrame((state) => {
    matRef.current.uTime = state.clock.elapsedTime; // drei's shaderMaterial exposes uniforms as flat props
  });
  return (
    <mesh>
      <planeGeometry args={[4, 4, 64, 64]} />
      <gradientMaterial ref={matRef} />
    </mesh>
  );
}
```

- **`shaderMaterial(uniforms, vertexShader, fragmentShader)`** (drei) builds a `ShaderMaterial`
  subclass with each uniform exposed as a **flat settable property** (`matRef.current.uTime = ...`)
  instead of `material.uniforms.uTime.value = ...` — same underlying mechanism, less
  boilerplate. `extend({ GradientMaterial })` is what makes `<gradientMaterial>` usable as JSX
  (r3f's `extend` registers any three.js-constructor-shaped class as an intrinsic element).
- Driving `uTime` still happens in `useFrame`, r3f's per-frame hook into the shared render loop
  — same requirement as vanilla (uniforms don't self-update), just relocated into React's
  render-loop integration instead of a manual `setAnimationLoop` callback.
- The raw, non-drei equivalent is `<shaderMaterial args={[{ uniforms, vertexShader,
  fragmentShader }]} />` — usable without `extend`, closer to hand-instantiating
  `THREE.ShaderMaterial`, but you lose the flat-uniform-props convenience.

### WebGPU: node material in r3f

```jsx
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { Fn, uniform, uv, sin, mix, color, positionLocal, time } from 'three/tsl';

function GradientPlane() {
  const materialRef = useRef();

  // Build the node graph once — TSL nodes are typically constructed outside the render loop,
  // not rebuilt every frame.
  const { positionNode, colorNode } = useMemo(() => {
    const uColorA = uniform(color(0x1a2a6c));
    const uColorB = uniform(color(0xfdbb2d));
    return {
      positionNode: Fn(() => {
        const displaced = positionLocal.toVar();
        displaced.z.addAssign(sin(positionLocal.x.mul(3.0).add(time)).mul(0.15));
        return displaced;
      })(),
      colorNode: Fn(() => {
        const mixFactor = sin(uv().x.mul(6.0).add(time.mul(1.5))).mul(0.5).add(0.5);
        return mix(uColorA, uColorB, mixFactor);
      })(),
    };
  }, []);

  return (
    <mesh>
      <planeGeometry args={[4, 4, 64, 64]} />
      <meshBasicNodeMaterial ref={materialRef} positionNode={positionNode} colorNode={colorNode} />
    </mesh>
  );
}
```

- Requires the app's `<Canvas>` to actually be running `WebGPURenderer` — r3f's `<Canvas>`
  defaults to WebGL; wiring a WebGPU-backed canvas is a `references/react-three-fiber.md` /
  `references/renderers-and-setup.md` concern (custom `gl` factory), not something this recipe
  covers — confirm your project's renderer setup before writing TSL-in-r3f code.
  `assets/templates/r3f-webgpu-vite` is the known-good scaffold for this combination.
- No `useFrame`-driven uniform update is needed for `time` itself here, unlike the GLSL/drei
  version above, because `time` already auto-updates — same auto-driving behavior as vanilla
  TSL above. Any additional custom `uniform()` you introduce still needs a `useFrame` write.
- Same node-name-uncertainty caveat as the vanilla TSL section: verify with
  `scripts/docs_lookup.mjs` before trusting exact method chains from memory.

## Pitfalls

- **Colorspace in fragment output.** Writing `gl_FragColor`/`colorNode` with raw color values
  that don't account for the renderer's `outputColorSpace`/tone mapping can look washed-out or
  blown-out compared to a built-in material driving the same pipeline correctly (invariant 3).
  If your custom shader's colors look off relative to built-in materials in the same scene,
  suspect this before suspecting the math — see `references/debugging-and-gotchas.md`
  ("Washed-out or too-dark colors") and the colorspace-handling notes in
  `references/shaders-glsl.md` / `references/shaders-tsl.md`.
- **Uniforms not updating.** GLSL `ShaderMaterial` uniforms are inert until you write `.value`
  every frame — the shader will compile and run with whatever the uniform was last set to
  (usually its initial value, i.e. "frozen" animation) if the render loop doesn't update it. TSL's
  `time` node is the one exception (auto-driven); every other custom `uniform()` still needs
  manual per-frame updates on both paths.
- **Trying to use `ShaderMaterial`/`onBeforeCompile` on `WebGPURenderer`.** This is invariant 7
  directly — it doesn't error loudly in every version/path, so "my custom shader does nothing
  on WebGPU" can be this rather than a logic bug. `scripts/validate.mjs` flags this pattern
  statically.
- **Rebuilding the TSL node graph every frame** instead of once (e.g. inside `useFrame` or a
  vanilla render-loop callback) — nodes are meant to be constructed once and read/updated via
  their `.value`/`toVar()` mutation, not reconstructed per frame; treat node graph construction
  like the vanilla `ShaderMaterial` constructor call, not like a per-frame operation.
- **Low-segment geometry with vertex displacement.** A `PlaneGeometry(4, 4, 1, 1)` has 4
  vertices total — a sine displacement on `position.x` will look like a hinge, not a wave.
  Subdivide (`widthSegments`/`heightSegments`) enough for the displacement frequency to read
  smoothly.
- **Guessing a TSL method/node name from memory.** TSL's surface area is newer and evolves
  faster than core GLSL-era three.js — the exact chaining API (`.mul()` vs `.multiply()`,
  whether a given node is a bare import or an object method) is exactly the kind of thing
  `references/shaders-tsl.md` flags as version-sensitive. Run `scripts/docs_lookup.mjs
  <NodeOrClassName>` rather than trusting a remembered signature.

## Cross-references

- `references/shaders-glsl.md` — full GLSL/`ShaderMaterial` reference, `onBeforeCompile`,
  built-in uniforms/attributes list
- `references/shaders-tsl.md` — full TSL node vocabulary, WGSL/GLSL transpile model,
  version-sensitivity notes
- `references/materials.md` — the WebGL/WebGPU material fork this recipe makes concrete
  (invariant 7), node-material overview
- `references/renderers-and-setup.md` — renderer choice, `await renderer.init()`,
  `setAnimationLoop`
- `references/debugging-and-gotchas.md` — colorspace/washed-out-color triage
- `references/react-three-fiber.md` — drei `shaderMaterial`, `extend()`, wiring a
  WebGPU-backed `<Canvas>`
- `assets/templates/r3f-webgpu-vite`, `assets/templates/vanilla-webgpu-vite` — known-good
  WebGPU scaffolds to start from
