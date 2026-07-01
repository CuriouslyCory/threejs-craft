# Textures

A texture is pixels plus metadata — but that metadata (colorSpace, wrapping, filtering) is where
almost every "my model looks wrong" bug actually lives. The pixels are rarely the problem.

## Loading

```js
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const colorTexture = loader.load('/textures/albedo.jpg');
// or, for code that needs to know when it's ready:
const colorTexture = await loader.loadAsync('/textures/albedo.jpg');
```

`load()` returns immediately with a texture that fills in once the image decodes — fine for
fire-and-forget assignment to a material property. Use `loadAsync()` (or a `LoadingManager`, see
`references/loaders-and-assets.md`) when you need to know loading actually completed, e.g. before
a screenshot or a "ready" state.

## The colorSpace rule — the #1 color bug

This is invariant 3 and it deserves the full explanation, because getting it backwards is the
single most common three.js visual bug.

**Why it exists:** image files (JPG/PNG/WebP) store color data gamma-encoded (sRGB) because
that's how 8-bit files avoid visible banding in dark tones. But normal/roughness/metalness/AO
maps aren't *colors* — they're numeric data (a direction, a scalar) smuggled into pixel channels.
If you tell the renderer "this is sRGB-encoded color" for a data map, it applies a gamma decode
curve to numbers that were never gamma-encoded in the first place, corrupting every value. Do the
reverse for a color map — skip the decode — and colors look washed out or too dark.

**The rule:**

| Texture role | `colorSpace` | Examples |
|---|---|---|
| Color data (perceptual/visual) | `THREE.SRGBColorSpace` | `map` (albedo), `emissiveMap`, environment/background textures |
| Numeric data (not visual color) | `THREE.NoColorSpace` (the default — usually leave untouched) | `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, displacement/height maps |

```js
const albedo = loader.load('/textures/albedo.jpg');
albedo.colorSpace = THREE.SRGBColorSpace; // explicit — don't rely on defaults for color maps

const normal = loader.load('/textures/normal.jpg');
// leave normal.colorSpace at its default (NoColorSpace / linear) — do NOT set SRGBColorSpace
```

`renderer.outputColorSpace = THREE.SRGBColorSpace` (set once on the renderer, see
`references/renderers-and-setup.md`) is a *separate* setting — it controls the final
framebuffer-to-display conversion, not per-texture decoding. Both need to be correct
independently. If colors look washed out, too dark, or normal maps look like they're lighting the
surface *inward*, this is the first thing to check — full triage in
`references/debugging-and-gotchas.md`. See also `assets/snippets/color-management.js` for a
ready-to-paste helper that sets this correctly across a texture set.

## Wrapping and repeat

```js
texture.wrapS = THREE.RepeatWrapping;   // horizontal (U) — RepeatWrapping | ClampToEdgeWrapping (default) | MirroredRepeatWrapping
texture.wrapT = THREE.RepeatWrapping;   // vertical (V)
texture.repeat.set(4, 4);               // tile 4x4 across the UV range
texture.offset.set(0.5, 0);             // shift the UV origin
texture.center.set(0.5, 0.5);           // pivot for rotation
texture.rotation = Math.PI / 4;
```

- `ClampToEdgeWrapping` (the default) stretches the edge pixel when `repeat > 1` or UVs exceed
  `[0,1]` — the classic "why is my texture smeared at the edges" bug is forgetting to set
  `RepeatWrapping` before setting `repeat`.
- `MirroredRepeatWrapping` alternates flip direction each tile — useful for tileable textures that
  weren't authored to seam cleanly.
- `wrapS`/`wrapT` must be set **before** the first render for the change to take effect reliably;
  if changing at runtime, also set `texture.needsUpdate = true`.

## Filtering and mipmaps

```js
texture.magFilter = THREE.LinearFilter;              // when sampled larger than native size (only Linear|Nearest valid)
texture.minFilter = THREE.LinearMipmapLinearFilter;   // when sampled smaller — default; trilinear filtering
texture.generateMipmaps = true;                       // default true; needs power-of-two-friendly sizes for full quality historically, but WebGL2 handles NPOT mipmaps
```

- `minFilter` with a `Mipmap` variant (`NearestMipmapNearest`, `LinearMipmapNearest`,
  `NearestMipmapLinear`, `LinearMipmapLinearFilter`) requires `generateMipmaps` to actually
  produce the chain — mipmaps trade a bit of upload cost/memory for eliminating shimmer/aliasing
  on minified textures (distant ground planes, repeating patterns). Turn `generateMipmaps` off
  only when you know the texture is always viewed near-1:1 (UI textures, some baked lightmaps) to
  save memory and upload time.
- `magFilter = NearestFilter` gives the blocky pixel-art look; `minFilter = NearestFilter` (no
  mipmap variant) similarly for a retro/voxel aesthetic.

## Anisotropy

```js
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
```

Anisotropic filtering sharpens textures viewed at a grazing angle (ground planes, road surfaces
receding into the distance) — without it they blur out faster than they should. Cost is small
relative to the visual win; query the hardware max rather than hardcoding a number, since it
varies by GPU (commonly 8 or 16). Not free on very low-power/mobile GPUs — drop it if profiling
shows it matters.

## flipY and premultiplyAlpha

```js
texture.flipY = true; // default — most image loaders assume this
```

- `flipY` defaults to `true` because image formats store rows top-to-bottom while WebGL's texture
  coordinate origin is bottom-left; three.js compensates by default. Set it `false` when feeding
  in data that's already oriented for GPU consumption (some compressed/KTX2 textures, render
  target readbacks) — getting this wrong shows up as a vertically flipped texture.
- `premultiplyAlpha` controls whether RGB is pre-multiplied by alpha on upload; mismatch between a
  texture's actual encoding and this flag shows up as dark/black fringing on transparent edges.
  Leave at the default unless you know your source asset is premultiplied.

## `needsUpdate`

```js
texture.needsUpdate = true;
```

Required after mutating a texture's pixel data or most sampling parameters (`wrapS`, `wrapT`,
`minFilter`, `magFilter`, changing `.image`) post-creation — three.js caches the GPU upload and
won't re-sync automatically. Not needed for `.offset`/`.repeat`/`.rotation` (those are shader
uniforms, applied every frame). When in doubt after a runtime texture mutation and nothing
visually changed, this is the first thing to check.

## Compressed textures: KTX2 and Basis

Regular JPG/PNG textures decode to full-size uncompressed pixels in GPU memory — a 4K albedo map
can be tens of MB of VRAM. KTX2 (via the Basis Universal supercompression format) stays compressed
on the GPU, cutting VRAM and often load time dramatically. Reach for it on texture-heavy scenes
(product configurators, large environments) once JPG/PNG VRAM pressure becomes a real problem —
it adds a transcoder step, so it's not worth it for a handful of small textures.

```js
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const ktx2Loader = new KTX2Loader()
  .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/')
  .detectSupport(renderer); // MUST be called — queries the renderer for which GPU formats it supports

