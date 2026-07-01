import { describe, expect, it, vi } from "vitest";

import { BlockType } from "~/game/blocks";
import { chunkKey, worldToChunkCoord } from "~/game/coords";
import { addDrop, createInventory } from "~/game/inventory";
import { createGameStore } from "~/game/store/world-store";
import { World } from "~/game/world";

const ORIGIN = { x: 0, y: 0, z: 0 };
const FAR_AWAY = { x: 1000, y: 0, z: 1000 };

describe("GameStore.apply", () => {
  it("mutates the world, credits inventory, and bumps only the dirty chunk's version", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    world.setBlock(at.x, at.y, at.z, BlockType.Stone);
    const store = createGameStore(world);

    const otherChunk = chunkKey(5, 0, 0);
    const { cx, cy, cz } = worldToChunkCoord(at.x, at.y, at.z);
    const dirtyChunk = chunkKey(cx, cy, cz);

    expect(store.getChunkVersion(dirtyChunk)).toBe(0);
    expect(store.getChunkVersion(otherChunk)).toBe(0);

    const result = store.apply({ type: "BreakBlock", at }, ORIGIN);

    expect(result).toEqual({ ok: true, changed: [dirtyChunk], drop: BlockType.Stone });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Air);
    expect(store.getInventorySnapshot().slots[0]).toEqual({
      block: BlockType.Stone,
      count: 1,
    });

    // Only the dirty chunk's version moved — an unrelated chunk stays at 0.
    expect(store.getChunkVersion(dirtyChunk)).toBe(1);
    expect(store.getChunkVersion(otherChunk)).toBe(0);
  });

  it("notifies subscribers on a successful apply but not on a rejected one", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const store = createGameStore(world);
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
    const store = createGameStore(world);
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
    const store = createGameStore(world, inventory);

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
    expect(store.getChunkVersion(dirtyChunk)).toBe(1);
    expect(store.getChunkVersion(otherChunk)).toBe(0);
  });

  it("rejects PlaceBlock without a usable slot and makes no changes", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const store = createGameStore(world); // empty inventory

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

describe("GameStore.selectSlot / cycleSelection", () => {
  it("selectSlot updates the snapshot and notifies subscribers", () => {
    const store = createGameStore(new World());
    const listener = vi.fn();
    store.subscribe(listener);

    store.selectSlot(3);

    expect(store.getInventorySnapshot().selected).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("selectSlot to the already-selected slot is a no-op (no notification)", () => {
    const store = createGameStore(new World());
    const listener = vi.fn();
    store.subscribe(listener);

    store.selectSlot(0); // already selected

    expect(listener).not.toHaveBeenCalled();
  });

  it("cycleSelection wraps from the last slot back to the first", () => {
    const store = createGameStore(new World());
    store.selectSlot(5);

    store.cycleSelection(1); // wheel "down" convention in this codebase: positive advances

    expect(store.getInventorySnapshot().selected).toBe(0);
  });

  it("cycleSelection wraps from the first slot to the last going the other way", () => {
    const store = createGameStore(new World());

    store.cycleSelection(-1);

    expect(store.getInventorySnapshot().selected).toBe(5);
  });
});
