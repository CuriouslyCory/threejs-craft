import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { CHUNK_VOLUME } from "~/game/chunk";
import { chunkKey } from "~/game/coords";
import { isEmptyChunkDelta } from "~/game/persistence/chunk-delta";
import {
  applyStoredDeltas,
  baseChunkBytes,
  computeChunkDelta,
  hydrateWorld,
  type ChunkDeltaRecord,
} from "~/game/persistence/world-delta";
import { generateWorld } from "~/game/worldgen";

const SEED = "world-delta-fixture-seed";

describe("world-delta bridge", () => {
  it("baseChunkBytes returns a zero-filled array for a key worldgen never touched (never throws)", () => {
    // Chunk coordinate far outside the generated 48x48 footprint: worldgen
    // never creates this chunk (chunks are lazy), so this must come back as
    // a zero-filled (all-air) CHUNK_VOLUME array, not throw.
    const farKey = chunkKey(999, 999, 999);
    const bytes = baseChunkBytes(SEED, farKey);

    expect(bytes.length).toBe(CHUNK_VOLUME);
    expect(bytes.every((b) => b === BlockType.Air)).toBe(true);
  });

  it("unedited chunk -> empty delta, and hydrating with it reproduces the base", () => {
    const { world } = generateWorld({ seed: SEED });
    // Spawn-adjacent chunk: worldgen definitely puts content here.
    const key = chunkKey(1, 0, 1);
    const chunk = world.getChunk(1, 0, 1);
    expect(chunk).toBeDefined();

    const current = chunk!.snapshot(); // unedited
    const delta = computeChunkDelta(SEED, key, current);
    expect(isEmptyChunkDelta(delta)).toBe(true);

    const hydrated = hydrateWorld(SEED, [{ chunkKey: key, data: delta }]);
    expect(hydrated.getChunk(1, 0, 1)!.snapshot()).toEqual(current);
  });

  it("applying stored deltas onto a regenerated world reconstructs a hand-edited world exactly", () => {
    const { world } = generateWorld({ seed: SEED });

    // Hand-edit a couple of distinct chunks.
    world.setBlock(5, 10, 5, BlockType.Stone); // chunk (0,0,0)
    world.setBlock(20, 10, 20, BlockType.Wood); // chunk (1,0,1)
    world.setBlock(-3, 2, -3, BlockType.Dirt); // chunk (-1,0,-1), never generated

    const editedKeys = [
      chunkKey(0, 0, 0),
      chunkKey(1, 0, 1),
      chunkKey(-1, 0, -1),
    ];

    const deltas: ChunkDeltaRecord[] = editedKeys.map((key) => {
      const [cxRaw, cyRaw, czRaw] = key.split(",");
      const cx = Number(cxRaw);
      const cy = Number(cyRaw);
      const cz = Number(czRaw);
      const chunk = world.getChunk(cx, cy, cz);
      expect(chunk).toBeDefined();
      const current = chunk!.snapshot();
      const data = computeChunkDelta(SEED, key, current);
      return { chunkKey: key, data };
    });

    // Single-voxel edits should be compact, not full-chunk blobs.
    for (const d of deltas) {
      expect(d.data.length).toBeLessThan(CHUNK_VOLUME);
    }

    const hydrated = hydrateWorld(SEED, deltas);

    // Edited voxels match exactly.
    expect(hydrated.getBlock(5, 10, 5)).toBe(BlockType.Stone);
    expect(hydrated.getBlock(20, 10, 20)).toBe(BlockType.Wood);
    expect(hydrated.getBlock(-3, 2, -3)).toBe(BlockType.Dirt);

    // Untouched voxels in the same edited chunks are unaffected.
    expect(hydrated.getBlock(5, 4, 5)).toBe(BlockType.Grass); // grass layer, chunk (0,0,0)

    // A chunk with no delta at all still matches worldgen's base exactly.
    const untouchedKey = chunkKey(2, 0, 2);
    expect(hydrated.getChunk(2, 0, 2)!.snapshot()).toEqual(
      baseChunkBytes(SEED, untouchedKey),
    );
  });

  it("applying deltas in any order onto a fresh world yields the same result (order-independence)", () => {
    const { world: sourceWorld } = generateWorld({ seed: SEED });
    sourceWorld.setBlock(1, 10, 1, BlockType.Stone); // chunk (0,0,0)
    sourceWorld.setBlock(17, 10, 17, BlockType.Wood); // chunk (1,0,1)
    sourceWorld.setBlock(33, 10, 33, BlockType.Dirt); // chunk (2,0,2)

    const keys = [chunkKey(0, 0, 0), chunkKey(1, 0, 1), chunkKey(2, 0, 2)];
    const deltas: ChunkDeltaRecord[] = keys.map((key) => {
      const [cxRaw, cyRaw, czRaw] = key.split(",");
      const chunk = sourceWorld.getChunk(
        Number(cxRaw),
        Number(cyRaw),
        Number(czRaw),
      )!;
      return {
        chunkKey: key,
        data: computeChunkDelta(SEED, key, chunk.snapshot()),
      };
    });

    const forward = hydrateWorld(SEED, deltas);
    const reversed = hydrateWorld(SEED, [...deltas].reverse());

    for (const key of keys) {
      const [cxRaw, cyRaw, czRaw] = key.split(",");
      const cx = Number(cxRaw);
      const cy = Number(cyRaw);
      const cz = Number(czRaw);
      expect(forward.getChunk(cx, cy, cz)!.snapshot()).toEqual(
        reversed.getChunk(cx, cy, cz)!.snapshot(),
      );
    }
  });

  it("applyStoredDeltas is idempotent: applying the same deltas twice is a no-op the second time", () => {
    const { world } = generateWorld({ seed: SEED });
    world.setBlock(9, 10, 9, BlockType.Stone);
    const key = chunkKey(0, 0, 0);
    const chunk = world.getChunk(0, 0, 0)!;
    const delta = computeChunkDelta(SEED, key, chunk.snapshot());
    const record: ChunkDeltaRecord = { chunkKey: key, data: delta };

    const target = hydrateWorld(SEED, []); // fresh, no edits yet
    applyStoredDeltas(target, SEED, [record]);
    const afterFirst = target.getChunk(0, 0, 0)!.snapshot();

    applyStoredDeltas(target, SEED, [record]);
    const afterSecond = target.getChunk(0, 0, 0)!.snapshot();

    expect(afterSecond).toEqual(afterFirst);
  });
});