const compressedTexture = await ktx2Loader.loadAsync('/textures/albedo.ktx2');
```

- The transcoder path is the WASM/JS Basis Universal transcoder, not the texture itself — pull the
  pinned path from `assets/reference-data/addons-importmap.json` → `decoderHosting.ktx2Basis`, or
  self-host by copying `node_modules/three/examples/jsm/libs/basis/` into your `public/` folder.
- `detectSupport(renderer)` is not optional — it's how the loader picks a target GPU compression
  format (BC7, ASTC, ETC2, …) that the current device actually supports; skip it and transcoding
  can fail or pick a suboptimal format.
- This is the same `KTX2Loader` instance you'd attach to a `GLTFLoader` for glTF assets authored
  with KTX2-compressed textures — see `references/loaders-and-assets.md`.
- colorSpace still applies the same way to a KTX2 texture as any other — set `SRGBColorSpace` on
  color textures, leave data textures linear.

## DataTexture, CanvasTexture, VideoTexture

```js
// Raw pixel data you generate/compute yourself (procedural, heightmaps, GPU readback targets)
const data = new Uint8Array(width * height * 4);
const dataTexture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
dataTexture.needsUpdate = true;

// Draw with the 2D canvas API, use the result as a texture (dynamic UI-on-a-mesh, generated patterns)
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
// ...draw...
const canvasTexture = new THREE.CanvasTexture(canvas);

// A <video> element as a live-updating texture (video screens, camera feeds)
const video = document.createElement('video');
video.src = '/clip.mp4';
video.loop = true;
video.muted = true; // required for autoplay in most browsers
video.play();
const videoTexture = new THREE.VideoTexture(video);
// VideoTexture updates itself automatically each frame the video advances — no needsUpdate needed
```

All three still follow the colorSpace rule if the content represents visible color (video and
canvas content usually do — set `SRGBColorSpace`); a procedural `DataTexture` used for non-color
data (a heightmap, a lookup table) should stay `NoColorSpace`.

## Disposing textures

```js
texture.dispose();
```

Frees the GPU-side upload. Loading the same URL repeatedly without disposal (e.g. re-loading a
texture on every remount in a manual, non-r3f setup) is a classic leak — invariant 6. Textures
referenced by a material's map properties are **not** auto-disposed when the material is disposed
— dispose both explicitly, covered in `references/materials.md`. In React Three Fiber, textures
loaded via `useLoader`/drei's `useTexture` are cached and disposed automatically on unmount when
nothing else references them — see `references/react-three-fiber.md`.

## Cross-references

- Material texture slots (`map`, `normalMap`, `roughnessMap`, …) and disposal alongside materials
  → `references/materials.md`
- Environment maps specifically (PMREM processing, HDRI loading) → `references/lighting-and-env.md`
- KTX2/Draco wired onto `GLTFLoader` → `references/loaders-and-assets.md`
- Washed-out/too-dark colors, flipped normals, other visual triage → `references/debugging-and-gotchas.md`
- Ready-to-paste colorSpace helper → `assets/snippets/color-management.js`
