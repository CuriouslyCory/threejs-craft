/**
 * Block type registry — the single source of truth for every voxel type in
 * the game. Pure data + a couple of pure lookup helpers; no rendering or
 * physics concerns live here.
 */

/** How a block's faces should be textured by the render layer. */
export type TextureMode = "uniform" | "topSide" | "topSideBottom";

export interface BlockDefinition {
  readonly id: number;
  readonly name: string;
  readonly solid: boolean;
  /** Item dropped when this block is broken. 1:1 self-drop for MVP. */
  readonly drop: BlockTypeId;
  readonly textureMode: TextureMode;
  /** Relative mining difficulty. Dormant in MVP — no breaking system yet. */
  readonly hardness: number;
  /** Seconds to break with a bare hand. Dormant in MVP. */
  readonly breakTime: number;
}

/** Canonical block type ids. */
export const BlockType = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Wood: 4,
  Leaves: 5,
} as const;

export type BlockTypeId = (typeof BlockType)[keyof typeof BlockType];

/**
 * Alias for the `Command`/`CommandResult` contract frozen in
 * `src/game/command.ts` (#8, feeding #9/#10): the issue's `BlockType` names
 * exactly this block-id type. Declared here — not in `command.ts` — so it
 * merges with the `BlockType` *value* export above (TS keeps type and value
 * identifiers in separate namespaces, so a `const BlockType` and a `type
 * BlockType` with the same name coexist safely) instead of colliding with
 * it on import. Anywhere that already does `import { BlockType } from
 * "~/game/blocks"` now gets both the runtime id constants and this type for
 * free.
 */
export type BlockType = BlockTypeId;

/**
 * Per-type block properties, keyed by numeric id. Populated for every id in
 * `BlockType` — `blocks.ts` is the only module allowed to know these values.
 */
export const BlockRegistry: Record<BlockTypeId, BlockDefinition> = {
  [BlockType.Air]: {
    id: BlockType.Air,
    name: "Air",
    solid: false,
    drop: BlockType.Air,
    textureMode: "uniform",
    hardness: 0,
    breakTime: 0,
  },
  [BlockType.Grass]: {
    id: BlockType.Grass,
    name: "Grass",
    solid: true,
    drop: BlockType.Grass,
    textureMode: "topSideBottom",
    hardness: 0.6,
    breakTime: 0.3,
  },
  [BlockType.Dirt]: {
    id: BlockType.Dirt,
    name: "Dirt",
    solid: true,
    drop: BlockType.Dirt,
    textureMode: "uniform",
    hardness: 0.5,
    breakTime: 0.25,
  },
  [BlockType.Stone]: {
    id: BlockType.Stone,
    name: "Stone",
    solid: true,
    drop: BlockType.Stone,
    textureMode: "uniform",
    hardness: 1.5,
    breakTime: 0.75,
  },
  [BlockType.Wood]: {
    id: BlockType.Wood,
    name: "Wood",
    solid: true,
    drop: BlockType.Wood,
    textureMode: "topSide",
    hardness: 2,
    breakTime: 1,
  },
  [BlockType.Leaves]: {
    id: BlockType.Leaves,
    name: "Leaves",
    solid: true,
    drop: BlockType.Leaves,
    textureMode: "uniform",
    hardness: 0.2,
    breakTime: 0.1,
  },
};

/** Whether a block id occupies space (blocks movement, is not air). */
export function isSolid(id: BlockTypeId): boolean {
  return BlockRegistry[id].solid;
}
