import { describe, expect, it } from "vitest";

import type { ChunkInstance, Coord3 } from "~/game/render/chunk-instances";
import {
  CAT_GRASS_RATE,
  isCatGrass,
  splitCatGrassInstances,
} from "~/game/render/cat-grass";

describe("isCatGrass", () => {
  it("is deterministic: the same world coordinate always returns the same answer", () => {
    const coord: Coord3 = { x: 137, y: 4, z: -52 };
    const first = isCatGrass(coord);
    for (let i = 0; i < 10; i++) {
      expect(isCatGrass({ ...coord })).toBe(first);
    }
  });

  it("varies across different coordinates (not a constant true/false)", () => {
    const results = new Set<boolean>();
    for (let x = 0; x < 200; x++) {
      results.add(isCatGrass({ x, y: 0, z: 0 }));
    }
    expect(results.size).toBe(2);
  });

  it("selects at a rate close to the documented ~1/40 over a large sample", () => {
    const sampleSize = 200_000;
    let hits = 0;
    for (let i = 0; i < sampleSize; i++) {
      // Spread across x/y/z so the sample isn't just one hashed axis.
      const coord: Coord3 = {
        x: i % 4000,
        y: Math.floor(i / 4000),
        z: (i * 7) % 997,
      };
      if (isCatGrass(coord)) hits++;
    }
    const rate = hits / sampleSize;

    // Wide, non-flaky band around the documented 1/40 (0.025) rate — this
    // is a statistical check on a hash, not an exact-count assertion.
    expect(rate).toBeGreaterThan(1 / 60);
    expect(rate).toBeLessThan(1 / 25);
    // Sanity: the constant itself is what the doc comment/plan promises.
    expect(CAT_GRASS_RATE).toBeCloseTo(1 / 40);
  });

  it("is a pure function of world coordinate only (independent of call order/session)", () => {
    // Calling in a different order/interleaving must not change any answer.
    const coords: Coord3[] = [
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
      { x: 3, y: 3, z: 3 },
    ];
    const firstPass = coords.map(isCatGrass);
    const secondPass = [...coords].reverse().map(isCatGrass).reverse();
    expect(secondPass).toEqual(firstPass);
  });
});

function makeInstances(coords: readonly Coord3[]): ChunkInstance[] {
  return coords.map((world, index) => ({
    index,
    local: world,
    world,
  }));
}

describe("splitCatGrassInstances", () => {
  it("partitions every instance into exactly one of normal/catGrass, none lost or duplicated", () => {
    const coords: Coord3[] = Array.from({ length: 500 }, (_, i) => ({
      x: i,
      y: 0,
      z: i * 3,
    }));
    const instances = makeInstances(coords);

    const { normal, catGrass } = splitCatGrassInstances(instances);

    expect(normal.length + catGrass.length).toBe(instances.length);

    const allWorlds = new Set(
      [...normal, ...catGrass].map((i) => `${i.world.x},${i.world.y},${i.world.z}`),
    );
    expect(allWorlds.size).toBe(instances.length);
  });

  it("agrees with isCatGrass on which bucket each instance lands in", () => {
    const coords: Coord3[] = Array.from({ length: 300 }, (_, i) => ({
      x: i * 5,
      y: 1,
      z: -i,
    }));
    const instances = makeInstances(coords);
    const { normal, catGrass } = splitCatGrassInstances(instances);

    for (const instance of normal) {
      expect(isCatGrass(instance.world)).toBe(false);
    }
    for (const instance of catGrass) {
      expect(isCatGrass(instance.world)).toBe(true);
    }
  });

  it("reindexes each bucket densely from 0, independent of the source group's indices", () => {
    const coords: Coord3[] = Array.from({ length: 400 }, (_, i) => ({
      x: i,
      y: 2,
      z: i * 11,
    }));
    const instances = makeInstances(coords);
    const { normal, catGrass } = splitCatGrassInstances(instances);

    expect(normal.map((i) => i.index)).toEqual(
      Array.from({ length: normal.length }, (_, i) => i),
    );
    expect(catGrass.map((i) => i.index)).toEqual(
      Array.from({ length: catGrass.length }, (_, i) => i),
    );
  });

  it("preserves each instance's local/world coordinate across the split", () => {
    const coords: Coord3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 5, z: 200 },
      { x: -3, y: 1, z: 9 },
    ];
    const instances = makeInstances(coords);
    const { normal, catGrass } = splitCatGrassInstances(instances);
    const byWorldKey = new Map(
      [...normal, ...catGrass].map((i) => [
        `${i.world.x},${i.world.y},${i.world.z}`,
        i,
      ]),
    );

    for (const original of instances) {
      const key = `${original.world.x},${original.world.y},${original.world.z}`;
      const found = byWorldKey.get(key);
      expect(found).toBeDefined();
      expect(found?.local).toEqual(original.local);
      expect(found?.world).toEqual(original.world);
    }
  });

  it("returns empty buckets for an empty input", () => {
    const { normal, catGrass } = splitCatGrassInstances([]);
    expect(normal).toEqual([]);
    expect(catGrass).toEqual([]);
  });
});
