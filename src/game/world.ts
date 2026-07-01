/**
 * A `World` is a sparse collection of `Chunk`s keyed by chunk coordinate.
 * Chunks are created lazily on first write; reads against unloaded or
 * out-of-range chunks return `Air` rather than throwing.
 */

import { BlockType, type BlockTypeId } from "~/game/blocks";
import { Chunk } from "~/game/chunk";
import { chunkKey, worldToChunkCoord, worldToLocalCoord } from "~/game/coords";

export class World {
  private readonly chunks = new Map<string, Chunk>();

  /** Number of currently-loaded (created) chunks. Mostly useful for tests. */
  get chunkCount(): number {
    return this.chunks.size;
  }

  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  /** Get or create the chunk at the given chunk coordinate. */
  ensureChunk(cx: number, cy: number, cz: number): Chunk {
    const key = chunkKey(cx, cy, cz);
    const existing = this.chunks.get(key);
    if (existing) {
      return existing;
    }
    const chunk = new Chunk();
    this.chunks.set(key, chunk);
    return chunk;
  }

  /** Read a world-space voxel. Unloaded chunks and OOB reads return Air. */
  getBlock(x: number, y: number, z: number): BlockTypeId {
    const { cx, cy, cz } = worldToChunkCoord(x, y, z);
    const chunk = this.getChunk(cx, cy, cz);
    if (!chunk) {
      return BlockType.Air;
    }
    const { lx, ly, lz } = worldToLocalCoord(x, y, z);
    return chunk.get(lx, ly, lz);
  }

  /** Write a world-space voxel, creating the containing chunk on demand. */
  setBlock(x: number, y: number, z: number, id: BlockTypeId): void {
    const { cx, cy, cz } = worldToChunkCoord(x, y, z);
    const chunk = this.ensureChunk(cx, cy, cz);
    const { lx, ly, lz } = worldToLocalCoord(x, y, z);
    chunk.set(lx, ly, lz, id);
  }
}
