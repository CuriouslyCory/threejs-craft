/**
 * Pure voxel AABB collision helpers.
 *
 * No three.js, no React, no DOM — every value here is a plain object/number
 * so `step-player.ts` (and this module) can be unit tested in plain Node.
 * Collision is resolved **per axis** (see `sweepAxis`), which is what makes
 * wall-sliding possible: a diagonal move against a wall still lets the
 * parallel axis proceed even though the perpendicular axis is blocked.
 */

import { isSolid } from "~/game/blocks";
import type { VoxelReader } from "~/game/voxel";

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Box3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Number of bisection steps used by `sweepAxis` — 20 gives sub-mm precision. */
const BISECTION_ITERATIONS = 20;

/**
 * How far a resolved collision backs off from the exact block face. Without
 * this, the box would rest exactly flush with the face, and floating-point
 * error could flip it in or out of the solid voxel on the following frame.
 */
const CONTACT_EPSILON = 1e-4;

/** Nudge used when scanning which integer voxel layer a box face falls in. */
const VOXEL_SCAN_EPSILON = 1e-6;

/** Translate a box along a single axis by `delta`. */
export function translateBox(box: Box3, axis: "x" | "y" | "z", delta: number): Box3 {
  return {
    min: { ...box.min, [axis]: box.min[axis] + delta },
    max: { ...box.max, [axis]: box.max[axis] + delta },
  };
}

/** True if any solid voxel overlaps the given box. */
export function boxIntersectsSolid(world: VoxelReader, box: Box3): boolean {
  const minX = Math.floor(box.min.x + VOXEL_SCAN_EPSILON);
  const maxX = Math.ceil(box.max.x - VOXEL_SCAN_EPSILON) - 1;
  const minY = Math.floor(box.min.y + VOXEL_SCAN_EPSILON);
  const maxY = Math.ceil(box.max.y - VOXEL_SCAN_EPSILON) - 1;
  const minZ = Math.floor(box.min.z + VOXEL_SCAN_EPSILON);
  const maxZ = Math.ceil(box.max.z - VOXEL_SCAN_EPSILON) - 1;

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (isSolid(world.getBlock(x, y, z))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * True if two axis-aligned boxes overlap in volume. Strict inequalities on
 * every axis, so two boxes merely touching along a shared face (e.g. a
 * candidate placement cell flush against the player's collision box, not
 * inside it) are **not** considered overlapping — consistent with
 * `boxIntersectsSolid`'s "actually occupies space" semantics. Used by #9's
 * `canPlace` (`command.ts`) to reject a placement that would clip the
 * player, reusing this AABB module rather than reimplementing box-box
 * overlap in the domain layer.
 */
export function boxesOverlap(a: Box3, b: Box3): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

export interface SweepResult {
  /** The (possibly clamped) delta actually safe to apply along this axis. */
  readonly delta: number;
  /** Whether the requested delta was reduced because of a solid voxel. */
  readonly collided: boolean;
}

/**
 * Sweep `box` along one axis by `delta`, clamping to the nearest solid voxel
 * face if the full move would intersect one. Resolve axes independently
 * (x, then z, then y is the convention used by `stepPlayer`) so movement
 * along a wall keeps working even when the perpendicular axis is blocked.
 */
export function sweepAxis(
  world: VoxelReader,
  box: Box3,
  axis: "x" | "y" | "z",
  delta: number,
): SweepResult {
  if (delta === 0) {
    return { delta: 0, collided: false };
  }

  const target = translateBox(box, axis, delta);
  if (!boxIntersectsSolid(world, target)) {
    return { delta, collided: false };
  }

  // Binary-search the largest fraction of `delta` (in [0, 1]) that keeps the
  // box clear of solid voxels.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const candidate = translateBox(box, axis, delta * mid);
    if (boxIntersectsSolid(world, candidate)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const direction = Math.sign(delta);
  const safeDelta = delta * lo - direction * CONTACT_EPSILON;
  // Guard tiny deltas: don't let the epsilon backoff push us past zero/flip
  // direction (that would mean "moving away" instead of "stopping short").
  const clamped = Math.sign(safeDelta) === direction ? safeDelta : 0;

  return { delta: clamped, collided: true };
}
