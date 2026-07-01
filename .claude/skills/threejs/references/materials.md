# Materials ★

Materials answer one question: **given a surface point, what color comes out?** WebGL answers
it with fixed-parameter materials (set properties, shader is baked internally) or hand-written
GLSL (`ShaderMaterial`). WebGPU answers it with **node materials** — same PBR property surface,
but the shader is a graph you can splice TSL nodes into. That split is invariant 7 and it forks
this entire file.

For the full per-material capability matrix (which material supports which map, which renderer),
see `assets/reference-data/material-feature-table.md` — this file explains *when* and *why* to
reach for each one; it doesn't restate that table.

## Decision: which material?

| Need | Reach for |
|---|---|
| Realistic surface, responds to lights, default choice | `MeshStandardMaterial` |
| Standard + clearcoat/transmission/sheen/iridescence/thickness | `MeshPhysicalMaterial` |
| Flat-colored, unlit, UI overlays, holograms, wireframe debug | `MeshBasicMaterial` |
| Cheap per-vertex lighting, low-power/legacy targets | `MeshLambertMaterial` |
| Cheap specular highlight without full PBR cost | `MeshPhongMaterial` |
| Pre-baked lighting look from a matcap image, no real lights needed | `MeshMatcapMaterial` |
| Catch shadows on an otherwise invisible surface (AR-style ground plane) | `ShadowMaterial` |
| Hand-written GLSL, full control over the shader | `ShaderMaterial` / `RawShaderMaterial` — **WebGL only** |
| Node graph, TSL, WebGPU-only features (compute, storage buffers) | Node materials (`MeshStandardNodeMaterial`, etc.) — **WebGPU only** |

Default to `MeshStandardMaterial` unless the request specifically needs clearcoat/transmission
(reach for `MeshPhysicalMaterial`) or an unlit look (`MeshBasicMaterial`).

## WebGL PBR: MeshStandardMaterial

The workhorse. Metalness/roughness PBR model, responds to scene lights and `scene.environment`.

```js
const material = new THREE.MeshStandardMaterial({
  map: colorTexture,              // albedo — SRGBColorSpace (see references/textures.md)
  normalMap: normalTexture,       // tangent-space normals — data texture, linear
  roughnessMap: roughnessTexture, // data texture, linear — G channel by glTF convention
  metalnessMap: metalnessTexture, // data texture, linear — B channel by glTF convention
  aoMap: aoTexture,               // data texture, linear — requires a second UV set (uv2/uv1)
  roughness: 1.0,                 // multiplies roughnessMap if present, else the sole value
  metalness: 0.0,                 // multiplies metalnessMap if present, else the sole value
  emissive: 0x000000,             // emissive color; combine with emissiveMap
  emissiveMap: emissiveTexture,   // SRGBColorSpace — it's a color map, not data
  emissiveIntensity: 1.0,
  envMap: envTexture,             // usually set via scene.environment instead — see below
  envMapIntensity: 1.0,
});
```

- `roughnessMap`/`metalnessMap` read different channels of the *same* packed texture in glTF
  workflows (G = roughness, B = metalness) — you can assign the identical texture to both
  properties and three.js samples the right channel.
- `aoMap` needs a second UV channel (`geometry.attributes.uv2` in older three, unified into `uv1`
  more recently) — a common "AO map does nothing" bug is simply a missing second UV set. Verify
  the exact attribute name for your version with `scripts/docs_lookup.mjs MeshStandardMaterial`.
- Prefer `scene.environment` (global IBL, set once) over per-material `envMap` unless you need a
  *different* reflection per object — see `references/lighting-and-env.md` for PMREM setup. A
  `MeshStandardMaterial` with no environment and no lights renders **black** — the most common
  "why is my model black" report; check `references/debugging-and-gotchas.md`.

## WebGL PBR: MeshPhysicalMaterial

Extends `MeshStandardMaterial` with thin-film and layered-surface effects. More expensive per
pixel — reach for it only when the look needs it:

