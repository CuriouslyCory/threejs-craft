"use client";

/**
 * r3f first-person controller for #7: raw browser Pointer Lock API (not
 * drei's `<PointerLockControls>` — see the note at the bottom of this file
 * for why), mouse-look + WASD keyboard state accumulated into refs, and a
 * `useFrame` loop that calls the pure `stepPlayer` and writes the result
 * straight onto the camera.
 *
 * HARD REQUIREMENT this file exists to satisfy: **zero React re-renders per
 * frame**. Every value that changes every frame (position, velocity, mode,
 * yaw/pitch, held keys, double-tap timing) lives in a `useRef`, mutated
 * directly inside event handlers or `useFrame`. The only React state in the
 * whole feature is `lockState` (start/playing/paused/denied), owned by the
 * parent (`game-scene.tsx`) and updated only from the `pointerlockchange`/
 * `pointerlockerror` events below — i.e. on user-facing transitions, never
 * once per frame.
 */

import { useFrame, useThree } from "@react-three/fiber";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { EYE_HEIGHT } from "~/game/player/player-box";
import {
  createPlayerState,
  stepPlayer,
  type PlayerInput,
  type PlayerState,
  type VoxelReader,
} from "~/game/player/step-player";

export type LockState = "start" | "playing" | "paused" | "denied";

export interface PlayerControllerHandle {
  /** Called from the overlay's onClick (a user gesture, required by the
   *  Pointer Lock API) to (re)request pointer lock on the canvas. */
  requestLock: () => void;
}

export interface PlayerControllerProps {
  readonly world: VoxelReader;
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
  readonly onLockStateChange: (state: LockState) => void;
}

/** Matches three-stdlib's `PointerLockControls` sensitivity constant — this
 *  is the validated "feels right" baseline, not an arbitrary guess. */
const MOUSE_SENSITIVITY = 2e-3;
/** ±89°, in radians — stops just short of the ±90° gimbal flip. */
const PITCH_LIMIT = (89 * Math.PI) / 180;
/** Clamp long frames (tab switch, GC pause) so a big `dt` can't tunnel the
 *  player through a thin wall in one swept step. */
const MAX_DT = 1 / 20;
const DOUBLE_TAP_MS = 300;

const KEY_BINDINGS = {
  forward: ["KeyW", "ArrowUp"],
  backward: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"],
  jump: ["Space"],
  down: ["ControlLeft", "ControlRight"],
} as const satisfies Record<string, readonly string[]>;

interface KeyState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  /** Space: jump in walk mode, ascend in fly mode. */
  jump: boolean;
  /** Ctrl: descend in fly mode. */
  down: boolean;
}

function createKeyState(): KeyState {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
    down: false,
  };
}

function matchesBinding(code: string, bindings: readonly string[]): boolean {
  return bindings.includes(code);
}

export const PlayerController = forwardRef<
  PlayerControllerHandle,
  PlayerControllerProps
