/**
 * Pure computation of "which local voxels in this chunk need an instanced
 * box, grouped by block type, with their local and world coordinates."
 *
 * No `three` import — `chunk-mesh.tsx` consumes this to actually build
 * `THREE.InstancedMesh`es (one per returned group) and calls
 * `setMatrixAt`/`setColorAt`; this module only produces the plain data, so
 * the "how many instances" / "instanceId -> block coord" logic the render
 * layer needs for #8's picking is unit-testable without a renderer or DOM.
 */

import { isSolid, type BlockTypeId } from "~/game/blocks";
import { CHUNK_SIZE, type Chunk } from "~/game/chunk";

export interface Coord3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChunkInstance {
  /** Instance id within this group — matches the `InstancedMesh` index it's written to. */
  readonly index: number;
  /** Voxel coordinate local to the chunk (0..15 on each axis). */
  readonly local: Coord3;
  /** Voxel coordinate in world space. */
  readonly world: Coord3;
}

export interface ChunkInstanceGroup {
  readonly blockType: BlockTypeId;
  readonly instances: readonly ChunkInstance[];
}

/**
 * Group every solid voxel in `chunk` by block type. three.js's
 * `InstancedMesh` shares one geometry + material across all its instances,
 * and different block types need different atlas UVs baked into that
 * geometry (see `box-uv.ts`), so each block type present in a chunk gets
 * its own group — and, in `chunk-mesh.tsx`, its own `InstancedMesh`.
 *
 * `chunkOrigin` is the world-space coordinate of this chunk's local
 * `(0,0,0)` voxel (i.e. `{ x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE, z: cz *
 * CHUNK_SIZE }`).
 */
export function computeChunkInstances(
  chunk: Chunk,
  chunkOrigin: Coord3,
): ChunkInstanceGroup[] {
  const groups = new Map<BlockTypeId, ChunkInstance[]>();

  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const blockType = chunk.get(x, y, z);
        if (!isSolid(blockType)) continue;

        const list = groups.get(blockType) ?? [];
        list.push({
          index: list.length,
          local: { x, y, z },
          world: {
            x: chunkOrigin.x + x,
            y: chunkOrigin.y + y,
            z: chunkOrigin.z + z,
          },
        });
        groups.set(blockType, list);
      }
    }
  }

  return Array.from(groups.entries(), ([blockType, instances]) => ({
    blockType,
    instances,
  }));
}

/** Total solid-voxel instance count across every group in a chunk. */
export function totalInstanceCount(
  groups: readonly ChunkInstanceGroup[],
): number {
  return groups.reduce((sum, group) => sum + group.instances.length, 0);
}
