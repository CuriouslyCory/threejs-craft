import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { World } from "~/game/world";

describe("World", () => {
  it("returns Air for any read before a chunk is loaded", () => {
    const world = new World();
    expect(world.getBlock(0, 0, 0)).toBe(BlockType.Air);
    expect(world.getBlock(100, -50, 32)).toBe(BlockType.Air);
    expect(world.chunkCount).toBe(0);
  });

  it("set then get round-trips a world-space block", () => {
    const world = new World();
    world.setBlock(5, 4, 9, BlockType.Grass);
    expect(world.getBlock(5, 4, 9)).toBe(BlockType.Grass);
  });

  it("creates the containing chunk on demand when setting a block", () => {
    const world = new World();
    expect(world.chunkCount).toBe(0);
    world.setBlock(20, 0, 20, BlockType.Stone);
    expect(world.chunkCount).toBe(1);
    expect(world.getChunk(1, 0, 1)).toBeDefined();
  });

  it("round-trips negative world-space coordinates across chunk boundaries", () => {
    const world = new World();
    world.setBlock(-1, -1, -1, BlockType.Wood);
    expect(world.getBlock(-1, -1, -1)).toBe(BlockType.Wood);
    // Neighboring chunk (still unloaded) reads as Air.
    expect(world.getBlock(-17, -1, -1)).toBe(BlockType.Air);
  });

  it("returns Air for any out-of-range/unloaded chunk read, never throws", () => {
    const world = new World();
    world.setBlock(0, 0, 0, BlockType.Stone);
    expect(() => world.getBlock(1_000_000, -1_000_000, 500)).not.toThrow();
    expect(world.getBlock(1_000_000, -1_000_000, 500)).toBe(BlockType.Air);
  });

  it("chunkEntries lists every loaded chunk with its coordinate", () => {
    const world = new World();
    expect(world.chunkEntries()).toEqual([]);

    world.setBlock(0, 0, 0, BlockType.Stone);
    world.setBlock(20, 0, 20, BlockType.Stone);
    world.setBlock(-1, -1, -1, BlockType.Wood);

    const entries = world.chunkEntries();
    expect(entries).toHaveLength(3);

    const coords = entries.map(({ cx, cy, cz }) => ({ cx, cy, cz }));
    expect(coords).toEqual(
      expect.arrayContaining([
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 1 },
        { cx: -1, cy: -1, cz: -1 },
      ]),
    );

    for (const entry of entries) {
      expect(world.getChunk(entry.cx, entry.cy, entry.cz)).toBe(entry.chunk);
    }
  });
});
