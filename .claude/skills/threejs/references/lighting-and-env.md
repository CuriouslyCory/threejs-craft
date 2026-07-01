# Lighting & Environment

Two separate systems that both feed the same PBR equation: **lights** (direct, directional
illumination — sun, lamp, sky) and **environment maps** (indirect, ambient illumination from
everything surrounding the object — IBL, image-based lighting). A PBR material lit only by direct
lights and no environment looks flat and loses all its reflective/metallic character; a scene with
only an environment map and no direct lights can still look complete for many product-shot style
scenes. Most real scenes need both.

## Light types

| Light | Behavior | Cost | Use for |
|---|---|---|---|
| `AmbientLight` | Uniform, non-directional add to every surface, no shadows | free | Cheap fill to avoid pure-black unlit areas; a blunt instrument — prefer an environment map for realistic ambient |
| `HemisphereLight` | Gradient between sky color (up) and ground color (down), non-directional | free | Cheap, better-than-ambient outdoor fill without a full HDRI |
| `DirectionalLight` | Parallel rays, one direction, infinite distance (sun) | moderate (shadow-capable) | Sun/primary key light; the light most scenes need for coherent shading |
| `PointLight` | Radiates in all directions from a point, has `distance`/`decay` falloff | moderate–high per light | Bulbs, torches, local point sources |
| `SpotLight` | Cone-shaped, has `angle`/`penumbra`/`distance`/`decay` | moderate–high | Flashlights, stage lighting, focused highlights |
| `RectAreaLight` | Emits from a rectangular plane — soft, directional area light | high, WebGL-only realtime, no shadows | Softbox/window/studio-panel look; only lights `MeshStandardMaterial`/`MeshPhysicalMaterial` |

`RectAreaLight` needs an explicit init step before use — the uniforms/LTC-texture data it needs
for realtime area-light math aren't loaded by default:

```js
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
RectAreaLightUniformsLib.init(); // call once, before creating any RectAreaLight
```

Skipping this doesn't error — the light renders with wrong/broken output, which is a confusing
silent failure. On the WebGPU path, verify the exact current init helper (a `*TexturesLib`
variant has existed for the node-material renderer) with
`scripts/docs_lookup.mjs RectAreaLight` before assuming the WebGL helper applies unchanged.

## `DirectionalLight` and its shadow camera

A `DirectionalLight`'s shadow is rendered from an **orthographic** camera (parallel rays have no
perspective) that you must size to fit the scene:

```js
const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(5, 10, 5);
light.castShadow = true;

light.shadow.mapSize.set(2048, 2048); // shadow map resolution — higher = sharper edges, more VRAM/cost
light.shadow.camera.near = 1;
light.shadow.camera.far = 50;
light.shadow.camera.left = -10;
light.shadow.camera.right = 10;
light.shadow.camera.top = 10;
light.shadow.camera.bottom = -10;
light.shadow.camera.updateProjectionMatrix(); // required after manually editing camera bounds
```

Frustum tuning is the single biggest lever on shadow quality: too large a frustum spreads the
fixed `mapSize` resolution over a wide area (blocky, low-res shadow edges); too tight and objects
outside it don't cast/receive shadows at all. Fit the frustum to just the area that actually needs
shadows, not the whole scene. Visualize it while tuning:

```js
const helper = new THREE.CameraHelper(light.shadow.camera);
scene.add(helper);
```

## Shadow bias and acne

```js
light.shadow.bias = -0.0001;      // depth-based bias — fixes shadow acne on flat/large surfaces
light.shadow.normalBias = 0.02;   // normal-offset bias — often better for curved/rounded geometry
```

Shadow acne (moiré/self-shadowing artifacts on a lit surface) comes from shadow-map depth
precision — a small bias offsets the comparison to avoid a surface shadowing itself. Too much bias
causes the opposite artifact, "peter-panning" (shadow visibly detached from its caster). Tune in
small increments; `normalBias` tends to handle curved geometry more gracefully than `bias` alone.
Both are trial-and-error per scene — there's no universally correct value.

## `shadowMap.type`

