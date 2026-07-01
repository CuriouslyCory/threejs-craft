# Loaders & Assets

Getting a 3D asset from disk/CDN into the scene graph — glTF as the default format, the decoder
wiring that trips people up, format alternatives, progress tracking, and cleaning up after
yourself when a model is removed.

## Contents

- [Why glTF is the default](#why-gltf-is-the-default)
- [Canonical GLTFLoader + Draco + KTX2 + Meshopt setup](#canonical-gltfloader--draco--ktx2--meshopt-setup)
- [Parsing the loaded gltf object](#parsing-the-loaded-gltf-object)
- [Other loaders: OBJ, FBX, USDZ](#other-loaders-obj-fbx-usdz)
- [LoadingManager](#loadingmanager)
- [async/await vs callbacks](#asyncawait-vs-callbacks)
- [Hosting and path gotchas](#hosting-and-path-gotchas)
- [Disposing loaded scenes](#disposing-loaded-scenes)
- [Cross-references](#cross-references)

## Why glTF is the default

`GLTFLoader` should be the first thing you reach for. glTF ("GL Transmission Format") is the
format three.js's own tooling and ecosystem are built around, and it's designed for
runtime-delivery rather than authoring:

- Ships PBR materials (metalness/roughness) that map directly onto `MeshStandardMaterial` —
  see `references/materials.md` — with no lossy conversion.
- Binary `.glb` packs geometry, materials, and textures into one file (no separate texture
  fetches, no broken relative paths).
- Native support for the compression pipelines that matter at scale: Draco (geometry) and KTX2
  (textures) — both covered below.
- Carries animations, skinning, morph targets, and cameras in one asset — see
  `references/animation.md`.

Reach for `OBJLoader`/`FBXLoader`/`USDZLoader` only when the source asset only exists in that
format and re-exporting to glTF isn't an option — see [below](#other-loaders-obj-fbx-usdz).

## Canonical GLTFLoader + Draco + KTX2 + Meshopt setup

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/');

const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/');
ktx2Loader.detectSupport(renderer); // needs the renderer instance — call after the renderer exists

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setKTX2Loader(ktx2Loader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const gltf = await gltfLoader.loadAsync('/models/character.glb');
scene.add(gltf.scene);
```

- Only wire `DRACOLoader`/`KTX2Loader`/`MeshoptDecoder` if the asset was actually exported with
  that compression — attaching them is harmless (they're only invoked if the glTF's `extensions`
  block asks for them) but skipping a decoder the file *does* need causes a hard load failure
  with a not-obviously-related error. When unsure how an asset was exported, wiring all three
  defensively is the safe default the snippet above takes.
- `setDecoderPath`/`setTranscoderPath` point at the **decoder binaries**, not your model files —
  pull the pinned CDN paths from `assets/reference-data/addons-importmap.json` →
  `decoderHosting`, or self-host by copying `node_modules/three/examples/jsm/libs/{draco,basis}/`
  into your `public/` folder (avoids a third-party CDN dependency in production).
- `detectSupport(renderer)` on `KTX2Loader` must be called with a real renderer instance so the
  transcoder knows which compressed GPU format the device supports — see
  `references/textures.md` for the texture-level detail.
- A ready-to-copy version of this exact setup lives in
  `assets/snippets/gltf-draco-ktx2-loader.js`; a full annotated walkthrough building a model
  viewer around it is in `recipes/model-viewer.md`.

## Parsing the loaded gltf object

`GLTFLoader`'s result isn't just a scene — it's a bundle:

```js
const gltf = await gltfLoader.loadAsync('/models/scene.glb');

gltf.scene;       // THREE.Group — the root you add() to your scene
gltf.scenes;       // all scenes in the file, if it defines more than one
gltf.animations;  // THREE.AnimationClip[] — feed into an AnimationMixer, see references/animation.md
gltf.cameras;      // THREE.Camera[] — cameras authored in the file, if any
gltf.asset;        // metadata: generator, version, copyright
```

`gltf.scene` is a `Group`, not the mesh directly — a glTF file can (and often does) contain a
hierarchy of nodes/meshes; traverse it (`gltf.scene.traverse(...)`) to find/modify specific
meshes by name rather than assuming a flat structure.

## Other loaders: OBJ, FBX, USDZ

| Loader | When | Caveats |
|---|---|---|
| `OBJLoader` (+ `MTLLoader` for materials) | Legacy asset pipelines, simple static geometry from older DCC exports | No PBR material support natively (OBJ/MTL predates PBR) — materials often need manual upgrade to `MeshStandardMaterial` after load; no animation/skinning support at all |
| `FBXLoader` | Source asset only available as FBX (common from some marketplaces/DCC defaults), needs animation/skinning | FBX is a large, loosely-specified binary format — the loader covers the common cases but obscure FBX features may not round-trip; prefer re-exporting to glTF from the DCC tool when you control the pipeline |
| `USDZLoader` | Asset is Apple/USD-ecosystem-sourced (AR Quick Look assets, Pixar USD pipelines) | Narrower feature coverage than `GLTFLoader`; mainly useful for reading USDZ you don't control the export of, not as a general-purpose target format |

All three import from `three/addons/loaders/*` the same way as `GLTFLoader` — see
`assets/reference-data/addons-importmap.json`. If a source asset exists in both FBX/OBJ and glTF,
prefer the glTF export; these loaders are an escape hatch, not a first choice.

## LoadingManager

Coordinates progress/completion across **multiple** loaders and loads sharing one tracked queue —
use it when you need an aggregate "X% loaded" or a single "everything is ready" callback across
several assets, not just one:

```js
const manager = new THREE.LoadingManager();

manager.onStart = (url, itemsLoaded, itemsTotal) => { /* first load kicked off */ };
manager.onProgress = (url, itemsLoaded, itemsTotal) => {
  updateProgressBar(itemsLoaded / itemsTotal);
};
manager.onLoad = () => { /* everything queued through this manager has finished */ };
manager.onError = (url) => { console.error('failed to load', url); };

// URL rewriting — e.g. prefixing a CDN base or appending a cache-busting query param
manager.setURLModifier((url) => `${CDN_BASE}${url}?v=${BUILD_HASH}`);

const gltfLoader = new GLTFLoader(manager); // pass the manager into each loader you want tracked
const textureLoader = new THREE.TextureLoader(manager);
```

Skip it for a single one-off load — `loadAsync()` alone (or a plain `onProgress` callback on
`.load()`) is enough; reach for `LoadingManager` once you're coordinating a loading screen across
several assets or need a global URL rewrite (e.g. all asset URLs need a signed-CDN prefix).

## async/await vs callbacks

```js
// Callback style — three.js's original API, still fully supported
loader.load(
  '/models/character.glb',
  (gltf) => { scene.add(gltf.scene); },       // onLoad
  (event) => { console.log(event.loaded / event.total); }, // onProgress
  (error) => { console.error(error); },       // onError
);

// Promise style — cleaner for sequencing/error handling, same underlying loader
try {
  const gltf = await loader.loadAsync('/models/character.glb');
  scene.add(gltf.scene);
} catch (error) {
  console.error(error);
}
```

`loadAsync()` doesn't give you progress events (no onProgress equivalent on the promise) — use
the callback form or a `LoadingManager` when progress reporting matters; use `loadAsync` when you
just need `await`-able sequencing (e.g. loading several assets with `Promise.all`, or gating scene
setup behind load completion).

## Hosting and path gotchas

- **`public/` folder (Next.js/Vite/etc.).** Static assets referenced by an absolute path like
  `/models/character.glb` are served from the framework's public/static directory — verify your
  framework's convention (Next.js: `public/`; Vite: `public/`) and that the deployed build
  actually includes the file (some CI pipelines exclude large binaries by accident).
- **Base path / subpath deployments.** If the app is deployed under a subpath (e.g.
  `example.com/app/`), a hardcoded absolute `/models/...` path breaks — use the framework's
  asset-base-URL mechanism (e.g. Next.js `basePath`, Vite `import.meta.env.BASE_URL`) rather than
  a literal leading slash, or route all loads through a `LoadingManager` URL modifier that
  prepends the correct base.
- **CORS.** Loading a model/texture from a different origin (a CDN, another domain) requires that
  origin to send permissive CORS headers, or the browser blocks the fetch — this shows up as a
  network-tab error, not a three.js error, so check the browser's network/console tab first when
  a cross-origin asset silently fails to load. Same-origin hosting sidesteps this entirely.
- **Case sensitivity.** Most production static hosts are case-sensitive even if your local dev
  filesystem isn't (macOS default) — a path that works locally can 404 in production purely from
  a casing mismatch.

## Disposing loaded scenes

A loaded `gltf.scene` brings its own geometries, materials, and textures — removing it from the
scene graph does **not** free that GPU memory (invariant 6). Traverse and dispose explicitly:

```js
function disposeObject(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      // dispose every texture slot the material might hold — see references/materials.md
      for (const key of Object.keys(material)) {
        const value = material[key];
        if (value && value.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}

scene.remove(gltf.scene);
disposeObject(gltf.scene);
```

The `for...of Object.keys(material)` sweep catches every texture slot generically (`map`,
`normalMap`, `roughnessMap`, `envMap`, …) without hardcoding each property name — useful because
different material types expose different texture slots and glTF materials can populate any
subset of them. Watch out for **shared textures/materials** (e.g. an instanced/repeated asset, or
a texture reused across multiple loaded models) — disposing a texture still referenced elsewhere
breaks the other user; only run this on assets you know aren't shared, or track reference counts
yourself. In React Three Fiber this traversal happens automatically on unmount for anything
created inside the declarative tree — see `references/react-three-fiber.md`.

## Cross-references

- Ready-to-copy loader setup → `assets/snippets/gltf-draco-ktx2-loader.js`
- Full annotated model-viewer build → `recipes/model-viewer.md`
- KTX2 texture compression detail (colorSpace, transcoder formats) → `references/textures.md`
- HDRI loading (`RGBELoader`/`EXRLoader`) for environment maps → `references/lighting-and-env.md`
- Material disposal alongside geometry/texture disposal → `references/materials.md`
- Animation clips/mixer from `gltf.animations` → `references/animation.md`
- Pinned decoder/CDN paths → `assets/reference-data/addons-importmap.json`
