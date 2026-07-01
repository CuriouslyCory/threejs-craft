# Recipe: Model Viewer (load & display a .glb)

**What you'll build:** a scene that loads a `.glb`, frames it correctly regardless of its
authored scale/pivot, lights it so PBR materials read correctly, lets the user orbit it, plays
any embedded animation, and cleans up after itself. **When to use this:** product viewers,
asset preview tools, portfolio pieces, "drop in a model and look at it" features — the single
most common three.js task after "make a spinning cube."

Pinned versions: three 0.185.1 (r185), r3f 9.6.1, drei 10.7.7 — see
`assets/reference-data/version-map.json`. This recipe gives both a vanilla and an r3f version;
per `SKILL.md` decision gate 2, use r3f in this repo (Next.js) unless a standalone vanilla scene
is explicitly requested.

## Table of contents

- [The pieces, in order](#the-pieces-in-order)
- [Vanilla three.js](#vanilla-threejs)
- [React Three Fiber](#react-three-fiber)
- [Pitfalls](#pitfalls)
- [Cross-references](#cross-references)

## The pieces, in order

A correct model viewer is five concerns stacked, each independently a common source of bugs:

1. **Load** — `GLTFLoader` + `DRACOLoader` (mesh compression) + `KTX2Loader` (texture
   compression), because most production glb exports use one or both. Full wiring:
   `references/loaders-and-assets.md`; paste-ready: `assets/snippets/gltf-draco-ktx2-loader.js`.
2. **Frame** — compute a bounding box/sphere of the loaded scene and position the camera (and
   controls target) to fit it, because you cannot assume the model's authored scale, units, or
   pivot. A model authored in centimeters (glTF convention is meters, but not everyone follows
   it) can be 100x too small or too large for a camera positioned by eyeballing it.
3. **Light** — a PBR material (`MeshStandardMaterial`/`MeshPhysicalMaterial`, what glTF exports
   almost always use) needs an environment map or it renders flat/black. See
   `references/lighting-and-env.md`.
4. **Control** — `OrbitControls` so the user can actually look at the thing.
5. **Animate** — if the glb carries `gltf.animations`, wire an `AnimationMixer` and play them.
   See `references/animation.md`.
6. **Dispose** — on unload/unmount, free geometries/materials/textures the loader created
   (invariant 6). r3f does this automatically for its own JSX tree; vanilla is on you.

## Vanilla three.js

### 1. Loader setup (Draco + KTX2)

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/');

const ktx2Loader = new KTX2Loader()
  .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/')
  .detectSupport(renderer); // must run after the renderer exists — it probes GPU format support

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setKTX2Loader(ktx2Loader);
```

Don't hand-roll this every time — it's captured verbatim, with the "why a decoder path at all"
explanation, in `assets/snippets/gltf-draco-ktx2-loader.js` and the full wiring writeup
(including self-hosting the decoder files instead of CDN, and when you can skip Draco/KTX2
entirely) lives in `references/loaders-and-assets.md`. The two loaders only cost anything if the
glb actually uses that compression — wiring them unconditionally is cheap insurance, not a
performance tax on uncompressed assets.

### 2. Load and add to scene

```js
const gltf = await gltfLoader.loadAsync('/models/chair.glb');
const model = gltf.scene; // a Group — glTF scenes are always a Group, even for a single mesh
scene.add(model);
```

### 3. Fit-camera-to-object

Compute the model's bounding box/sphere *after* it's added to the scene graph (so any
`scene.add` side effects and matrix updates are settled), then derive a camera distance from
the object's radius and the camera's fov:

```js
function frameObject(object, camera, controls) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fovRad = camera.fov * (Math.PI / 180);
  // Distance so the object's largest dimension fits vertically in the frustum,
  // with a little headroom (the 1.5 factor) so it isn't edge-to-edge.
  const distance = (maxDim / 2 / Math.tan(fovRad / 2)) * 1.5;

  const direction = new THREE.Vector3(0, 0, 1); // approach from +Z; pick any consistent viewing angle
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = distance / 100;   // keep the near/far ratio sane for this object's scale — see debugging-and-gotchas.md
  camera.far = distance * 100;
  camera.updateProjectionMatrix(); // required after touching near/far — see cameras-and-controls.md

  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
}

frameObject(model, camera, controls);
```

This is the fix for "model renders as a tiny dot" or "camera is inside the model and screen is
black" — both are the same root cause (camera positioned without regard for the model's actual
world-space size) and both disappear once framing is scale-aware instead of hardcoded.
`Box3.setFromObject` walks the full subtree, so it works whether the glb is one mesh or a
100-node hierarchy.

### 4. Environment for PBR lighting

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();
```

`RoomEnvironment` is the right default here — a procedural neutral studio environment with no
HDRI file to fetch, good enough for "does the material read as physically plausible" in a
generic viewer. Swap for a loaded HDRI (`RGBELoader` + PMREM) if the product needs a specific
lighting mood. Full explanation of *why* PBR materials need this at all:
`references/lighting-and-env.md`.

### 5. OrbitControls

```js
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// controls.target and camera.position are set by frameObject() above —
// call controls.update() after, which frameObject() already does.
```

Paste-ready version: `assets/snippets/orbit-controls.js`. Full API:
`references/cameras-and-controls.md`.

### 6. Play embedded animations, if present

```js
let mixer;
if (gltf.animations.length > 0) {
  mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(gltf.animations[0]).play(); // or look up by name — see references/animation.md
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  mixer?.update(delta);
  controls.update(); // required while enableDamping is true
  renderer.render(scene, camera);
});
```

Not every glb carries animation — always guard on `gltf.animations.length`. Full clip-selection,
cross-fade, and skinning detail: `references/animation.md`.

### 7. Dispose on unload

```js
function disposeModel(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        mat[key]?.dispose();
      }
      mat.dispose();
    }
  });
  scene.remove(root);
}

function teardown() {
  mixer?.stopAllAction();
  disposeModel(model);
  scene.environment?.dispose?.(); // if this viewer owns the environment texture exclusively
  controls.dispose();
  renderer.setAnimationLoop(null);
  renderer.dispose();
}
```

This is invariant 6, applied to a loaded model specifically: geometries, materials, *and* every
texture slot a material holds are separate GPU objects that all need their own `.dispose()` —
disposing the material does not cascade to its textures. See `references/materials.md` for the
full disposal reference and `references/loaders-and-assets.md` for the traverse-and-dispose
pattern in more depth (including caveats around textures shared across multiple materials).

## React Three Fiber

r3f + drei collapses most of the above into three components. This is the idiomatic version for
this repo (Next.js + r3f, per `SKILL.md` decision gate 2).

### Simplest: `useGLTF` + drei `<Stage>`

`<Stage>` handles centering, ground-fitting, and studio lighting/environment in one component —
the fastest path to "model looks correct" for a generic viewer:

```jsx
import { Canvas } from '@react-three/fiber';
import { useGLTF, Stage, OrbitControls } from '@react-three/drei';

function Model({ url }) {
  const { scene } = useGLTF(url); // suspends until loaded; cached by url
  return <primitive object={scene} />;
}

export default function ModelViewer({ url }) {
  return (
    <Canvas camera={{ position: [3, 2, 4], fov: 50 }}>
      <Suspense fallback={null}>
        <Stage environment="city" intensity={0.6}>
          <Model url={url} />
        </Stage>
      </Suspense>
      <OrbitControls enableDamping makeDefault />
    </Canvas>
  );
}
```

- **`useGLTF(url)`** wraps `GLTFLoader` with React Suspense — wrap the caller in
  `<Suspense fallback={...}>`. It caches by URL, so mounting the same model twice doesn't
  re-fetch/re-parse. `useGLTF.preload(url)` warms the cache before the component mounts (route
  transitions, hover-to-preload patterns).
- **`<Stage>`** centers the model, computes a fitting camera-friendly radius, and sets up an
  `<Environment>` + shadow-catcher ground plane — it's doing steps 2–3 from the vanilla version
  for you. `intensity` tunes the environment/light strength; `environment="city"` picks a drei
  HDRI preset (network fetch at runtime — see caveats in `references/react-three-fiber.md`).
- **`<primitive object={scene} />`** is how you drop an imperatively-constructed three.js object
  (the loaded glTF scene graph) into r3f's JSX tree — r3f doesn't know how to declare arbitrary
  loaded content declaratively, so `primitive` is the escape hatch.

### More control: `useGLTF` + drei `<Bounds>` + manual `<Environment>`

Reach for this when `<Stage>`'s opinionated ground-plane/shadow setup doesn't fit (e.g. no
ground plane wanted, or you need the model un-centered relative to other scene content) but you
still want automatic fit-to-view instead of hand-computing a `Box3` like the vanilla version:

```jsx
import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF, Bounds, Environment, OrbitControls } from '@react-three/drei';

function Model({ url }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

export default function ModelViewer({ url }) {
  return (
    <Canvas camera={{ position: [3, 2, 4], fov: 50 }}>
      <Suspense fallback={null}>
        <Environment preset="city" />
        <Bounds fit clip observe margin={1.2}>
          <Model url={url} />
        </Bounds>
      </Suspense>
      <directionalLight position={[5, 5, 5]} intensity={1.2} />
      <OrbitControls enableDamping makeDefault />
    </Canvas>
  );
}
```

- **`<Bounds fit clip observe>`** is drei's declarative fit-camera-to-object — `fit` animates the
  camera to frame its children on mount, `clip` adjusts near/far to the fitted content, `observe`
  re-fits if the children's bounds change later (e.g. swapping models). This is the r3f
  equivalent of the vanilla `frameObject()` function above; verify current prop names with
  `scripts/docs_lookup.mjs Bounds` if behavior looks off — `Bounds`' prop surface has shifted
  across drei versions.
- Environment is separate here (not bundled the way `<Stage>` does it) — `<Environment
  preset="city">` fetches a drei-hosted HDRI and PMREM-processes it, same effect as the vanilla
  `RoomEnvironment` + `PMREMGenerator` block but wired for you. Swap `preset` for `files="/env/
  studio.hdr"` to load a specific HDRI instead of a preset.

### Animations: drei `useAnimations`

```jsx
import { useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';

function AnimatedModel({ url }) {
  const group = useRef();
  const { scene, animations } = useGLTF(url);
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    const first = animations[0]?.name;
    if (first) actions[first]?.play();
    return () => actions[first]?.stop(); // cleanup on unmount/url change
  }, [actions, animations]);

  return <primitive ref={group} object={scene} />;
}
```

`useAnimations` wraps the `AnimationMixer` setup/update/cleanup from the vanilla version (step 6)
— it creates the mixer bound to `group`, drives `mixer.update()` from r3f's internal render
loop, and returns an `actions` map keyed by clip name so you don't hand-build the
`clipsByName` lookup yourself. See `references/animation.md` for the underlying mixer semantics
this wraps, and `references/react-three-fiber.md` for more `useAnimations` detail.

### Disposal in r3f

Unmounting `ModelViewer` disposes the `<Canvas>`'s renderer/context automatically, and any
geometries/materials r3f created via JSX (`<primitive>`'s subtree included, since `primitive`
still participates in r3f's disposal tracking for objects it didn't itself construct — verify
current behavior with `scripts/docs_lookup.mjs` or `references/react-three-fiber.md` if unsure)
are cleaned up on unmount. `useGLTF`'s cache is the one thing that persists across unmounts by
design (so remounting the same URL is instant) — call `useGLTF.clear(url)` if you need to force
a cache eviction (e.g. a memory-constrained viewer cycling through many large models).

## Pitfalls

- **Model too dark / looks unlit / metallic parts render black.** No `scene.environment` (or
  drei `<Environment>`/`<Stage>`) set. `MeshStandardMaterial`/`MeshPhysicalMaterial` — what
  glTF exports almost always use — need IBL for their specular response; direct lights alone
  leave them flat. See `references/lighting-and-env.md` and the black-material entry in
  `references/debugging-and-gotchas.md`.
- **Wrong scale/units — model is a tiny dot or fills/exceeds the whole frustum.** Don't
  hardcode camera distance; always fit-to-bounds (vanilla `frameObject()` / drei `<Bounds>` or
  `<Stage>`). Also watch the `near`/`far` ratio once you know the object's real scale — a camera
  tuned for a 1-unit cube will z-fight or clip a 1000-unit architectural model. See
  `references/cameras-and-controls.md`.
- **Decoder paths wrong / Draco or KTX2 assets fail silently or throw in the console.**
  `DRACOLoader.setDecoderPath` / `KTX2Loader.setTranscoderPath` must point at a location that
  actually serves the decoder binaries (CDN or a copied `node_modules/three/examples/jsm/libs/
  {draco,basis}/` folder in your `public/`) — a wrong path is a runtime failure, not a build-time
  one, so it only surfaces when a compressed glb is actually loaded. See
  `references/loaders-and-assets.md` and `assets/reference-data/addons-importmap.json` →
  `decoderHosting` for the pinned CDN paths.
- **`KTX2Loader.detectSupport(renderer)` called before the renderer exists**, or omitted
  entirely — it needs the renderer to probe which compressed texture formats the GPU actually
  supports; skipping it is a common "KTX2 textures don't load" report.
- **Forgetting `gltf.animations.length` guard** — not every model has embedded clips; calling
  `mixer.clipAction(gltf.animations[0])` on an empty array throws.
- **Leaking on repeated loads** (a viewer that swaps models) — dispose the previous model's
  geometries/materials/textures before/after swapping in vanilla three.js (step 7 above); in
  r3f, prefer keying the component on `url` (`<Model key={url} url={url} />`) so React unmounts
  the old subtree (triggering r3f's automatic disposal) instead of mutating in place.

## Cross-references

- `references/loaders-and-assets.md` — full GLTFLoader/Draco/KTX2 wiring, LoadingManager,
  other formats (`.fbx`/`.obj`/`.usdz`)
- `references/lighting-and-env.md` — PMREMGenerator, RoomEnvironment, HDRI loading,
  `scene.environment` vs `scene.background`
- `references/animation.md` — AnimationMixer, clip selection, skinning
- `references/cameras-and-controls.md` — OrbitControls API, near/far tuning
- `references/react-three-fiber.md` — Suspense + `useGLTF` caching model, `<Canvas>` defaults
- `references/debugging-and-gotchas.md` — black-material and z-fighting triage
- `assets/snippets/gltf-draco-ktx2-loader.js`, `assets/snippets/orbit-controls.js` — paste-ready
  fragments used above
