import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { Chunk, CHUNK_SIZE } from "~/game/chunk";
import {
  computeChunkInstances,
  totalInstanceCount,
} from "~/game/render/chunk-instances";

describe("computeChunkInstances", () => {
  it("returns no groups for an empty (all-Air) chunk", () => {
    const chunk = new Chunk();
    const groups = computeChunkInstances(chunk, { x: 0, y: 0, z: 0 });
    expect(groups).toEqual([]);
  });

  it("groups solid voxels by block type, skipping Air", () => {
    const chunk = new Chunk();
    chunk.set(0, 0, 0, BlockType.Stone);
    chunk.set(1, 0, 0, BlockType.Stone);
    chunk.set(0, 1, 0, BlockType.Grass);
    // Air left everywhere else — must not appear as a group.

    const groups = computeChunkInstances(chunk, { x: 0, y: 0, z: 0 });
    const byType = new Map(groups.map((g) => [g.blockType, g.instances.length]));

    expect(byType.get(BlockType.Stone)).toBe(2);
    expect(byType.get(BlockType.Grass)).toBe(1);
    expect(byType.has(BlockType.Air)).toBe(false);
  });

  it("assigns dense, zero-based instance ids within each group", () => {
    const chunk = new Chunk();
    chunk.set(0, 0, 0, BlockType.Dirt);
    chunk.set(1, 0, 0, BlockType.Dirt);
    chunk.set(2, 0, 0, BlockType.Dirt);

    const groups = computeChunkInstances(chunk, { x: 0, y: 0, z: 0 });
    const dirt = groups.find((g) => g.blockType === BlockType.Dirt);
    expect(dirt).toBeDefined();
    expect(dirt?.instances.map((i) => i.index)).toEqual([0, 1, 2]);
  });

  it("maps each instance's local and world coordinates from the chunk origin", () => {
    const chunk = new Chunk();
    chunk.set(5, 6, 7, BlockType.Wood);

    const groups = computeChunkInstances(chunk, { x: 32, y: 0, z: 16 });
    const wood = groups.find((g) => g.blockType === BlockType.Wood);
    expect(wood?.instances).toEqual([
      {
        index: 0,
        local: { x: 5, y: 6, z: 7 },
        world: { x: 37, y: 6, z: 23 },
      },
    ]);
  });

  it("counts every solid voxel across the full chunk volume, none missed or duplicated", () => {
    const chunk = new Chunk();
    let expectedCount = 0;
    for (let y = 0; y < CHUNK_SIZE; y += 3) {
      for (let z = 0; z < CHUNK_SIZE; z += 3) {
        for (let x = 0; x < CHUNK_SIZE; x += 3) {
          chunk.set(x, y, z, BlockType.Stone);
          expectedCount++;
        }
      }
    }

    const groups = computeChunkInstances(chunk, { x: 0, y: 0, z: 0 });
    expect(totalInstanceCount(groups)).toBe(expectedCount);
  });

  it("totalInstanceCount sums instances across multiple groups", () => {
    const chunk = new Chunk();
    chunk.set(0, 0, 0, BlockType.Stone);
    chunk.set(1, 0, 0, BlockType.Stone);
    chunk.set(0, 1, 0, BlockType.Grass);
    chunk.set(0, 2, 0, BlockType.Wood);

    const groups = computeChunkInstances(chunk, { x: 0, y: 0, z: 0 });
    expect(totalInstanceCount(groups)).toBe(4);
  });
});