>(function PlayerController({ world, spawn, onLockStateChange }, ref) {
  const { camera, gl } = useThree();

  // --- realtime state lives entirely in refs; none of it is React state ---
  const playerStateRef = useRef<PlayerState>(createPlayerState(spawn));
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const keysRef = useRef<KeyState>(createKeyState());
  const pendingToggleRef = useRef(false);
  const lastSpaceTapRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);

  // Render-count proof this component performs zero React re-renders as a
  // result of gameplay: this line only runs when the component *body* runs
  // (mount, or a parent-driven re-render on a lock-state transition). If
  // `useFrame` ever caused a re-render, this count would climb every frame
  // (~60/sec) instead of staying flat during continuous WASD/mouse input —
  // confirmed manually via the browser console during verification.
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  console.info("[PlayerController] component render #", renderCountRef.current);

  useImperativeHandle(
    ref,
    () => ({
      requestLock: () => {
        // requestPointerLock() returns a Promise in browsers implementing
        // the newer spec revision; a rejection here just means the lock was
        // denied, which we already handle via the `pointerlockerror` event.
        void gl.domElement.requestPointerLock();
      },
    }),
    [gl],
  );

  // Pointer lock lifecycle + mouse look. Browser Pointer Lock API used
  // directly (not drei's <PointerLockControls>): that component owns the
  // camera's full transform internally (its own Euler bookkeeping and
  // moveForward/moveRight helpers) with no seam for physics/collision to
  // veto a move, which is exactly what `stepPlayer`'s AABB sweep needs to do
  // every frame. Driving yaw/pitch into plain refs here and writing
  // camera.position/rotation ourselves after `stepPlayer` runs keeps a
  // single source of truth for the player's transform.
  useEffect(() => {
    const canvas = gl.domElement;

    const handleLockChange = () => {
      const locked = document.pointerLockElement === canvas;
      isPlayingRef.current = locked;
      onLockStateChange(locked ? "playing" : "paused");
    };
    const handleLockError = () => {
      isPlayingRef.current = false;
      onLockStateChange("denied");
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (!isPlayingRef.current) return;
      yawRef.current -= event.movementX * MOUSE_SENSITIVITY;
      const nextPitch = pitchRef.current - event.movementY * MOUSE_SENSITIVITY;
      pitchRef.current = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, nextPitch),
      );
    };

    document.addEventListener("pointerlockchange", handleLockChange);
    document.addEventListener("pointerlockerror", handleLockError);
    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("pointerlockchange", handleLockChange);
      document.removeEventListener("pointerlockerror", handleLockError);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [gl, onLockStateChange]);

  // Keyboard -> refs, including double-tap Space detection. `performance.now`
  // is fine here (this is the r3f/DOM component, not the pure step-player
  // module, which must stay free of wall-clock reads).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPlayingRef.current) return;
      const keys = keysRef.current;
      if (matchesBinding(event.code, KEY_BINDINGS.forward)) {
        keys.forward = true;
      } else if (matchesBinding(event.code, KEY_BINDINGS.backward)) {
        keys.backward = true;
      } else if (matchesBinding(event.code, KEY_BINDINGS.left)) {
        keys.left = true;
      } else if (matchesBinding(event.code, KEY_BINDINGS.right)) {
        keys.right = true;
      } else if (matchesBinding(event.code, KEY_BINDINGS.sprint)) {
        keys.sprint = true;
      } else if (matchesBinding(event.code, KEY_BINDINGS.down)) {
        keys.down = true;
      } else if (matchesBinding(event.code, KEY_BINDINGS.jump)) {
        if (!event.repeat) {
          const now = performance.now();
          const last = lastSpaceTapRef.current;
          if (last !== null && now - last < DOUBLE_TAP_MS) {
            pendingToggleRef.current = true;
            lastSpaceTapRef.current = null; // consume; a 3rd tap starts fresh
          } else {
            lastSpaceTapRef.current = now;
          }
        }
        keys.jump = true;
      } else {
        return;
      }
      event.preventDefault();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const keys = keysRef.current;
      if (matchesBinding(event.code, KEY_BINDINGS.forward)) keys.forward = false;
      else if (matchesBinding(event.code, KEY_BINDINGS.backward))
        keys.backward = false;
      else if (matchesBinding(event.code, KEY_BINDINGS.left)) keys.left = false;
      else if (matchesBinding(event.code, KEY_BINDINGS.right)) keys.right = false;
      else if (matchesBinding(event.code, KEY_BINDINGS.sprint))
        keys.sprint = false;
      else if (matchesBinding(event.code, KEY_BINDINGS.down)) keys.down = false;
      else if (matchesBinding(event.code, KEY_BINDINGS.jump)) keys.jump = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      // Release any held keys so a lock-drop mid-press can't leave the
      // player moving forever.
      keysRef.current = createKeyState();
    };
  }, []);

  useFrame((_state, rawDelta) => {
    if (!isPlayingRef.current) return;

    const dt = Math.min(rawDelta, MAX_DT);
    const keys = keysRef.current;
    const mode = playerStateRef.current.mode;

    const input: PlayerInput = {
      moveForward: keys.forward,
      moveBackward: keys.backward,
      moveLeft: keys.left,
      moveRight: keys.right,
      sprint: keys.sprint,
      jump: mode === "walk" ? keys.jump : false,
      up: mode === "fly" ? keys.jump : false,
      down: mode === "fly" ? keys.down : false,
      toggleMode: pendingToggleRef.current,
      yaw: yawRef.current,
      pitch: pitchRef.current,
    };
    pendingToggleRef.current = false;

    playerStateRef.current = stepPlayer(
      playerStateRef.current,
      input,
      world,
      dt,
    );

    const { position } = playerStateRef.current;
    camera.position.set(position.x, position.y + EYE_HEIGHT, position.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitchRef.current, yawRef.current, 0);
  });

  return null;
});
