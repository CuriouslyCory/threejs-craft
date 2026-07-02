/**
 * A single 16x16x16 voxel chunk backed by a flat `Uint8Array`.
 *
 * All reads are centralized through `get`, which is the only place that
 * needs to reason about `noUncheckedIndexedAccess`'s `| undefined` — any
 * missing/out-of-range read coalesces to `Air`.
 */

import { BlockType, type BlockTypeId } from "~/game/blocks";
import { CHUNK_SIZE } from "~/game/coords";

export { CHUNK_SIZE };

/** Total voxel count in a chunk (16^3). Exported for the delta codec/tests. */
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/** Flat index for a local (0..15) voxel coordinate within a chunk. */
function localIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

function inBounds(coord: number): boolean {
  return coord >= 0 && coord < CHUNK_SIZE;
}

export class Chunk {
  private readonly blocks: Uint8Array;

  constructor() {
    this.blocks = new Uint8Array(CHUNK_VOLUME);
  }

  /**
   * Read a local voxel. Out-of-local-range coordinates and any gap left by
   * `noUncheckedIndexedAccess` both coalesce to `Air`.
   */
  get(x: number, y: number, z: number): BlockTypeId {
    if (!inBounds(x) || !inBounds(y) || !inBounds(z)) {
      return BlockType.Air;
    }
    const value = this.blocks[localIndex(x, y, z)];
    return (value ?? BlockType.Air) as BlockTypeId;
  }

  /**
   * Write a local voxel. Silently ignores out-of-local-range coordinates
   * rather than throwing.
   */
  set(x: number, y: number, z: number, id: BlockTypeId): void {
    if (!inBounds(x) || !inBounds(y) || !inBounds(z)) {
      return;
    }
    this.blocks[localIndex(x, y, z)] = id;
  }

  /**
   * Snapshot the current chunk state as a defensive copy.
   * Returns a Uint8Array of exactly CHUNK_VOLUME bytes.
   */
  snapshot(): Uint8Array {
    return this.blocks.slice();
  }

  /**
   * Load chunk state from a byte array.
   * Validates length === CHUNK_VOLUME; throws a `RangeError` on mismatch.
   */
  load(bytes: Uint8Array): void {
    if (bytes.length !== CHUNK_VOLUME) {
      throw new RangeError(
        `Invalid chunk load: expected ${CHUNK_VOLUME} bytes, got ${bytes.length}`,
      );
    }
    this.blocks.set(bytes);
  }
}
