/**
 * Pure, mode-aware player movement/collision step.
 *
 * `stepPlayer(state, input, world, dt)` owns gravity, jump, ground detection,
 * fly-mode vertical movement, and the AABB collision sweep against the
 * voxel world. No three.js, no React, no DOM, no `Date.now`/`Math.random` —
 * everything needed comes from the arguments, so this is unit-testable in
 * plain Node (see `src/game/__tests__/player/step-player.test.ts`).
 *
 * The r3f player controller (under `src/game/render/`) is the only place
 * that touches wall-clock time (`performance.now()`, for double-tap
 * detection) and the DOM (pointer lock, keyboard). It calls `stepPlayer`
 * once per frame with a clamped `dt` and writes the result into refs/camera
 * — this module never runs inside a React re-render.
 */

import {
  sweepAxis,
  translateBox,
  type Box3,
  type Vec3,
} from "~/game/player/aabb";
import {
  boxFromFeetPosition,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_DEPTH,
} from "~/game/player/player-box";
import type { VoxelReader } from "~/game/voxel";

export type { Vec3 } from "~/game/player/aabb";
export type { VoxelReader } from "~/game/voxel";

export type PlayerMode = "walk" | "fly";

export interface PlayerState {
  /** Feet-center position (not eye position — add `EYE_HEIGHT` for that). */
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly mode: PlayerMode;
  /** True when the player's downward sweep rested on a solid voxel. */
  readonly onGround: boolean;
}

export interface PlayerInput {
  readonly moveForward: boolean;
  readonly moveBackward: boolean;
  readonly moveLeft: boolean;
  readonly moveRight: boolean;
  readonly sprint: boolean;
  /** Walk mode: jump (only takes effect when grounded). Fly mode: ignored. */
  readonly jump: boolean;
  /** Fly mode: ascend. Walk mode: ignored. */
  readonly up: boolean;
  /** Fly mode: descend. Walk mode: ignored. */
  readonly down: boolean;
  /** True on exactly the frame a walk/fly toggle (double-tap Space) fires. */
  readonly toggleMode: boolean;
  /** Unbounded radians, rotation about world Y (yaw). */
  readonly yaw: number;
  /** Radians, expected pre-clamped to ±89° by the caller. Not used for
   *  movement direction (WASD stays on the horizontal plane in both modes)
   *  but carried alongside yaw for callers that need the full look angle. */
  readonly pitch: number;
}

/** Eye height above the feet position — used to place the camera. */
export const EYE_HEIGHT = 1.6;

export const WALK_SPEED = 4.5; // blocks/sec
export const SPRINT_MULTIPLIER = 1.6;
export const FLY_SPEED = 8; // blocks/sec, both horizontal and vertical

export const GRAVITY = -24; // blocks/sec^2
export const MAX_FALL_SPEED = -50; // terminal velocity clamp
export const JUMP_SPEED = 7; // blocks/sec, initial upward velocity

/** Create a fresh grounded walk-mode state at the given feet position. */
export function createPlayerState(position: Vec3): PlayerState {
  return {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    mode: "walk",
    onGround: false,
  };
}

function normalizeHorizontal(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  if (length === 0) {
    return { x: 0, z: 0 };
  }
  return { x: x / length, z: z / length };
}

/** Horizontal (xz-plane) move direction from WASD + yaw, normalized. */
function moveDirection(input: PlayerInput): { x: number; z: number } {
  const forward = (input.moveForward ? 1 : 0) - (input.moveBackward ? 1 : 0);
  const strafe = (input.moveRight ? 1 : 0) - (input.moveLeft ? 1 : 0);
  if (forward === 0 && strafe === 0) {
    return { x: 0, z: 0 };
  }

  // yaw=0 looks down -Z (three.js default camera forward), matching the
  // camera/controller convention documented in the threejs skill's
  // cameras-and-controls reference.
  const forwardX = -Math.sin(input.yaw);
  const forwardZ = -Math.cos(input.yaw);
  const rightX = Math.cos(input.yaw);
  const rightZ = -Math.sin(input.yaw);

  return normalizeHorizontal(
    forward * forwardX + strafe * rightX,
    forward * forwardZ + strafe * rightZ,
  );
}

function resolveMode(state: PlayerState, input: PlayerInput): PlayerMode {
  if (!input.toggleMode) {
    return state.mode;
  }
  return state.mode === "walk" ? "fly" : "walk";
}

function boxForState(state: PlayerState): Box3 {
  return boxFromFeetPosition(
    state.position,
    PLAYER_WIDTH,
    PLAYER_HEIGHT,
    PLAYER_DEPTH,
  );
}

/**
 * Advance the player one fixed step. Pure: same inputs always produce the
 * same output state, and this never mutates `state`/`input` in place.
 */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  world: VoxelReader,
  dt: number,
): PlayerState {
  const mode = resolveMode(state, input);

  const dir = moveDirection(input);
  const speed =
    (mode === "fly" ? FLY_SPEED : WALK_SPEED) *
    (input.sprint ? SPRINT_MULTIPLIER : 1);

  let velocityX = dir.x * speed;
  let velocityZ = dir.z * speed;
  let velocityY: number;

  if (mode === "fly") {
    const vertical = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    velocityY = vertical * FLY_SPEED;
  } else {
    velocityY = state.velocity.y + GRAVITY * dt;
    velocityY = Math.max(velocityY, MAX_FALL_SPEED);
    if (input.jump && state.onGround) {
      velocityY = JUMP_SPEED;
    }
  }

  let box = boxForState(state);

  const dx = velocityX * dt;
  const sweptX = sweepAxis(world, box, "x", dx);
  box = translateBox(box, "x", sweptX.delta);
  if (sweptX.collided) {
    velocityX = 0;
  }

  const dz = velocityZ * dt;
  const sweptZ = sweepAxis(world, box, "z", dz);
  box = translateBox(box, "z", sweptZ.delta);
  if (sweptZ.collided) {
    velocityZ = 0;
  }

  const dy = velocityY * dt;
  const sweptY = sweepAxis(world, box, "y", dy);
  box = translateBox(box, "y", sweptY.delta);
  const onGround = sweptY.collided && velocityY <= 0;
  if (sweptY.collided) {
    velocityY = 0;
  }

  const position: Vec3 = {
    x: box.min.x + PLAYER_WIDTH / 2,
    y: box.min.y,
    z: box.min.z + PLAYER_DEPTH / 2,
  };

  return {
    position,
    velocity: { x: velocityX, y: velocityY, z: velocityZ },
    mode,
    onGround,
  };
}
