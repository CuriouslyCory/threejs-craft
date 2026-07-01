# Animation — AnimationMixer, clips, skinning, morph targets

Renderer-agnostic: `AnimationMixer`, `AnimationClip`, and `AnimationAction` live in `three`
core and work identically on WebGL and WebGPU — only the render loop that drives them differs
in setup (see `references/renderers-and-setup.md`).

## Mental model

Three layers, each wrapping the one below:

- **`AnimationClip`** — a named, reusable bundle of `KeyframeTrack`s (e.g. "Walk", "Jump").
  Data only, no playback state. Comes from a loaded glTF (`gltf.animations`) or built by hand.
- **`AnimationAction`** — playback state for one clip on one mixer: play/pause, loop mode,
  weight, time scale, blending. You get one via `mixer.clipAction(clip)`; calling
  `clipAction` again with the same clip+root returns the *same* action, not a new one.
- **`AnimationMixer`** — the player, bound to one root object (the model/rig). Owns the clock
  math for every action created from it and writes the resulting bone/morph/property values
  into the scene graph when you call `mixer.update(delta)`.

```js
const mixer = new THREE.AnimationMixer(model); // root = the object whose properties get animated
const action = mixer.clipAction(walkClip);
action.play();
```

## Driving the mixer

Update with **seconds**, not milliseconds, once per frame inside `setAnimationLoop` (invariant
4) — never a raw `requestAnimationFrame`, and never skip frames' worth of delta on tab-away
(a huge delta after `document.hidden` can snap animations forward violently; clamp it if you
back the clock with wall-clock time).

```js
import * as THREE from 'three';

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta(); // seconds since last call
  mixer.update(delta);
  renderer.render(scene, camera);
});
```

`Clock` handles the delta math for you (`getDelta()` returns seconds and resets its internal
timer); don't hand-roll `performance.now()` subtraction unless you need multiple independently
paced clocks (e.g. one for animation, one for a slow-motion shader effect).

## Play / stop / cross-fade / weight / timeScale / loop

```js
const idle = mixer.clipAction(idleClip);
const walk = mixer.clipAction(walkClip);

idle.play();

// Cross-fade from idle to walk over 0.3s — both actions must be playing/enabled
// during the blend, crossFadeTo handles the weight ramp for you.
function startWalking() {
  walk.reset().play();
  idle.crossFadeTo(walk, 0.3, false); // false = don't warp timeScale during the blend
}

// Fade a single action in/out without a second action to blend against
walk.fadeIn(0.2);
walk.fadeOut(0.2); // schedules stop; action keeps playing until the fade completes

// Direct control
walk.timeScale = 1.5;      // playback speed multiplier (negative = reverse)
walk.weight = 0.7;         // blend contribution, 0..1, when layering multiple actions
walk.setLoop(THREE.LoopRepeat, Infinity); // default; also LoopOnce, LoopPingPong
walk.clampWhenFinished = true;  // with LoopOnce, hold the last frame instead of snapping back
walk.stop();                // hard stop, resets to bind pose next update
```

- **`play()`** doesn't reset time — call `.reset()` first if you want it to restart from frame
  0 (e.g. re-triggering a one-shot action like a jump).
- **`crossFadeTo(otherAction, duration, warp)`** ramps this action's weight to 0 and the
  target's to 1 over `duration`; `warp` additionally interpolates `timeScale` between the two
  actions during the blend — leave `false` unless the two clips have very different native
  speeds you want to time-warp together.
- **Loop modes**: `LoopRepeat` (default, loops `repetitions` times, default `Infinity`),
  `LoopOnce` (plays once, then either resets to bind pose or holds — see
  `clampWhenFinished` — dispatches a `'finished'` event on the mixer), `LoopPingPong`
  (forward then reverse, alternating).
- Multiple actions on the same mixer can play simultaneously with different `weight`s to blend
  (e.g. upper-body "wave" layered over lower-body "walk") — this is additive/blended
  animation, distinct from `crossFadeTo`'s exclusive transition.

Listen for completion on the **mixer**, not the action:

```js
mixer.addEventListener('finished', (e) => {
  if (e.action === jumpAction) returnToIdle();
});
```

## Clips shipped inside a loaded glTF

