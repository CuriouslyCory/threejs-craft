import { describe, expect, it } from "vitest";

import { BlockRegistry, BlockType, isSolid } from "~/game/blocks";

describe("blocks", () => {
  it("registers the expected numeric ids", () => {
    expect(BlockType).toEqual({
      Air: 0,
      Grass: 1,
      Dirt: 2,
      Stone: 3,
      Wood: 4,
      Leaves: 5,
    });
  });

  it("gives every block type a 1:1 self-drop", () => {
    for (const id of Object.values(BlockType)) {
      expect(BlockRegistry[id].drop).toBe(id);
    }
  });

  it("marks Air as not solid and terrain/tree blocks as solid", () => {
    expect(isSolid(BlockType.Air)).toBe(false);
    expect(isSolid(BlockType.Grass)).toBe(true);
    expect(isSolid(BlockType.Dirt)).toBe(true);
    expect(isSolid(BlockType.Stone)).toBe(true);
    expect(isSolid(BlockType.Wood)).toBe(true);
    expect(isSolid(BlockType.Leaves)).toBe(true);
  });

  it("assigns sensible texture modes", () => {
    expect(BlockRegistry[BlockType.Grass].textureMode).toBe("topSideBottom");
    expect(BlockRegistry[BlockType.Wood].textureMode).toBe("topSide");
    expect(BlockRegistry[BlockType.Stone].textureMode).toBe("uniform");
  });

  it("populates dormant hardness/breakTime for every block", () => {
    for (const id of Object.values(BlockType)) {
      const def = BlockRegistry[id];
      expect(def.hardness).toBeGreaterThanOrEqual(0);
      expect(def.breakTime).toBeGreaterThanOrEqual(0);
    }
  });
});
