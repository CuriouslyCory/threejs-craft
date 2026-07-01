import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { CHUNK_SIZE } from "~/game/coords";
import { World } from "~/game/world";
import {
  LocalWorldSource,
  createLocalWorldStore,
} from "~/game/store/local-world-store";
import { generateWorld } from "~/game/worldgen";

describe("LocalWorldSource", () => {
  it("exposes chunkEntries with world-space chunk origins", () => {
    const world = new World();
    world.setBlock(0, 0, 0, BlockType.Stone);
    world.setBlock(20, 0, 20, BlockType.Stone);

    const source = new LocalWorldSource(world);
    const entries = source.chunkEntries();

    expect(entries).toHaveLength(2);
    const origins = entries.map((e) => e.origin);
    expect(origins).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0, z: 0 },
        { x: CHUNK_SIZE, y: 0, z: CHUNK_SIZE },
      ]),
    );
  });
});

describe("createLocalWorldStore", () => {
  it("wraps a generated world with a LocalWorldSource by default", () => {
    const generated = generateWorld({ seed: "store-test" });
    const store = createLocalWorldStore(generated);

    expect(store.generated).toBe(generated);
    expect(store.source).toBeInstanceOf(LocalWorldSource);
    expect(store.source.chunkEntries().length).toBeGreaterThan(0);
  });

  it("accepts an injected source constructor (forward-compat with #8/#10)", () => {
    let constructedWith: unknown;
    class SpySource extends LocalWorldSource {
      constructor(world: World) {
        super(world);
        constructedWith = world;
      }
    }

    const generated = generateWorld({ seed: "store-test-2" });
    const store = createLocalWorldStore(generated, SpySource);

    expect(store.source).toBeInstanceOf(SpySource);
    expect(constructedWith).toBe(generated.world);
  });
});
