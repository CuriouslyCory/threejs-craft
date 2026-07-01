# WebXR — VR/AR

Renderer-agnostic API shape (WebXR device/session handling is browser API, not renderer-path
specific), but the render loop requirement (invariant 4) is stricter here than anywhere else in
three.js: WebXR **requires** `setAnimationLoop`, no exceptions. If XR setup renders a black
headset view despite working fine on a flat monitor, check that first.

## Enabling XR on the renderer

```js
renderer.xr.enabled = true;
```

Set this once, before the first frame. It tells the renderer to source frame timing and camera
pose from the XR session (once one starts) instead of the normal render path, and to
double-render for stereo (one pass per eye) when a session is active.

## VRButton / ARButton

`three/addons/webxr/*` provides ready-made UI buttons that request an XR session on click and
wire it into the renderer:

```js
import { VRButton } from 'three/addons/webxr/VRButton.js';
// or: import { ARButton } from 'three/addons/webxr/ARButton.js';

renderer.xr.enabled = true;
document.body.appendChild(VRButton.createButton(renderer));
```

`VRButton.createButton(renderer)` / `ARButton.createButton(renderer, options)` return a DOM
button element already wired to call `navigator.xr.requestSession(...)` and
`renderer.xr.setSession(...)` for you, and to gray out / relabel itself based on device support
(`navigator.xr` unavailable, session already active, etc.). `ARButton` takes an options object
for AR-specific session features (e.g. `requiredFeatures: ['hit-test']` — see AR hit-test
below); check the exact options shape with `scripts/docs_lookup.mjs ARButton` since AR feature
flags are a WebXR spec surface that's grown over time.

## `setAnimationLoop` is mandatory, not optional, in XR

This is invariant 4 at its strictest. A normal (non-XR) three.js scene can technically get away
with a hand-rolled `requestAnimationFrame` loop and still mostly work; **XR cannot**. Once an XR
session is active, frame timing and head/controller pose data come from the headset's own
frame callback (`XRSession.requestAnimationFrame`), which the renderer only hooks into via
`renderer.setAnimationLoop(callback)` — the callback additionally receives an `XRFrame` as its
second argument while in session:

```js
renderer.setAnimationLoop((timestamp, frame) => {
  // frame is an XRFrame while an XR session is active, undefined otherwise
  renderer.render(scene, camera);
});
```

A `requestAnimationFrame`-driven loop simply never fires inside the headset's own render cadence
— symptom is a session that "starts" (button works, headset shows *something*) but the scene
never updates or is stuck on the first frame. If XR seems to start but nothing renders inside
the headset, this is the first thing to check, ahead of scene-content causes — see
`references/debugging-and-gotchas.md` for the general black-screen checklist first if the issue
also reproduces outside XR.

## Controllers

```js
const controller1 = renderer.xr.getController(0);
const controller2 = renderer.xr.getController(1);
scene.add(controller1, controller2);

controller1.addEventListener('selectstart', onSelectStart);
controller1.addEventListener('selectend', onSelectEnd);
```

- **`renderer.xr.getController(index)`** — returns an `Object3D` whose transform tracks that
  controller's pose each frame once a session is active; add it to the scene like any other
  object and parent things to it (a ray-cast line, a held tool mesh) to have them follow the
  controller. Index is by controller slot (typically 0/1 for left/right, but slot assignment is
  spec-defined, not "left is always 0" — verify per target device if handedness matters).
- **`selectstart`/`selectend`** — the primary trigger/button press and release (the main
  "interact" gesture across VR controller types). Also commonly used: `squeezestart`/
  `squeezeend` (grip button). Use these for gameplay actions rather than polling controller
  button state per frame.
- **`renderer.xr.getControllerGrip(index)`** — a second `Object3D` tracking the controller's
  grip pose (as opposed to the pointing-ray pose from `getController`), which is what
  `XRControllerModelFactory` (below) attaches its visual model to — the grip and pointer poses
  differ slightly by design (you point with one convention, hold a virtual object with another).

## Controller models

