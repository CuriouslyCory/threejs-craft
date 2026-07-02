import { describe, expect, it, vi } from "vitest";

import { BlockType } from "~/game/blocks";
import { CHUNK_SIZE, chunkKey, worldToChunkCoord } from "~/game/coords";
import { addDrop, createInventory } from "~/game/inventory";
import {
  createWorldStore,
  type WorldChunkEntry,
} from "~/game/store/world-store";
import { World } from "~/game/world";

const ORIGIN = { x: 0, y: 0, z: 0 };
const FAR_AWAY = { x: 1000, y: 0, z: 1000 };

/** Read a chunk's current version off the snapshot — a never-loaded chunk
 *  is simply absent from `getSnapshot()`, so it defaults to 0. */
function versionOf(entries: readonly WorldChunkEntry[], key: string): number {
  return entries.find((e) => e.key === key)?.version ?? 0;
}

describe("WorldStore.apply", () => {
  it("mutates the world, credits inventory, and bumps only the dirty chunk's version", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    world.setBlock(at.x, at.y, at.z, BlockType.Stone);
    const store = createWorldStore(world);

    const otherChunk = chunkKey(5, 0, 0);
    const { cx, cy, cz } = worldToChunkCoord(at.x, at.y, at.z);
    const dirtyChunk = chunkKey(cx, cy, cz);

    expect(versionOf(store.getSnapshot(), dirtyChunk)).toBe(0);
    expect(versionOf(store.getSnapshot(), otherChunk)).toBe(0);

    const result = store.apply({ type: "BreakBlock", at }, ORIGIN);

    expect(result).toEqual({ ok: true, changed: [dirtyChunk], drop: BlockType.Stone });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Air);
    expect(store.getInventorySnapshot().slots[0]).toEqual({
      block: BlockType.Stone,
      count: 1,
    });

    // Only the dirty chunk's version moved — an unrelated chunk stays at 0.
    expect(versionOf(store.getSnapshot(), dirtyChunk)).toBe(1);
    expect(versionOf(store.getSnapshot(), otherChunk)).toBe(0);
  });

  it("notifies subscribers on a successful apply but not on a rejected one", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const store = createWorldStore(world);
    const listener = vi.fn();
    store.subscribe(listener);

    // Air target -> rejected, no notification.
    const rejected = store.apply({ type: "BreakBlock", at }, ORIGIN);
    expect(rejected.ok).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    world.setBlock(at.x, at.y, at.z, BlockType.Dirt);
    const accepted = store.apply({ type: "BreakBlock", at }, ORIGIN);
    expect(accepted.ok).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further notifications", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    world.setBlock(at.x, at.y, at.z, BlockType.Dirt);
    const store = createWorldStore(world);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.apply({ type: "BreakBlock", at }, ORIGIN);

    expect(listener).not.toHaveBeenCalled();
  });

  it("places a block, decrements the selected slot, and bumps only the dirty chunk's version", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const inventory = addDrop(createInventory(), BlockType.Stone);
    const store = createWorldStore(world, inventory);

    const otherChunk = chunkKey(5, 0, 0);
    const { cx, cy, cz } = worldToChunkCoord(at.x, at.y, at.z);
    const dirtyChunk = chunkKey(cx, cy, cz);

    const result = store.apply(
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
      undefined,
      FAR_AWAY,
    );

    expect(result).toEqual({ ok: true, changed: [dirtyChunk] });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Stone);
    expect(store.getInventorySnapshot().slots[0]).toEqual({
      block: null,
      count: 0,
    });
    // Only the dirty chunk's version moved — an unrelated chunk stays at 0,
    // confirming placement rebuilds are scoped to the one changed chunk.
    expect(versionOf(store.getSnapshot(), dirtyChunk)).toBe(1);
    expect(versionOf(store.getSnapshot(), otherChunk)).toBe(0);
  });

  it("rejects PlaceBlock without a usable slot and makes no changes", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const store = createWorldStore(world); // empty inventory

    const result = store.apply(
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
      undefined,
      FAR_AWAY,
    );

    expect(result).toEqual({ ok: false, reason: "NotInInventory" });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Air);
  });
});

