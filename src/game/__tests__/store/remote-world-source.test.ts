import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { CHUNK_SIZE } from "~/game/coords";
import {
  createLocalWorldStore,
  LocalWorldSource,
} from "~/game/store/local-world-store";
import { RemoteWorldSource } from "~/game/store/remote-world-source";
import { World } from "~/game/world";

describe("RemoteWorldSource", () => {
  it("satisfies the same WorldSource surface as LocalWorldSource", () => {
    const world = new World();
    world.setBlock(0, 0, 0, BlockType.Stone);
    world.setBlock(20, 0, 20, BlockType.Stone);

    const local = new LocalWorldSource(world);
    const remote = new RemoteWorldSource(world);

    expect(remote.chunkEntries()).toEqual(local.chunkEntries());
  });

  it("demonstrates the composition-root factory swap compiles and runs identically", () => {
    const world = new World();
    world.setBlock(0, 0, 0, BlockType.Stone);

    // Same call shape `game-scene.tsx`'s WORLD_SOURCE_CTOR uses — swapping
    // the constructor is the entire "seam" #10 establishes.
    const localStore = createLocalWorldStore(
      { world, trees: [], size: CHUNK_SIZE, spawn: { x: 0, z: 0 } },
      LocalWorldSource,
    );
    const remoteStore = createLocalWorldStore(
      { world, trees: [], size: CHUNK_SIZE, spawn: { x: 0, z: 0 } },
      RemoteWorldSource,
    );

    expect(remoteStore.source).toBeInstanceOf(RemoteWorldSource);
    expect(remoteStore.source.chunkEntries()).toEqual(
      localStore.source.chunkEntries(),
    );
  });
});