```js
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const controllerModelFactory = new XRControllerModelFactory();
const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
scene.add(grip1);
```

Loads a device-appropriate 3D controller model at runtime (fetched based on the connected
device's profile) and attaches it to the grip object so the user sees a representation of their
physical controller in VR. Attach to the **grip** object, not `getController`'s pointer-ray
object, or the model will be positioned/oriented for pointing rather than holding.

## Hand tracking (high level)

```js
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const handModelFactory = new XRHandModelFactory();
const hand1 = renderer.xr.getHand(0);
hand1.add(handModelFactory.createHandModel(hand1, 'mesh')); // 'boxes' | 'spheres' | 'mesh'
scene.add(hand1);
```

`renderer.xr.getHand(index)` mirrors `getController`, but for devices/sessions with hand
tracking instead of (or in addition to) physical controllers — the session must actually
request the `hand-tracking` optional/required feature for this to populate. Hand tracking has
more device/browser variance than controller support; treat this as a documented pattern and
verify the exact feature-request wiring and `XRHandModelFactory` model-type options with
`scripts/docs_lookup.mjs XRHandModelFactory` before shipping a hand-tracking-dependent
experience.

## Reference spaces & teleport locomotion (pointer)

WebXR tracks the user relative to a **reference space** (`local`, `local-floor`, `bounded-floor`,
`unbounded`, requested as part of session creation) — this determines where the world origin
sits relative to the physical floor/play area. Locomotion beyond room-scale (teleporting,
smooth movement) isn't a built-in three.js feature — it's conventionally implemented by moving
a parent "rig" `Group` that both the camera and controllers are attached under (since you can't
move the XR camera directly — its pose is driven by the headset), combined with a raycast from
the controller to find a teleport target on the floor. This is app-level logic layered on top
of the primitives above, not a single API call — treat it as a pattern to build, and look at the
three.js WebXR examples (`webxr_vr_teleport` and similar in the three.js repo) for a concrete
reference implementation rather than guessing the rig-group approach's exact details.

## AR hit-test (high level)

For AR (`ARButton`/passthrough sessions), placing virtual content onto real-world surfaces uses
the WebXR **hit-test API**: request the `hit-test` feature at session creation, obtain a hit-test
source via `XRSession.requestHitTestSource(...)`, and each frame call
`frame.getHitTestResults(hitTestSource)` to get real-world surface poses under a reticle/ray.
This is largely raw WebXR spec API surfacing through the `XRFrame` object passed to your
`setAnimationLoop` callback (see above), not a three.js-specific wrapper — three.js's `ARButton`
gets you into a hit-test-capable session, but reading results is spec-level `XRFrame` API. Verify
the exact call shape against current WebXR spec docs / three.js's `webxr_ar_hittest` example
before implementing; this is one of the more version/spec-sensitive corners of this file.

## r3f: `@react-three/xr`

In a React Three Fiber app, don't hand-wire `renderer.xr`/`VRButton` imperatively — use
`@react-three/xr` (pmndrs), which wraps session management, controllers, and hand tracking as
JSX components/hooks matching r3f's declarative style (e.g. an `<XR>` wrapper around scene
content, hooks for controller/hand state, a store-based session-entry API). The exact component/
hook names have shifted across `@react-three/xr` major versions more than core r3f has — verify
current API shape with `scripts/docs_lookup.mjs XR` and the package's own docs rather than
assuming the vanilla names above (`VRButton`, `getController`) apply 1:1 in JSX form. Full r3f
setup (Canvas, `useFrame`, Next.js client-boundary requirements that also apply to XR sessions
since they're equally browser/`window`-dependent): `references/react-three-fiber.md`.

## See also

- `references/renderers-and-setup.md` ★ — `setAnimationLoop` fundamentals, invariant 4
- `references/interaction.md` — raycasting fundamentals reused for teleport/hit-test targeting
- `references/react-three-fiber.md` ★ — Next.js client-boundary requirements that also gate XR
- `references/debugging-and-gotchas.md` ★ — general black-screen checklist before assuming an
  XR-specific cause
