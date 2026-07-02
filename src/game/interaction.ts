/**
 * Pure interaction module: turns a raycast hit + camera pose + inventory
 * state into a `Command` ready for `WorldStore.apply`. Extracted out of the
 * (previously untested) `BlockTargeting` component (`block-target.tsx`) so
 * this derivation logic is plain-Vitest-testable — no three.js, no React, no
 * DOM. `BlockTargeting` maps its `THREE.Intersection` into the plain
 * `RaycastHit` shape below and calls back into this module; everything else
 * (raycasting itself, event wiring, the wireframe outline) stays in the
 * component.
 *
 * This module also owns the single eye<->feet conversion (`EYE_HEIGHT`,
 * imported from `player-box.ts` — see that module for the other half of the
 * convention, `player-controller.tsx`'s feet->eye camera placement).
 */

import { DEFAULT_REACH, type Command, type Vec3 } from "~/game/command";
import type { Inventory } from "~/game/inventory";
import { EYE_HEIGHT } from "~/game/player/player-box";

/** Plain-data camera pose. Only the eye position is needed today: this
 *  module does no direction math — the raycast that produced `hit` already
 *  encoded look direction. Orientation is intentionally omitted (add a
 *  field here if a future rule needs the look angle). */
export interface CameraPose {
  readonly eye: Vec3;
}

/** Plain-data raycast hit — the component maps `THREE.Intersection` to this
 *  at the render/domain boundary. */
export interface RaycastHit {
  /** World-space integer block coord of the hit cell (`InstanceCoord.world`). */
  readonly cell: Vec3;
  /** Face normal of the hit face, in the same space as `cell` (world space).
   *  Object-space equals world-space here because the chunk transform chain
   *  is translation-only (documented at length in `block-target.tsx`'s file
   *  header) — a pure translation never rotates a direction vector. This
   *  module does not re-verify that assumption; if chunk meshes ever gain
   *  rotation/scale, the caller must transform the normal before passing it
   *  in. Optional: a hit may carry no usable face normal. */
  readonly faceNormal?: Vec3;
  /** Ray length from camera to hit, world units — the reach-gate input. */
  readonly distance: number;
}

export type InteractionAction = "break" | "place";

/** The two cells a hit resolves to, reach-gated. Both `null` when the hit is
 *  out of reach (or absent); `place` is additionally `null` when the hit
 *  carried no face normal. Used by the per-frame outline and internally by
 *  `deriveInteraction`. */
export interface TargetCells {
  readonly target: Vec3 | null;
  readonly place: Vec3 | null;
}

/** A ready-to-apply command plus the exact extra args `WorldStore.apply`
 *  needs. */
export interface InteractionCommand {
  readonly command: Command;
  readonly from: Vec3;
  readonly reach: number;
  readonly playerPosition: Vec3;
}

/**
 * Reach gate + face-normal -> place-cell snap. `Math.round` on the (already
 * world-space, per `RaycastHit`'s doc) face normal snaps it to the nearest
 * axis, guarding only against float noise on an otherwise-exact ±1/0/0
 * component.
 */
export function resolveTargetCells(
  hit: RaycastHit | null,
  reach: number = DEFAULT_REACH,
): TargetCells {
  if (!hit || hit.distance > reach) {
    return { target: null, place: null };
  }
  const target = hit.cell;
  const n = hit.faceNormal;
  const place = n
    ? {
        x: target.x + Math.round(n.x),
        y: target.y + Math.round(n.y),
        z: target.z + Math.round(n.z),
      }
    : null;
  return { target, place };
}

/**
 * Eye<->feet conversion + target/place validity + empty-slot inventory gate
 * + `Command`/`from`/`reach`/`playerPosition` assembly. Returns `null` when
 * there's nothing valid to do (out of reach, no face for a place, empty
 * slot).
 */
export function deriveInteraction(
  pose: CameraPose,
  hit: RaycastHit | null,
  inventory: Inventory,
  action: InteractionAction,
  reach: number = DEFAULT_REACH,
): InteractionCommand | null {
  const { target, place } = resolveTargetCells(hit, reach);
  const eye = pose.eye;

  if (action === "break") {
    if (!target) return null;
    // from = eye; playerPosition = eye (never read by BreakBlock, matches
    // the defaulted 2-arg call today); reach = DEFAULT_REACH (matches
    // default).
    return {
      command: { type: "BreakBlock", at: target },
      from: eye,
      reach,
      playerPosition: eye,
    };
  }

  // action === "place"
  if (!place) return null;
  const slot = inventory.slots[inventory.selected];
  if (!slot?.block) return null; // empty-slot gate
  // eye -> feet: inverse of player-controller's feet -> eye (single
  // EYE_HEIGHT home in player-box.ts).
  const playerPosition: Vec3 = { x: eye.x, y: eye.y - EYE_HEIGHT, z: eye.z };
  return {
    command: { type: "PlaceBlock", at: place, block: slot.block },
    from: eye,
    reach,
    playerPosition,
  };
}
