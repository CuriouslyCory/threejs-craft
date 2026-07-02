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
import { addDrop, consumeSelected, type Inventory } from "~/game/inventory";
import { boxesOverlap, type Box3, type Vec3 } from "~/game/player/aabb";
import {
  boxFromFeetPosition,
  PLAYER_DEPTH,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "~/game/player/player-box";
import type { VoxelReader } from "~/game/voxel";
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

/**
 * Pure validation for `BreakBlock`: out of `reach` from `from`, or the
 * target is already `Air`. Returns `null` when the break would be allowed.
 */
export function canBreak(
  world: VoxelReader,
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

/** The world-space unit-cube box a block placed at `at` would occupy. */
function cellBox(at: Vec3): Box3 {
  return {
    min: { x: at.x, y: at.y, z: at.z },
    max: { x: at.x + 1, y: at.y + 1, z: at.z + 1 },
  };
}

/** Extra context `canPlace` needs beyond reach: which block is being
 *  placed, the inventory it must come from, and the player's own collision
 *  box (so a placement can't clip the player standing next to it). */
export interface PlaceContext {
  readonly block: BlockType;
  readonly inventory: Inventory;
  readonly playerBox: Box3;
}

/**
 * Pure validation for `PlaceBlock`: out of `reach`, target cell already
 * solid, the selected hotbar slot doesn't actually hold `block`, or the
 * placement would clip the player's own AABB (`#7`'s 0.6x1.8x0.6 box —
 * reused via `boxesOverlap`/`boxFromFeetPosition` rather than
 * reimplemented). The issue treats player-clip as "no-op, no crash" rather
 * than a distinct rejection reason, so it reuses `Occupied` — the closest
 * of the four frozen `CommandResult` reasons ("this cell can't be placed
 * into right now").
 */
export function canPlace(
  world: VoxelReader,
  at: Vec3,
  from: Vec3,
  reach: number,
  context: PlaceContext,
): RejectReason | null {
  if (distance(at, from) > reach) {
    return "OutOfRange";
  }
  if (isSolid(world.getBlock(at.x, at.y, at.z))) {
    return "Occupied";
  }
  const slot = context.inventory.slots[context.inventory.selected];
  if (slot?.block !== context.block || (slot?.count ?? 0) <= 0) {
    return "NotInInventory";
  }
  if (boxesOverlap(cellBox(at), context.playerBox)) {
    return "Occupied";
  }
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
 * `inventory.addDrop`/`consumeSelected` — no logic is duplicated here
 * beyond wiring those together and computing the dirty `changed` chunk key.
 *
 * `playerPosition` (feet position, distinct from `from`'s reach-origin/eye
 * position) is only read by the `PlaceBlock` branch, to build the player's
 * collision box for `canPlace`'s clip check; it defaults to `from` so
 * `BreakBlock`-only callers (and #8's existing tests) don't need to pass
 * it.
 */
export function applyCommand(
  world: World,
  inventory: Inventory,
  command: Command,
  from: Vec3,
  reach: number = DEFAULT_REACH,
  playerPosition: Vec3 = from,
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
      const playerBox = boxFromFeetPosition(
        playerPosition,
        PLAYER_WIDTH,
        PLAYER_HEIGHT,
        PLAYER_DEPTH,
      );
      const reason = canPlace(world, command.at, from, reach, {
        block: command.block,
        inventory,
        playerBox,
      });
      if (reason) {
        return { result: { ok: false, reason }, inventory };
      }

      world.setBlock(command.at.x, command.at.y, command.at.z, command.block);
      const { inventory: nextInventory } = consumeSelected(inventory);

      return {
        result: { ok: true, changed: [chunkKeyForVec3(command.at)] },
        inventory: nextInventory,
      };
    }
  }
}