```js
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

- `BasicShadowMap` — cheapest, hard-edged, no filtering.
- `PCFShadowMap` — percentage-closer filtering, softened edges, low-moderate cost.
- `PCFSoftShadowMap` — additional filtering for smoother edges than `PCFShadowMap`; common
  default choice for a reasonable quality/cost balance.
- `VSMShadowMap` — variance shadow maps; different algorithm, enables soft shadows with a
  `light.shadow.radius` blur control, different bias behavior than the PCF family.

Trade cost for softness roughly in the order above. If you're unsure of the current default value
or exact per-type behavior nuances for the pinned three version, verify with
`scripts/docs_lookup.mjs WebGLRenderer` rather than assuming — this is an area where defaults have
shifted across releases and this file intentionally doesn't assert one.

## IBL / environment maps — why PBR scenes need one

`MeshStandardMaterial`/`MeshPhysicalMaterial` compute both **diffuse** and **specular** response
to *all* incoming light, not just direct lights. Without an environment map, there's nothing to
reflect and nothing providing ambient fill — metallic surfaces in particular render **flat black**
in the unlit regions, because a metal's diffuse term is zero and it has no direct light hitting it
from that angle to specular-reflect. This is the most common "why does my material look wrong/flat/
black" report in PBR three.js scenes; see `references/debugging-and-gotchas.md` for the full
triage checklist. The fix is always the same: give the scene an environment.

## PMREMGenerator

Environment maps need to be pre-filtered into a **P**re-filtered **M**ipmapped **R**adiance
**E**nvironment **M**ap (PMREM) before use as `scene.environment` — this precomputes blurred
mip levels so rough materials can sample a correspondingly blurry reflection cheaply at runtime,
instead of blurring a sharp environment on the fly per pixel.

```js
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envRenderTarget = pmremGenerator.fromScene(someEquirectScene); // or .fromEquirectangular(hdrTexture)
scene.environment = envRenderTarget.texture;
pmremGenerator.dispose(); // dispose the generator once done — not the render target texture you're using
```

You rarely call this by hand for a static HDRI — the common paths below wrap it.

## Quick neutral studio: `RoomEnvironment`

A procedural neutral studio-lighting environment, built entirely in three.js with no external HDR
file to fetch — the fastest way to get PBR materials looking correct without sourcing an asset:

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();
```

Good default for product viewers, material previews, and any scene where "looks physically
plausible" matters more than "matches a specific real-world location." Reach for a real HDRI
(below) when the scene needs to visually match a specific lighting mood/location, or needs
`scene.background` to actually show that environment behind the objects.

## Loading a real HDRI: RGBELoader / EXRLoader + PMREM

```js
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const hdrTexture = await new RGBELoader().loadAsync('/env/studio.hdr');
hdrTexture.mapping = THREE.EquirectangularReflectionMapping;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envRenderTarget = pmremGenerator.fromEquirectangular(hdrTexture);
scene.environment = envRenderTarget.texture;
// scene.background = envRenderTarget.texture; // optional — see below
hdrTexture.dispose();
pmremGenerator.dispose();
```

`EXRLoader` (`three/addons/loaders/EXRLoader.js`) is the same pattern for `.exr` files instead of
`.hdr`/RGBE — pick based on the asset format you have. Both are floating-point/HDR image formats;
don't run a regular `TextureLoader` LDR (JPG/PNG) equirect through PMREM expecting HDR-quality
results — it'll work but the dynamic range (and therefore realism of bright reflections) is
limited to what an 8-bit file can represent.

## `scene.environment` vs `scene.background`

They're independent — you can set one, the other, both to the same texture, or both to different
textures:

- `scene.environment` — drives IBL lighting/reflections on PBR materials. Invisible to the camera
  directly; it's a lighting input, not a rendered backdrop.
- `scene.background` — what actually renders behind your objects when nothing else occupies that
  pixel. Can be a color, a `CubeTexture`, or the same equirect/PMREM texture as `environment`.

A common pattern: set both to the same PMREM'd HDRI for a fully immersive look, or set only
`environment` (and leave `background` a flat color / transparent) when you want realistic lighting
without the HDRI itself visibly filling the frame — e.g. a product shot on a clean studio
backdrop lit by a photographed environment.

```js
scene.environmentIntensity = 1.0;    // dial IBL contribution up/down without re-baking
scene.backgroundBlurriness = 0.3;    // blur the visible background (0–1) — separate from IBL sharpness
scene.backgroundIntensity = 1.0;     // dial the visible background's brightness independently
```

`environmentIntensity` lets you tune how strongly the environment lights the scene relative to
direct lights without touching the HDRI file itself — start here before reaching for a different
HDRI when a PBR scene reads too flat or too blown-out.

## Baked lighting vs realtime

Realtime lights + shadows + IBL (everything above) recompute every frame and scale with light
count and shadow-casting object count. **Baked lighting** — precomputing lightmaps in a DCC tool
(Blender, etc.) and sampling them as an unlit-ish texture at runtime — trades authoring/tooling
complexity for near-zero runtime lighting cost and is common in large static environments
(architectural walkthroughs, game levels) where lights don't move. three.js doesn't include a lightmap baker;
baked lightmaps are typically authored externally and imported as a `lightMap` texture on
`MeshStandardMaterial` (a second UV channel, similar to `aoMap`) alongside reduced or removed
realtime lights. Reach for baking only once realtime lighting cost is a measured bottleneck in a
mostly-static scene — see `references/performance.md`.

## Cross-references

- Loading glTF/HDRI assets, `RGBELoader`/`EXRLoader` wiring alongside `GLTFLoader` →
  `references/loaders-and-assets.md`
- Material properties that consume lighting (`envMap`, `envMapIntensity`, `roughness`/`metalness`
  response to IBL) → `references/materials.md`
- "Material renders black" / flat / washed-out triage → `references/debugging-and-gotchas.md`
- Shadow/lighting cost tuning at scale → `references/performance.md`
