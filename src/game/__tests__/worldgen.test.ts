import { describe, expect, it, vi } from "vitest";

import { BlockType } from "~/game/blocks";
import type { World } from "~/game/world";
import { generateWorld } from "~/game/worldgen";

/** Serialize every voxel in the generated map footprint for deep comparison. */
function snapshotWorld(world: World, size: number): number[] {
  const snapshot: number[] = [];
  // A few blocks above any possible tree canopy is plenty of headroom.
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        snapshot.push(world.getBlock(x, y, z));
      }
    }
  }
  return snapshot;
}

describe("generateWorld", () => {
  it("is byte-identical on repeat for the same seed", () => {
    const a = generateWorld({ seed: "acorn" });
    const b = generateWorld({ seed: "acorn" });

    expect(snapshotWorld(a.world, a.size)).toEqual(
      snapshotWorld(b.world, b.size),
    );
    expect(a.trees).toEqual(b.trees);
  });

  it("produces the expected flat layer stack: stone y0-2, dirt y3, grass y4", () => {
    const { world } = generateWorld({ seed: "layer-check" });

    // Sample a handful of columns, not just the origin.
    const columns = [
      { x: 0, z: 0 },
      { x: 10, z: 23 },
      { x: 47, z: 47 },
      { x: 24, z: 24 },
    ];
    for (const { x, z } of columns) {
      expect(world.getBlock(x, 0, z)).toBe(BlockType.Stone);
      expect(world.getBlock(x, 1, z)).toBe(BlockType.Stone);
      expect(world.getBlock(x, 2, z)).toBe(BlockType.Stone);
      expect(world.getBlock(x, 3, z)).toBe(BlockType.Dirt);
      expect(world.getBlock(x, 4, z)).toBe(BlockType.Grass);
      // Nothing generated above the grass except tree material.
      expect(world.getBlock(x, 5, z)).not.toBe(BlockType.Stone);
    }
  });

  it("places 6-10 trees, off-spawn and min-spaced, each with wood + leaves", () => {
    const { world, trees, spawn } = generateWorld({ seed: "tree-check" });

    expect(trees.length).toBeGreaterThanOrEqual(6);
    expect(trees.length).toBeLessThanOrEqual(10);

    for (const tree of trees) {
      // Off spawn.
      const dx = tree.x - spawn.x;
      const dz = tree.z - spawn.z;
      expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(3);

      // Trunk exists above the grass line.
      expect(world.getBlock(tree.x, 5, tree.z)).toBe(BlockType.Wood);
      expect(world.getBlock(tree.x, 6, tree.z)).toBe(BlockType.Wood);
      expect(world.getBlock(tree.x, 7, tree.z)).toBe(BlockType.Wood);
      expect(world.getBlock(tree.x, 8, tree.z)).toBe(BlockType.Wood);

      // Leaf canopy present directly above the trunk.
      expect(world.getBlock(tree.x + 1, 8, tree.z)).toBe(BlockType.Leaves);
      expect(world.getBlock(tree.x, 9, tree.z)).toBe(BlockType.Leaves);
    }

    // Min-spacing: no two tree centers closer than the configured minimum.
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const a = trees[i]!;
        const b = trees[j]!;
        const dist = Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
        expect(dist).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("produces a different tree layout for a different seed", () => {
    const a = generateWorld({ seed: "seed-a" });
    const b = generateWorld({ seed: "seed-b" });

    expect(a.trees).not.toEqual(b.trees);
  });

  it("is pure: takes no ambient state and never touches Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    generateWorld({ seed: "purity-check" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