Most rigged/animated assets carry their clips embedded — read them off the loader result
rather than building `KeyframeTrack`s by hand. See `references/loaders-and-assets.md` for the
full `GLTFLoader` wiring; the animation-relevant slice:

```js
const gltf = await loader.loadAsync('/models/character.glb');
scene.add(gltf.scene);

const mixer = new THREE.AnimationMixer(gltf.scene); // root = the loaded scene graph
const clipsByName = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));

mixer.clipAction(clipsByName['Walk']).play();
```

`gltf.animations` is an array of `AnimationClip`; names come from whatever the DCC tool
(Blender, Maya) exported them as — log `gltf.animations.map(c => c.name)` if you're not sure
what's available. `THREE.AnimationClip.findByName(gltf.animations, 'Walk')` is an equivalent
lookup helper if you prefer not to build the map yourself.

## Skinned meshes: SkinnedMesh + Skeleton

For rigged characters, three.js deforms geometry per-frame by blending vertex positions across
a bone hierarchy — this is what makes bone-driven clips (walk cycles, facial rigs) move mesh
vertices instead of just transforming a rigid object.

- **`Skeleton`** — holds the flat array of `Bone` objects (each a plain `Object3D` subclass)
  plus their inverse bind matrices.
- **`SkinnedMesh`** — a `Mesh` subclass whose geometry carries `skinIndex`/`skinWeight`
  attributes (up to 4 bone influences per vertex) and which references a `Skeleton`.

You almost never construct these by hand — they come out of `GLTFLoader`/`FBXLoader` already
wired up. High-level things worth knowing:

- `SkinnedMesh.bindMode` (`'attached'` default vs `'detached'`) controls how the mesh's own
  transform composes with the skeleton — leave at default unless you know you need detached
  binding (e.g. sharing one skeleton's animation across multiple separately-transformed
  meshes).
- Bones are ordinary scene-graph nodes: you *can* reach in and manually rotate a bone (e.g.
  procedural look-at for a head bone layered on top of clip playback) — just do it **after**
  `mixer.update()` in the same frame so your manual tweak isn't overwritten by the clip.
- Skinning math runs on the GPU (vertex shader / compute) once wired — verify exact
  `SkinnedMesh`/`Skeleton` constructor and method signatures with
  `scripts/docs_lookup.mjs SkinnedMesh` before hand-authoring one; this is a case where a
  guessed signature is easy to get subtly wrong (bind matrix order, bone texture vs uniform
  array path depending on bone count).

## Morph targets (blend shapes)

For non-skeletal deformation — facial expressions, viseme/lip-sync, cloth corrective shapes —
geometry carries alternate vertex position sets (`morphAttributes.position`) blended by weight.

```js
// mesh.morphTargetDictionary maps name -> index, populated by the loader
const smileIndex = mesh.morphTargetDictionary['Smile'];
mesh.morphTargetInfluences[smileIndex] = 0.8; // 0..1 blend weight, set directly per frame
```

`morphTargetInfluences` is a plain array you can also drive through an `AnimationClip` (a
`NumberKeyframeTrack` targeting `.morphTargetInfluences[n]`) for authored facial animation
exported from a DCC tool — glTF morph-target clips round-trip this way automatically through
`GLTFLoader`, same as skeletal clips above.

## Building KeyframeTracks + AnimationClip by hand

Reach for this only when you need a procedural or generated clip with no source DCC file (e.g.
programmatically generated camera fly-throughs, or baking a physics sim to a replayable clip).
For anything hand-authored by a human, author it in Blender/Maya and export glTF instead —
it's a better tool for the job than hand-writing keyframe arrays.

```js
// Track format: times[] (seconds) + values[] (flattened, stride = value size).
// VectorKeyframeTrack stride 3 (x,y,z per key); QuaternionKeyframeTrack stride 4 (x,y,z,w).
const positionTrack = new THREE.VectorKeyframeTrack(
  '.position',           // property path relative to the animated root
  [0, 1, 2],              // times in seconds
  [0, 0, 0,  0, 2, 0,  0, 0, 0], // flattened (x,y,z) per keyframe
);

const clip = new THREE.AnimationClip('bounce', 2, [positionTrack]); // name, duration, tracks

const mixer = new THREE.AnimationMixer(mesh);
mixer.clipAction(clip).play();
```