```js
const material = new THREE.MeshPhysicalMaterial({
  // ...all MeshStandardMaterial props, plus:
  clearcoat: 1.0,            // lacquer/car-paint layer; clearcoatRoughness for its own roughness
  clearcoatMap: clearcoatTex,
  transmission: 1.0,         // glass/liquid — see-through refraction; pair with `ior`, `thickness`
  thickness: 0.5,            // volume thickness for transmission's refraction depth
  ior: 1.5,                  // index of refraction (glass ≈ 1.5, water ≈ 1.33)
  sheen: 1.0,                // fabric/velvet grazing-angle highlight; sheenColor, sheenRoughness
  iridescence: 1.0,          // thin-film color shift (soap bubble, oil slick); iridescenceIOR
  specularIntensity: 1.0,    // dielectric F0 override
  specularColor: 0xffffff,
});
```

`transmission` is the expensive one — it typically requires the renderer to render a
transmission pass (a background render target) under the hood, so heavy use of transmissive
objects costs real frame time. Don't reach for `MeshPhysicalMaterial` by default; opt in per
object where the effect is visible.

## MeshBasicMaterial — unlit

No lighting calculation at all — `map` (if set) times `color`, full stop. Use it for: UI panels
in 3D space, holographic/emissive-only looks, debug wireframes, sprites, anything where "flat
color, ignores scene lights" is the desired look, or as a cheap fallback on low-power targets.
Since it ignores lights it also ignores `scene.environment` reflections — don't reach for it
expecting PBR shading.

```js
const material = new THREE.MeshBasicMaterial({ map: colorTexture, color: 0xffffff });
```

## MeshLambertMaterial / MeshPhongMaterial — when to still use them

Both predate the metalness/roughness PBR model (`MeshStandardMaterial`) and compute lighting
with the older Lambert/Blinn-Phong reflectance models. They're not "deprecated" — they still
ship and render correctly — but they're a **narrower, less physically accurate model**, so
default to `MeshStandardMaterial` unless one of these applies:

- **`MeshLambertMaterial`** — per-vertex lighting is cheaper than Standard's per-fragment PBR;
  reach for it on low-power/mobile targets with many lit objects and a flat-diffuse look is
  acceptable.
- **`MeshPhongMaterial`** — per-fragment specular highlight (`shininess`, `specular`) without the
  cost of full PBR; a reasonable middle ground when you want a shiny highlight but Standard's
  cost is a measured problem.

Both are WebGL-only in practice — there's no node-material equivalent, since the node graph
defaults to a PBR (Standard) base. If you're on the WebGPU path, use `MeshStandardNodeMaterial`
with a simplified node graph instead of reaching for these.

## MeshMatcapMaterial

Fakes lighting by sampling a single "matcap" (material capture) sphere image based on view-space
normal, instead of evaluating real lights. Zero runtime lighting cost, no `scene.environment`
needed, looks good for sculpting/preview tools and static hero objects — but the lighting is
baked into the matcap texture, so it doesn't respond to scene lights, doesn't self-shadow
correctly across camera angles the way real lighting would, and looks wrong under a rotating
camera if the matcap wasn't authored for that. Good for asset viewers where lighting realism
isn't the point; wrong for a scene where objects need to react to dynamic lights.

## ShadowMaterial

Renders **only the shadow** a receiving surface would cast on itself — the mesh itself is
invisible except where a shadow falls on it. Classic use: an invisible ground plane that shows
contact shadows under a product/AR object without rendering a visible floor.

```js
const material = new THREE.ShadowMaterial({ opacity: 0.4 });
// on a plane with receiveShadow = true; see references/lighting-and-env.md for shadow setup
```

## Common flags (all Mesh materials)

```js
material.transparent = true;      // required for opacity < 1 or alpha-mapped textures to blend
material.opacity = 0.5;           // no-op unless transparent = true
material.side = THREE.DoubleSide; // FrontSide (default) | BackSide | DoubleSide
material.alphaTest = 0.5;         // discard fragments below this alpha — cheaper than transparent
material.depthWrite = true;       // set false for transparent objects to avoid sort artifacts
material.wireframe = true;        // debug: render edges only
material.flatShading = true;      // faceted look — requires geometry normals to NOT be merged/smoothed
material.vertexColors = true;     // multiply by a `color` BufferAttribute on the geometry
```

