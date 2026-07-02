import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import {
  applyCommand,
  canBreak,
  canPlace,
  DEFAULT_REACH,
  type PlaceContext,
} from "~/game/command";
import { chunkKey, worldToChunkCoord } from "~/game/coords";
import { addDrop, createInventory } from "~/game/inventory";
import {
  boxFromFeetPosition,
  PLAYER_DEPTH,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "~/game/player/player-box";
import { World } from "~/game/world";

const ORIGIN = { x: 0, y: 0, z: 0 };
/** Far away from anything under test — a player box here never clips a
 *  candidate placement cell near the origin. */
const FAR_AWAY = { x: 1000, y: 0, z: 1000 };

function playerBoxAt(position = FAR_AWAY) {
  return boxFromFeetPosition(position, PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_DEPTH);
}

/** Build a `PlaceContext` with `block` sitting in the selected slot (so
 *  `NotInInventory` doesn't fire) and the player far away (so the clip
 *  check doesn't fire) unless the test overrides one of those. */
function placeContext(
  block: BlockType,
  overrides: Partial<PlaceContext> = {},
): PlaceContext {
  return {
    block,
    inventory: addDrop(createInventory(), block),
    playerBox: playerBoxAt(),
    ...overrides,
  };
}

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
      canPlace(
        world,
        { x: 100, y: 0, z: 0 },
        ORIGIN,
        DEFAULT_REACH,
        placeContext(BlockType.Stone),
      ),
    ).toBe("OutOfRange");
  });

  it("rejects an already-solid target as Occupied", () => {
    const world = new World();
    world.setBlock(1, 0, 0, BlockType.Stone);

    expect(
      canPlace(
        world,
        { x: 1, y: 0, z: 0 },
        ORIGIN,
        DEFAULT_REACH,
        placeContext(BlockType.Stone),
      ),
    ).toBe("Occupied");
  });

  it("rejects when the selected slot doesn't hold the block being placed as NotInInventory", () => {
    const world = new World();

    expect(
      canPlace(world, { x: 1, y: 0, z: 0 }, ORIGIN, DEFAULT_REACH, {
        block: BlockType.Stone,
        inventory: createInventory(), // every slot empty
        playerBox: playerBoxAt(),
      }),
    ).toBe("NotInInventory");
  });

  it("rejects when the selected slot holds a different block than requested as NotInInventory", () => {
    const world = new World();
    const inventory = addDrop(createInventory(), BlockType.Wood);

    expect(
      canPlace(world, { x: 1, y: 0, z: 0 }, ORIGIN, DEFAULT_REACH, {
        block: BlockType.Stone, // requesting Stone, but slot 0 holds Wood
        inventory,
        playerBox: playerBoxAt(),
      }),
    ).toBe("NotInInventory");
  });

  it("rejects a placement that would clip the player's AABB as Occupied", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    // Player standing with feet at (1.5, 0, 0.5) overlaps the candidate
    // cell's [1,2]x[0,1]x[0,1] box.
    const playerBox = playerBoxAt({ x: 1.5, y: 0, z: 0.5 });

    expect(
      canPlace(
        world,
        at,
        ORIGIN,
        DEFAULT_REACH,
        placeContext(BlockType.Stone, { playerBox }),
      ),
    ).toBe("Occupied");
  });

  it("allows an in-range, non-solid, in-inventory, non-clipping placement", () => {
    const world = new World();

    expect(
      canPlace(
        world,
        { x: 1, y: 0, z: 0 },
        ORIGIN,
        DEFAULT_REACH,
        placeContext(BlockType.Stone),
      ),
    ).toBeNull();
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
  it("sets the target cell, decrements the selected slot, and reports exactly the dirty chunk", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const inventory = addDrop(createInventory(), BlockType.Stone);

    const { result, inventory: nextInventory } = applyCommand(
      world,
      inventory,
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
      DEFAULT_REACH,
      FAR_AWAY,
    );

    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Stone);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.drop).toBeUndefined();

    const { cx, cy, cz } = worldToChunkCoord(at.x, at.y, at.z);
    expect(result.changed).toEqual([chunkKey(cx, cy, cz)]);
    expect(result.changed).toHaveLength(1);

    expect(nextInventory.slots[0]).toEqual({ block: null, count: 0 });
  });

  it("decrements a stacked slot by exactly one, keeping the remainder", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    let inventory = createInventory();
    inventory = addDrop(inventory, BlockType.Stone);
    inventory = addDrop(inventory, BlockType.Stone);
    inventory = addDrop(inventory, BlockType.Stone);

    const { inventory: nextInventory } = applyCommand(
      world,
      inventory,
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
      DEFAULT_REACH,
      FAR_AWAY,
    );

    expect(nextInventory.slots[0]).toEqual({ block: BlockType.Stone, count: 2 });
  });

  it("rejects placing onto an already-solid cell with Occupied and makes no changes", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    world.setBlock(at.x, at.y, at.z, BlockType.Dirt);
    const inventory = addDrop(createInventory(), BlockType.Stone);

    const { result, inventory: nextInventory } = applyCommand(
      world,
      inventory,
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
      DEFAULT_REACH,
      FAR_AWAY,
    );

    expect(result).toEqual({ ok: false, reason: "Occupied" });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Dirt);
    expect(nextInventory).toBe(inventory);
  });

  it("rejects placing from an empty selected slot with NotInInventory and makes no changes", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const inventory = createInventory(); // slot 0 empty

    const { result, inventory: nextInventory } = applyCommand(
      world,
      inventory,
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
      DEFAULT_REACH,
      FAR_AWAY,
    );

    expect(result).toEqual({ ok: false, reason: "NotInInventory" });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Air);
    expect(nextInventory).toBe(inventory);
  });

  it("rejects a placement that would clip the player with no crash and no world/inventory change", () => {
    const world = new World();
    const at = { x: 1, y: 0, z: 0 };
    const inventory = addDrop(createInventory(), BlockType.Stone);
    // Player feet at (1.5, 0, 0.5) overlaps the candidate cell.
    const playerPosition = { x: 1.5, y: 0, z: 0.5 };

    const { result, inventory: nextInventory } = applyCommand(
      world,
      inventory,
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
      DEFAULT_REACH,
      playerPosition,
    );

    expect(result).toEqual({ ok: false, reason: "Occupied" });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Air);
    expect(nextInventory).toBe(inventory);
  });

  it("rejects a too-far target with OutOfRange and makes no changes", () => {
    const world = new World();
    const at = { x: 100, y: 0, z: 0 };
    const inventory = addDrop(createInventory(), BlockType.Stone);

    const { result, inventory: nextInventory } = applyCommand(
      world,
      inventory,
      { type: "PlaceBlock", at, block: BlockType.Stone },
      ORIGIN,
      DEFAULT_REACH,
      FAR_AWAY,
    );

    expect(result).toEqual({ ok: false, reason: "OutOfRange" });
    expect(world.getBlock(at.x, at.y, at.z)).toBe(BlockType.Air);
    expect(nextInventory).toBe(inventory);
  });

  it("stops placing once the selected slot runs out (integration over repeated applies)", () => {
    const world = new World();
    let inventory = addDrop(createInventory(), BlockType.Stone); // count: 1

    const first = applyCommand(
      world,
      inventory,
      { type: "PlaceBlock", at: { x: 1, y: 0, z: 0 }, block: BlockType.Stone },
      ORIGIN,
      DEFAULT_REACH,
      FAR_AWAY,
    );
    expect(first.result.ok).toBe(true);
    inventory = first.inventory;
    expect(inventory.slots[0]).toEqual({ block: null, count: 0 });

    // Slot is now empty — the next placement attempt (a different cell, so
    // it isn't rejected as Occupied) must be rejected as NotInInventory and
    // make no further changes.
    const second = applyCommand(
      world,
      inventory,
      { type: "PlaceBlock", at: { x: 2, y: 0, z: 0 }, block: BlockType.Stone },
      ORIGIN,
      DEFAULT_REACH,
      FAR_AWAY,
    );

    expect(second.result).toEqual({ ok: false, reason: "NotInInventory" });
    expect(world.getBlock(2, 0, 0)).toBe(BlockType.Air);
    expect(second.inventory).toBe(inventory);
  });
});
