# Material × feature table

Scannable capability matrix for three.js r185 materials. For *when/why* to reach for each one,
read `references/materials.md` — this file only states *what each supports*. If a cell isn't
covered here or you need an exact property name, don't guess: run
`node .claude/skills/threejs/scripts/docs_lookup.mjs <MaterialName>`.

Legend: **Yes** = supported · **No** = not supported / not meaningful for this material ·
**—** = not applicable (e.g. a shadow column on a material that's never mesh-shaded) · **verify**
= not confidently known from the curated reference files; confirm with `scripts/docs_lookup.mjs`
before relying on it.

## Mesh materials

| Material | Lit (reacts to lights) | PBR model | env/IBL (`envMap`/`scene.environment`) | Casts shadow | Receives shadow | `normalMap` | `roughnessMap` | `metalnessMap` | Transparency (`transparent`/`opacity`) | Notable extras |
|---|---|---|---|---|---|---|---|---|---|---|
| `MeshBasicMaterial` | No (unlit) | No | No (ignores lighting/env) | Yes (shadow casting is geometry-driven, independent of shading model) | No (unlit — can't visually receive a shadow) | No | No | No | Yes | Cheapest material; flat color × texture only; `wireframe` |
| `MeshLambertMaterial` | Yes | No (Lambert diffuse, pre-PBR) | Yes (basic reflection via `envMap`) | Yes | Yes | Yes | No | No | Yes | Per-vertex lighting — cheapest lit option |
| `MeshPhongMaterial` | Yes | No (Blinn-Phong, pre-PBR) | Yes (`envMap`) | Yes | Yes | Yes | No | No | Yes | `shininess`/`specular` highlight; per-fragment |
| `MeshStandardMaterial` | Yes | Yes (metalness/roughness) | Yes (`envMap` or `scene.environment`) | Yes | Yes | Yes | Yes | Yes | Yes | `emissiveMap`, `aoMap` (needs 2nd UV set) |
| `MeshPhysicalMaterial` | Yes | Yes (extends Standard) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **clearcoat, transmission, sheen, iridescence, ior, thickness, specularIntensity/Color** |
| `MeshMatcapMaterial` | No (matcap-baked, not real lights) | No | No (lighting baked into matcap image) | Yes | verify (no real light source to cast a *dynamic* shadow from — receiving a shadow map is a separate mechanism; verify via `scripts/docs_lookup.mjs`) | Yes (perturbs the matcap normal lookup) | No | No | Yes | Zero runtime lighting cost; view-space normal sampling |
| `MeshToonMaterial` | Yes | No (cel/toon-shaded step function) | verify (accepts `envMap` per docs; confirm current-version behavior via `scripts/docs_lookup.mjs`) | Yes | Yes | Yes | No | No | Yes | `gradientMap` drives the toon banding steps |
| `MeshNormalMaterial` | No (visualizes normals directly, not lit) | No | No | Yes (geometry-driven) | No (unlit debug material) | No (it *is* the normal visualization) | No | No | verify (rarely used with transparency; confirm before relying on it) | Debug/visualization only — RGB = world/view-space normal |
| `MeshDepthMaterial` | No | No | No | Yes (geometry-driven) | No | No | No | No | No | Debug/utility — encodes fragment depth as color; used internally for shadow maps |
| `ShadowMaterial` | — (special-case: only renders shadow contribution) | No | No | No (the mesh itself is invisible except where shadowed) | Yes (this is its entire purpose) | No | No | No | Yes (`opacity` controls shadow darkness) | Invisible-except-for-shadow ground-plane technique |

## Points, lines, sprites

| Material | Lit | PBR | env/IBL | Casts shadow | Receives shadow | Transparency | Notable extras |
|---|---|---|---|---|---|---|---|
| `PointsMaterial` | No | No | No | No | No | Yes | `size`, `sizeAttenuation`, per-point `vertexColors`; used with `THREE.Points` |
| `LineBasicMaterial` | No | No | No | No | No | Yes | `linewidth` (most browsers ignore it beyond 1px due to WebGL/ANGLE limits — verify current behavior via `scripts/docs_lookup.mjs` if line thickness matters); used with `THREE.Line`/`LineSegments` |
| `LineDashedMaterial` | No | No | No | No | No | Yes | Extends `LineBasicMaterial` with `dashSize`/`gapSize`; geometry needs `computeLineDistances()` called or the dash pattern doesn't render |
| `SpriteMaterial` | No | No | No | No | No | Yes | Always camera-facing (billboard); used with `THREE.Sprite`; `rotation` spins the billboard in-plane |

## Reading the shadow columns

"Casts shadow" and "receives shadow" both additionally require `renderer.shadowMap.enabled =
true`, a shadow-capable light (`DirectionalLight`/`SpotLight`/`PointLight` with `castShadow =
true`), and `mesh.castShadow`/`mesh.receiveShadow` set on the individual mesh — the material
column here is about whether the *material* is capable of participating at all, not whether
shadows are configured elsewhere in the scene. See `references/lighting-and-env.md` for the full
shadow setup. An unlit material (`MeshBasicMaterial`, `MeshNormalMaterial`) can still **cast** a
shadow (shadow casting is purely geometric — it doesn't need the caster's own shading model) but
generally can't meaningfully **receive** one, since there's no lit surface color for the shadow to
darken.

## WebGPU node-material equivalents

On `three/webgpu`, the PBR materials are backed by **node materials** — TSL node graphs under a
familiar property surface. Plain PBR-property usage (`map`, `roughness`, `metalness`, `envMap`,
…) is portable and works the same on both renderers; reach for the explicit Node variant only
when you need custom node slots (`colorNode`, `positionNode`, `normalNode`, etc.):

| WebGL material | WebGPU node-material equivalent | Import |
|---|---|---|
| `MeshBasicMaterial` | `MeshBasicNodeMaterial` | `three/webgpu` |
| `MeshStandardMaterial` | `MeshStandardNodeMaterial` | `three/webgpu` |
| `MeshPhysicalMaterial` | `MeshPhysicalNodeMaterial` | `three/webgpu` |
| `MeshLambertMaterial` | `MeshLambertNodeMaterial` (verify exact availability/name via `scripts/docs_lookup.mjs`) | `three/webgpu` |
| `MeshPhongMaterial` | `MeshPhongNodeMaterial` (verify exact availability/name via `scripts/docs_lookup.mjs`) | `three/webgpu` |
| `MeshMatcapMaterial` | `MeshMatcapNodeMaterial` (verify via `scripts/docs_lookup.mjs`) | `three/webgpu` |
| `MeshToonMaterial` | verify current node-material coverage via `scripts/docs_lookup.mjs` — toon shading may need a hand-built TSL step function instead of a dedicated Node class | `three/webgpu` |
| `PointsMaterial` | node-backed automatically when used under `WebGPURenderer` (verify custom node slot support via `scripts/docs_lookup.mjs`) | `three/webgpu` |

```js
import * as THREE from 'three/webgpu';
import { texture, uv, time, sin, mix, vec3 } from 'three/tsl';

const material = new THREE.MeshStandardNodeMaterial();
material.map = colorTexture;        // conventional PBR inputs still work exactly like WebGL
material.roughness = 0.6;
material.colorNode = mix(texture(colorTexture, uv()), vec3(1, 0, 0), sin(time)); // TSL override
```

**Invariant 7 (SKILL.md): `ShaderMaterial`, `RawShaderMaterial`, and `onBeforeCompile` are
WebGL-only** — none of them work on `WebGPURenderer`. There is no GLSL escape hatch on the
node-material path; a custom look on WebGPU is authored as a TSL node graph instead (`colorNode`,
`positionNode`, etc. on a node material, or a hand-built node material from scratch). See
`references/shaders-tsl.md` for building one and `references/shaders-glsl.md` for the WebGL
equivalent.

## See also

- `references/materials.md` — decision guide for *which* material to reach for, plus full
  `MeshStandardMaterial`/`MeshPhysicalMaterial` property examples
- `references/textures.md` — colorSpace rules for `map`/`normalMap`/`roughnessMap`/etc.
- `references/lighting-and-env.md` — shadow map setup, PMREM/IBL environment setup
- `references/shaders-tsl.md` — building custom node materials/TSL graphs for WebGPU