- **`transparent` vs `alphaTest`.** `transparent: true` enables alpha blending (correct
  translucency, but no automatic depth sort between transparent objects — see
  `references/debugging-and-gotchas.md` for transparency-sort gotchas). `alphaTest` instead
  *discards* fragments below a threshold and keeps the object fully opaque/depth-tested
  otherwise — much cheaper and artifact-free for cutout foliage/fences where you don't need soft
  edges.
- **`side: DoubleSide`** costs roughly 2x fragment shading on affected triangles (both faces
  shaded) and disables backface culling, which can reveal open-manifold geometry bugs (holes,
  reversed winding) that were previously hidden. Prefer fixing geometry winding over reaching for
  `DoubleSide` as a blanket fix; use it deliberately for genuinely single-sided geometry viewed
  from both sides (leaves, cloth, paper).
- **`depthWrite: false`** on transparent materials avoids one object's transparent fragments
  occluding another transparent object behind it in the depth buffer — common fix for layered
  transparent effects (particles, glass panels) that otherwise look like they're popping in front
  of things they shouldn't.

## The WebGPU fork: node materials

On `three/webgpu`, the PBR materials are **node materials** — same familiar property surface
(`map`, `roughness`, `metalness`, `envMap`, …), but every property is backed by a node graph you
can override or extend with TSL:

```js
import * as THREE from 'three/webgpu';
import { texture, uv, time, sin, mix } from 'three/tsl';

const material = new THREE.MeshStandardNodeMaterial();
material.map = colorTexture;          // conventional PBR inputs still work exactly like WebGL
material.roughness = 0.6;
material.colorNode = mix(texture(colorTexture, uv()), vec3(1, 0, 0), sin(time)); // TSL override
```

- `MeshStandardMaterial` **works on both renderers** — on the WebGPU path it's backed by the
  node-material implementation under the hood, so plain PBR-property usage is portable. Reach
  explicitly for `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial` / `MeshBasicNodeMaterial`
  when you need to assign custom node graphs (`colorNode`, `positionNode`, `normalNode`, etc.) —
  that's WebGPU-only surface area.
- **`ShaderMaterial`, `RawShaderMaterial`, and `onBeforeCompile` do not work on
  `WebGPURenderer`** (invariant 7). There is no GLSL escape hatch on the node-material path — a
  custom look is authored as a TSL node graph instead. See `references/shaders-tsl.md` for how to
  build one; see `references/shaders-glsl.md` for the WebGL equivalent (`ShaderMaterial` +
  `onBeforeCompile`).
- Node-material-specific options (which node slots exist, exact node function signatures) move
  fast and are easy to get subtly wrong — don't guess a node property name. Verify with
  `scripts/docs_lookup.mjs MeshStandardNodeMaterial` before using anything not shown above.

## Dispose materials and their textures

A material holds GPU program state; its texture properties (`map`, `normalMap`, etc.) hold
separate GPU memory. Disposing the material does **not** dispose its textures — dispose both,
and only once nothing else references the texture (shared textures across materials are common):

```js
material.map?.dispose();
material.normalMap?.dispose();
material.roughnessMap?.dispose();
material.metalnessMap?.dispose();
material.aoMap?.dispose();
material.emissiveMap?.dispose();
material.envMap?.dispose(); // skip if it's the shared scene.environment texture — dispose that once, globally
material.dispose();
```

In practice, do this in a `traverse()` over the object being torn down rather than field-by-field
per mesh — see `references/loaders-and-assets.md` for the full traverse-and-dispose pattern used
after removing a loaded model. In React Three Fiber, unmounting a component automatically
disposes materials/geometries it created — see `references/react-three-fiber.md` — but textures
loaded outside r3f's declarative tree (e.g. via a manual `TextureLoader` call) are still on you.

## Cross-references

- Texture setup, colorSpace rules, KTX2/Draco-compressed textures → `references/textures.md`
- `envMap`/`scene.environment` needs a PMREM-processed environment — PMREMGenerator,
  `RoomEnvironment`, HDRI loading → `references/lighting-and-env.md`
- WebGL custom shaders (`ShaderMaterial`, `onBeforeCompile`) → `references/shaders-glsl.md`
- WebGPU custom shaders (TSL, node graphs) → `references/shaders-tsl.md`
- Full material × feature matrix → `assets/reference-data/material-feature-table.md`
