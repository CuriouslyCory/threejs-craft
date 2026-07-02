import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { Chunk } from "~/game/chunk";
import { isCatGrass } from "~/game/render/cat-grass";
import { buildRenderPlan } from "~/game/render/render-plan";

describe("buildRenderPlan", () => {
  it("produces no groups for an empty (all-Air) chunk", () => {
    expect(buildRenderPlan(new Chunk(), { x: 0, y: 0, z: 0 }).groups).toEqual([]);
  });

  it("emits one group per non-Grass block type, keyed by block type, with a coord map", () => {
    const chunk = new Chunk();
    chunk.set(0, 0, 0, BlockType.Stone);
    chunk.set(1, 0, 0, BlockType.Stone);
    chunk.set(0, 1, 0, BlockType.Wood);

    const { groups } = buildRenderPlan(chunk, { x: 32, y: 0, z: 16 });
    const stone = groups.find((g) => g.blockType === BlockType.Stone && !g.key.endsWith("-cat"));
    expect(stone).toBeDefined();
    expect(stone!.key).toBe(String(BlockType.Stone));
    expect(stone!.geometry.key).toBe(String(BlockType.Stone));
    // instances and coord map agree, dense 0-based, world = origin + local.
    expect(stone!.instances.map((i) => i.index)).toEqual([0, 1]);
    expect(stone!.instanceToCoord.size).toBe(2);
    expect(stone!.instanceToCoord.get(0)).toEqual({ local: { x: 0, y: 0, z: 0 }, world: { x: 32, y: 0, z: 16 } });
    expect(stone!.instanceToCoord.get(1)!.world).toEqual({ x: 33, y: 0, z: 16 });
  });

  it("coord map keys exactly match each group's instance indices (picking contract)", () => {
    const chunk = new Chunk();
    for (let x = 0; x < 6; x++) chunk.set(x, 0, 0, BlockType.Dirt);
    for (const g of buildRenderPlan(chunk, { x: 0, y: 0, z: 0 }).groups) {
      expect([...g.instanceToCoord.keys()].sort((a, b) => a - b)).toEqual(g.instances.map((i) => i.index));
      for (const i of g.instances) expect(g.instanceToCoord.get(i.index)!.world).toEqual(i.world);
    }
  });

  it("splits Grass into a plain group and a `-cat` group, matching isCatGrass deterministically", () => {
    // Fill a plane with Grass so both buckets are non-empty across 256 coords.
    const chunk = new Chunk();
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.set(x, 0, z, BlockType.Grass);

    const { groups } = buildRenderPlan(chunk, { x: 0, y: 0, z: 0 });
    const plain = groups.find((g) => g.blockType === BlockType.Grass && g.key === String(BlockType.Grass));
    const cat = groups.find((g) => g.key === `${BlockType.Grass}-cat`);
    expect(plain).toBeDefined();
    expect(cat).toBeDefined();

    // Every plain instance is !isCatGrass; every cat instance is isCatGrass.
    for (const i of plain!.instances) expect(isCatGrass(i.world)).toBe(false);
    for (const i of cat!.instances) expect(isCatGrass(i.world)).toBe(true);
    // Split is exhaustive and non-overlapping.
    expect(plain!.instances.length + cat!.instances.length).toBe(256);
    // Cat group uses a distinct geometry identity from plain Grass.
    expect(cat!.geometry.key).not.toBe(plain!.geometry.key);
  });

  it("is deterministic: same chunk+origin yields the same group keys, counts, and cat split", () => {
    const build = () => {
      const c = new Chunk();
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.set(x, 0, z, BlockType.Grass);
      return buildRenderPlan(c, { x: 100, y: 5, z: -40 }).groups.map((g) => [g.key, g.instances.length]);
    };
    expect(build()).toEqual(build());
  });

  it("drops zero-instance buckets (no empty group when Grass is all one bucket)", () => {
    // A single Grass block lands in exactly one bucket -> exactly one Grass group.
    const chunk = new Chunk();
    chunk.set(0, 0, 0, BlockType.Grass);
    const grassGroups = buildRenderPlan(chunk, { x: 0, y: 0, z: 0 }).groups.filter((g) => g.blockType === BlockType.Grass);
    expect(grassGroups.length).toBe(1);
  });
});
