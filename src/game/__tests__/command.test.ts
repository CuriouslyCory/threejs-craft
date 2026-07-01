import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { applyCommand, canBreak, canPlace, DEFAULT_REACH } from "~/game/command";
import { chunkKey, worldToChunkCoord } from "~/game/coords";
import { createInventory } from "~/game/inventory";
import { World } from "~/game/world";

const ORIGIN = { x: 0, y: 0, z: 0 };

describe("canBreak", () => {
  it("allows breaking a solid block within reach", () => {
    const world = new World();
    world.setBlock(1, 0, 0, BlockType.Stone);

    expect(canBreak(world, { x: 1, y: 0, z: 0 }, ORIGIN, DEFAULT_REACH)).toBeNull();
  });

  it("rejects a target beyond reach as OutOfRange", () => {
    const world = new World();
    world.setBlock(100, 0, 0, BlockType.Stone);

    expect(
      canBreak(world, { x: 100, y: 0, z: 0 }, ORIGIN, DEFAULT_REACH),
    ).toBe("OutOfRange");
  });

  it("rejects an Air target as TargetIsAir", () => {
    const world = new World();

    expect(canBreak(world, { x: 1, y: 0, z: 0 }, ORIGIN, DEFAULT_REACH)).toBe(
      "TargetIsAir",
    );
  });
});

describe("canPlace", () => {
  it("rejects a target beyond reach as OutOfRange", () => {
    const world = new World();

    expect(
      canPlace(world, { x: 100, y: 0, z: 0 }, ORIGIN, DEFAULT_REACH),
    ).toBe("OutOfRange");
  });

  it("rejects an already-solid target as Occupied", () => {
    const world = new World();
    world.setBlock(1, 0, 0, BlockType.Stone);

    expect(canPlace(world, { x: 1, y: 0, z: 0 }, ORIGIN, DEFAULT_REACH)).toBe(
      "Occupied",
    );
  });

  it("allows an in-range, non-solid target", () => {
    const world = new World();

    expect(canPlace(world, { x: 1, y: 0, z: 0 }, ORIGIN, DEFAULT_REACH)).toBeNull();
  });
});

describe("applyCommand(BreakBlock)", () => {
  it("turns the target into Air, credits the drop, and reports exactly the dirty chunk", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    world.setBlock(at.x, at.y, at.z, BlockType.Stone);

    const { result, inventory } = applyCommand(
      world,
      createInventory(),
      { type: "BreakBlock", at },
      ORIGIN,
    );

    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Air);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.drop).toBe(BlockType.Stone);

    const { cx, cy, cz } = worldToChunkCoord(at.x, at.y, at.z);
    expect(result.changed).toEqual([chunkKey(cx, cy, cz)]);
    expect(result.changed).toHaveLength(1);

    expect(inventory.slots[0]).toEqual({ block: BlockType.Stone, count: 1 });
  });

  it("credits the block's own registered drop, not always Stone", () => {
    const world = new World();
    const at = { x: 2, y: 0, z: 0 };
    world.setBlock(at.x, at.y, at.z, BlockType.Wood);

    const { result, inventory } = applyCommand(
      world,
      createInventory(),
      { type: "BreakBlock", at },
      ORIGIN,
    );

    if (!result.ok) throw new Error("expected ok:true");
    expect(result.drop).toBe(BlockType.Wood);
    expect(inventory.slots[0]?.block).toBe(BlockType.Wood);
  });

  it("rejects a too-far target with OutOfRange and makes no changes", () => {
    const world = new World();
    const at = { x: 100, y: 0, z: 0 };
    world.setBlock(at.x, at.y, at.z, BlockType.Stone);
    const inventory = createInventory();

    const { result, inventory: nextInventory } = applyCommand(
      world,
      inventory,
      { type: "BreakBlock", at },
      ORIGIN,
    );

    expect(result).toEqual({ ok: false, reason: "OutOfRange" });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Stone);
    expect(nextInventory).toBe(inventory);
  });

  it("rejects an Air target with TargetIsAir and makes no changes", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const inventory = createInventory();

    const { result, inventory: nextInventory } = applyCommand(
      world,
      inventory,
      { type: "BreakBlock", at },
      ORIGIN,
    );

    expect(result).toEqual({ ok: false, reason: "TargetIsAir" });
    expect(nextInventory).toBe(inventory);
  });
});

describe("applyCommand(PlaceBlock)", () => {
  it("is a typed not-yet-implemented stub in #8 — never ok:true", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };

    const { result } = applyCommand(
      world,
      createInventory(),
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
    );

    expect(result.ok).toBe(false);
    // Doesn't leak "not implemented" as a fake reason — reuses a real one.
    if (!result.ok) {
      expect(["OutOfRange", "TargetIsAir", "Occupied", "NotInInventory"]).toContain(
        result.reason,
      );
    }
  });
});
