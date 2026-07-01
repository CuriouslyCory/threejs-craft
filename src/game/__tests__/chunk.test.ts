import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { Chunk } from "~/game/chunk";

describe("Chunk", () => {
  it("defaults every voxel to Air", () => {
    const chunk = new Chunk();
    expect(chunk.get(0, 0, 0)).toBe(BlockType.Air);
    expect(chunk.get(15, 15, 15)).toBe(BlockType.Air);
  });

  it("set then get round-trips a block id", () => {
    const chunk = new Chunk();
    chunk.set(1, 2, 3, BlockType.Stone);
    expect(chunk.get(1, 2, 3)).toBe(BlockType.Stone);
    // Neighboring voxels remain untouched.
    expect(chunk.get(1, 2, 4)).toBe(BlockType.Air);
  });

  it("does not alias voxels across the x/y/z axes (index math is distinct)", () => {
    const chunk = new Chunk();
    chunk.set(2, 0, 0, BlockType.Grass);
    chunk.set(0, 0, 2, BlockType.Dirt);
    chunk.set(0, 2, 0, BlockType.Wood);
    expect(chunk.get(2, 0, 0)).toBe(BlockType.Grass);
    expect(chunk.get(0, 0, 2)).toBe(BlockType.Dirt);
    expect(chunk.get(0, 2, 0)).toBe(BlockType.Wood);
  });

  it("returns Air for out-of-local-range reads instead of throwing", () => {
    const chunk = new Chunk();
    expect(() => chunk.get(-1, 0, 0)).not.toThrow();
    expect(chunk.get(-1, 0, 0)).toBe(BlockType.Air);
    expect(chunk.get(16, 0, 0)).toBe(BlockType.Air);
    expect(chunk.get(0, -1, 0)).toBe(BlockType.Air);
    expect(chunk.get(0, 16, 0)).toBe(BlockType.Air);
    expect(chunk.get(0, 0, -1)).toBe(BlockType.Air);
    expect(chunk.get(0, 0, 16)).toBe(BlockType.Air);
  });

  it("ignores out-of-local-range writes instead of throwing", () => {
    const chunk = new Chunk();
    expect(() => chunk.set(16, 0, 0, BlockType.Stone)).not.toThrow();
    expect(() => chunk.set(-1, 0, 0, BlockType.Stone)).not.toThrow();
    // Nothing was actually written to any in-bounds voxel by accident.
    expect(chunk.get(0, 0, 0)).toBe(BlockType.Air);
  });
});