- Track name syntax targets a property path, optionally scoped to a named child:
  `'boneName.quaternion'` for a specific bone inside the mixer's root, `'.material.opacity'`
  for a material property. Verify exact path syntax and available track types
  (`VectorKeyframeTrack`, `QuaternionKeyframeTrack`, `NumberKeyframeTrack`,
  `BooleanKeyframeTrack`, `ColorKeyframeTrack`, `StringKeyframeTrack`) with
  `scripts/docs_lookup.mjs KeyframeTrack` — the interpolation modes
  (`InterpolateLinear`/`InterpolateDiscrete`/`InterpolateSmooth`) are a common signature to get
  wrong from memory.
- `AnimationClip.CreateFromMorphTargetSequence` / `AnimationUtils` helpers exist for common
  hand-built patterns (e.g. sequencing a set of morph targets) — look those up rather than
  reimplementing.

## Procedural animation vs clip playback

Not everything needs `AnimationMixer`. Two legitimate approaches, pick per-object:

| Approach | When |
|---|---|
| **Procedural** (mutate `position`/`rotation`/`uniform` directly inside `setAnimationLoop`, driven by `clock.elapsedTime`) | Simple continuous motion (spin, bob, orbit), reactive-to-input motion, anything cheaper to compute than to author as keyframes |
| **Clip playback** (`AnimationMixer`) | Authored character/rig animation, anything with complex timing/easing baked in a DCC tool, anything needing blending/cross-fades between named states |

```js
// Procedural: no mixer needed for a simple continuous spin
renderer.setAnimationLoop(() => {
  mesh.rotation.y = clock.getElapsedTime() * 0.5;
  renderer.render(scene, camera);
});
```

Mixing the two on the same object is fine (e.g. clip-driven walk cycle + procedural head
look-at layered on top, as noted under Skinning above) as long as you order writes correctly
within the frame: `mixer.update()` first, then procedural overrides, then render.

## Mixing with animation libraries (GSAP / tween.js)

`AnimationMixer` is for **clip-based** playback (multiple tracks, blending, loop modes tied to
a rig or scene graph). For one-off UI-style tweens — ease a camera to a new position, fade an
opacity, punch-scale an object on click — a tweening library is often less code:

- **GSAP**, **tween.js** — both work fine against three.js properties (`position`, `rotation`,
  material `opacity`, etc.) since they're just tweening plain numbers on JS objects; three.js
  has no opinion about who writes to `mesh.position.x` each frame.
- Don't run a GSAP tween and an `AnimationMixer`-driven track against the *same* property on
  the same object simultaneously — last writer in the frame wins, and you get fighting/jitter.
  Partition responsibility per-property (mixer owns the rig, GSAP owns a camera move) or per
  time window (sequence them).
- Neither library needs to know about `setAnimationLoop` — GSAP's ticker and tween.js's
  `update()` are typically driven by their own RAF-equivalent or `.update()` called from your
  existing loop; call `TWEEN.update()` alongside `mixer.update(delta)` in the same callback if
  using tween.js.

## Dispose / stop on teardown

Actions and the mixer hold references into the scene graph and internal caches; on
unmount/scene-teardown (invariant 6):

```js
function dispose() {
  mixer.stopAllAction();
  mixer.uncacheRoot(model); // drops cached bindings for this root; also uncacheClip/uncacheAction exist for finer scope
}
```

`AnimationMixer` itself has no GPU resources to dispose (it's pure CPU-side track evaluation),
but leaving actions running on a mixer whose root has been removed from the scene is a classic
leak-via-reference: the mixer keeps evaluating and holding onto `model`, which keeps the whole
subtree (geometries, materials, textures) alive in memory even though nothing renders it.
Always pair `mixer.stopAllAction()` (or per-action `.stop()`) with dropping your own reference
to the mixer, and dispose the model's geometries/materials/textures separately per invariant 6
— the mixer doesn't do that for you.

## See also

- `references/loaders-and-assets.md` — GLTFLoader wiring, where `gltf.animations` comes from
- `references/core-scenegraph.md` — `Object3D` transform trio that clips ultimately write to
- `references/performance.md` — cost of many simultaneous `AnimationMixer`s (e.g. crowds)
- `references/react-three-fiber.md` — `useAnimations` (drei) wraps mixer setup/cleanup in r3f
