import type { BlockTypeId } from "~/game/blocks";

/** The minimal read surface a validator / collision sweep needs from a World. */
export interface VoxelReader {
  getBlock(x: number, y: number, z: number): BlockTypeId;
}
