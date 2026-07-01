import { describe, expect, it, vi } from "vitest";

import { BlockType } from "~/game/blocks";
import { chunkKey, worldToChunkCoord } from "~/game/coords";
import { createGameStore } from "~/game/store/world-store";
import { World } from "~/game/world";

const ORIGIN = { x: 0, y: 0, z: 0 };

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
});
