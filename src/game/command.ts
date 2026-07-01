/**
 * The `Command`/`CommandResult` contract — #8's tracer bullet and the seam
 * #9 (PlaceBlock) and #10 (serialization) build on. **The shapes below are
 * frozen**: both `Command` variants are defined now even though `apply`
 * only fully implements `BreakBlock` in #8 (see the `PlaceBlock` case in
 * `applyCommand`).
 *
 * Pure domain core: no three.js, no React, no DOM. `World` (a plain class
 * over a `Uint8Array`-backed `Chunk` map) and `Inventory` (plain readonly
 * data) are the only "external" types touched, so every function here is
 * unit-testable in plain Node — see `src/game/__tests__/command.test.ts`.
 * `World.setBlock` mutates the passed-in `World` in place (that's `World`'s
 * own existing shape, used the same way by `worldgen.ts`); "pure" here means
 * free of ambient/global state and rendering concerns, not free of writing
 * through an explicitly-passed mutable domain object.
 */

import { BlockRegistry, BlockType, isSolid } from "~/game/blocks";
import { chunkKey, worldToChunkCoord, type ChunkKey } from "~/game/coords";
import { addDrop, type Inventory } from "~/game/inventory";
import type { Vec3 } from "~/game/player/aabb";
import type { World } from "~/game/world";

export type { Vec3 } from "~/game/player/aabb";
export type { ChunkKey } from "~/game/coords";
export type { BlockType } from "~/game/blocks";

/** Default reach gate for both breaking and placing: 5 blocks. */
export const DEFAULT_REACH = 5;

export type Command =
  | { type: "BreakBlock"; at: Vec3 }
  | { type: "PlaceBlock"; at: Vec3; block: BlockType };

export type CommandResult =
  | { ok: true; changed: readonly ChunkKey[]; drop?: BlockType }
  | {
      ok: false;
      reason: "OutOfRange" | "TargetIsAir" | "Occupied" | "NotInInventory";
    };

/** The literal union of `CommandResult`'s rejection reasons, standalone so
 *  validators can return "one of the four reasons, or null meaning ok". */
export type RejectReason = Extract<CommandResult, { ok: false }>["reason"];

/** Euclidean distance between two world-space points. */
function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** The minimal read surface a validator needs from a `World`. */
export interface WorldReader {
  getBlock(x: number, y: number, z: number): BlockType;
}

/**
 * Pure validation for `BreakBlock`: out of `reach` from `from`, or the
 * target is already `Air`. Returns `null` when the break would be allowed.
 */
export function canBreak(
  world: WorldReader,
  at: Vec3,
  from: Vec3,
  reach: number,
): RejectReason | null {
  if (distance(at, from) > reach) {
    return "OutOfRange";
  }
  const target = world.getBlock(at.x, at.y, at.z);
  if (target === BlockType.Air) {
    return "TargetIsAir";
  }
  return null;
}

/**
 * Pure validation for `PlaceBlock`. Minimal for #8 (only reach + "target
 * must not already be solid" are checked) — #9 completes this with the real
 * inventory-has-the-block ("NotInInventory") check once slot selection is
 * wired up. Exported now so #9 extends this function rather than
 * reinventing it.
 */
export function canPlace(
  world: WorldReader,
  at: Vec3,
  from: Vec3,
  reach: number,
): RejectReason | null {
  if (distance(at, from) > reach) {
    return "OutOfRange";
  }
  if (isSolid(world.getBlock(at.x, at.y, at.z))) {
    return "Occupied";
  }
  // TODO(#9): check the selected hotbar slot actually holds `block` and
  // return "NotInInventory" if not.
  return null;
}

/** Result of applying a command: the frozen `CommandResult` plus the
 *  (possibly unchanged) `Inventory` the caller should keep going forward. */
export interface ApplyResult {
  readonly result: CommandResult;
  readonly inventory: Inventory;
}

function chunkKeyForVec3(at: Vec3): ChunkKey {
  const { cx, cy, cz } = worldToChunkCoord(at.x, at.y, at.z);
  return chunkKey(cx, cy, cz);
}

/**
 * Apply a `Command` against `world`/`inventory`. Built entirely on
 * `canBreak`/`canPlace` above plus `World.getBlock`/`setBlock` and
 * `inventory.addDrop` — no logic is duplicated here beyond wiring those
 * together and computing the dirty `changed` chunk key.
 *
 * `PlaceBlock` is a **typed TODO for #9**: the case exists (so `Command`'s
 * type stays frozen and exhaustive) but never returns `ok: true` yet — #9
 * fills in the actual `setBlock` + inventory-decrement + `changed` once
 * hotbar selection is wired to a real "which block am I placing" source.
 */
export function applyCommand(
  world: World,
  inventory: Inventory,
  command: Command,
  from: Vec3,
  reach: number = DEFAULT_REACH,
): ApplyResult {
  switch (command.type) {
    case "BreakBlock": {
      const reason = canBreak(world, command.at, from, reach);
      if (reason) {
        return { result: { ok: false, reason }, inventory };
      }

      const existing = world.getBlock(
        command.at.x,
        command.at.y,
        command.at.z,
      );
      world.setBlock(command.at.x, command.at.y, command.at.z, BlockType.Air);

      const drop = BlockRegistry[existing].drop;
      const nextInventory = addDrop(inventory, drop);

      return {
        result: { ok: true, changed: [chunkKeyForVec3(command.at)], drop },
        inventory: nextInventory,
      };
    }
    case "PlaceBlock": {
      // TODO(#9): implement placement. `canPlace` above already covers reach
      // + occupied; #9 adds the inventory check and, on success, `setBlock`
      // + a matching inventory decrement + the dirty `changed` chunk key.
      const reason = canPlace(world, command.at, from, reach) ?? "Occupied";
      return { result: { ok: false, reason }, inventory };
    }
  }
}