describe("WorldStore.selectSlot / cycleSelection", () => {
  it("selectSlot updates the snapshot and notifies subscribers", () => {
    const store = createWorldStore(new World());
    const listener = vi.fn();
    store.subscribe(listener);

    store.selectSlot(3);

    expect(store.getInventorySnapshot().selected).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("selectSlot to the already-selected slot is a no-op (no notification)", () => {
    const store = createWorldStore(new World());
    const listener = vi.fn();
    store.subscribe(listener);

    store.selectSlot(0); // already selected

    expect(listener).not.toHaveBeenCalled();
  });

  it("cycleSelection wraps from the last slot back to the first", () => {
    const store = createWorldStore(new World());
    store.selectSlot(5);

    store.cycleSelection(1); // wheel "down" convention in this codebase: positive advances

    expect(store.getInventorySnapshot().selected).toBe(0);
  });

  it("cycleSelection wraps from the first slot to the last going the other way", () => {
    const store = createWorldStore(new World());

    store.cycleSelection(-1);

    expect(store.getInventorySnapshot().selected).toBe(5);
  });
});

describe("WorldStore.getSnapshot — chunk enumeration", () => {
  it("exposes loaded chunks with world-space origins and their key", () => {
    const world = new World();
    world.setBlock(0, 0, 0, BlockType.Stone);
    world.setBlock(20, 0, 20, BlockType.Stone);

    const store = createWorldStore(world);
    const entries = store.getSnapshot();

    expect(entries).toHaveLength(2);
    const originsByKey = new Map(entries.map((e) => [e.key, e.origin]));
    expect(originsByKey.get(chunkKey(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
    expect(originsByKey.get(chunkKey(1, 0, 1))).toEqual({
      x: CHUNK_SIZE,
      y: 0,
      z: CHUNK_SIZE,
    });
  });
});

describe("WorldStore.getSnapshot — new-chunk render path", () => {
  it("a chunk first created by a PlaceBlock edit appears in the versioned snapshot", () => {
    const world = new World(); // empty: zero loaded chunks
    const inventory = addDrop(createInventory(), BlockType.Stone);
    const store = createWorldStore(world, inventory);

    const at = { x: 1, y: 0, z: 0 }; // chunk (0,0,0) — absent in an empty world
    const key = chunkKey(0, 0, 0);

    // Before the edit: the target chunk is not in the snapshot at all.
    expect(store.getSnapshot().some((e) => e.key === key)).toBe(false);

    const before = store.getSnapshot();
    const result = store.apply(
      { type: "PlaceBlock", at, block: BlockType.Stone },
      { x: 0, y: 0, z: 0 }, // from
      undefined, // default reach
      { x: 1000, y: 0, z: 1000 }, // playerPosition far away -> no self-clip
    );

    expect(result.ok).toBe(true);

    // After the edit: the newly-created chunk is now a versioned entry,
    // carrying its own key + world-space origin + a bumped version — the
    // mesh WOULD mount.
    const after = store.getSnapshot();
    expect(after).not.toBe(before); // snapshot identity changed -> scene re-renders
    const entry = after.find((e) => e.key === key);
    expect(entry).toBeDefined();
    expect(entry!.origin).toEqual({ x: 0, y: 0, z: 0 });
    expect(entry!.version).toBe(1);
    expect(entry!.chunk.get(1, 0, 0)).toBe(BlockType.Stone);
  });

  it("editing an existing chunk keeps unchanged chunks' entry identity (O(dirty) rebuild)", () => {
    const world = new World();
    world.setBlock(1, 0, 0, BlockType.Stone); // chunk A (0,0,0)
    world.setBlock(20, 0, 0, BlockType.Stone); // chunk B (1,0,0)
    const store = createWorldStore(world);

    const before = store.getSnapshot();
    const keyB = chunkKey(1, 0, 0);
    const entryBefore = before.find((e) => e.key === keyB)!;

    store.apply({ type: "BreakBlock", at: { x: 1, y: 0, z: 0 } }, { x: 1, y: 0, z: 0 });

    const after = store.getSnapshot();
    // Unchanged chunk B kept its exact entry object -> ChunkMesh memo survives.
    expect(after.find((e) => e.key === keyB)).toBe(entryBefore);
  });
});
