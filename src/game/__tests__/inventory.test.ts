import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import {
  addDrop,
  consumeSelected,
  createInventory,
  cycleSelection,
  HOTBAR_SIZE,
  selectSlot,
  STACK_CAP,
} from "~/game/inventory";

describe("createInventory", () => {
  it("starts with exactly HOTBAR_SIZE empty slots and slot 0 selected", () => {
    const inventory = createInventory();

    expect(inventory.slots).toHaveLength(HOTBAR_SIZE);
    for (const slot of inventory.slots) {
      expect(slot).toEqual({ block: null, count: 0 });
    }
    expect(inventory.selected).toBe(0);
  });
});

describe("addDrop", () => {
  it("puts a first drop into the first empty slot", () => {
    const inventory = addDrop(createInventory(), BlockType.Dirt);

    expect(inventory.slots[0]).toEqual({ block: BlockType.Dirt, count: 1 });
    expect(inventory.slots[1]).toEqual({ block: null, count: 0 });
  });

  it("stacks a repeated drop into the existing matching slot", () => {
    let inventory = createInventory();
    inventory = addDrop(inventory, BlockType.Dirt);
    inventory = addDrop(inventory, BlockType.Dirt);
    inventory = addDrop(inventory, BlockType.Dirt);

    expect(inventory.slots[0]).toEqual({ block: BlockType.Dirt, count: 3 });
    expect(inventory.slots[1]).toEqual({ block: null, count: 0 });
  });

  it("uses the first empty slot for a new block type without disturbing others", () => {
    let inventory = createInventory();
    inventory = addDrop(inventory, BlockType.Dirt);
    inventory = addDrop(inventory, BlockType.Stone);

    expect(inventory.slots[0]).toEqual({ block: BlockType.Dirt, count: 1 });
    expect(inventory.slots[1]).toEqual({ block: BlockType.Stone, count: 1 });
  });

  it("respects the 999 stack cap by overflowing into a new empty slot", () => {
    let inventory = createInventory();
    for (let i = 0; i < STACK_CAP; i++) {
      inventory = addDrop(inventory, BlockType.Dirt);
    }
    expect(inventory.slots[0]).toEqual({
      block: BlockType.Dirt,
      count: STACK_CAP,
    });

    inventory = addDrop(inventory, BlockType.Dirt);

    expect(inventory.slots[0]).toEqual({
      block: BlockType.Dirt,
      count: STACK_CAP,
    });
    expect(inventory.slots[1]).toEqual({ block: BlockType.Dirt, count: 1 });
  });

  it("bounds the hotbar at HOTBAR_SIZE slots and silently drops overflow", () => {
    // addDrop only ever compares block ids for equality — it never consults
    // BlockRegistry — so synthetic ids beyond the 5 real block types are a
    // valid, deterministic way to test "6 distinct types fill every slot,
    // a 7th distinct type has nowhere to go."
    const syntheticTypes = [101, 102, 103, 104, 105, 106] as unknown as BlockType[];

    let inventory = createInventory();
    for (const block of syntheticTypes) {
      inventory = addDrop(inventory, block);
    }
    expect(inventory.slots).toHaveLength(HOTBAR_SIZE);
    expect(inventory.slots.every((slot) => slot.block !== null)).toBe(true);

    // A 7th, never-before-seen type: no matching slot, no empty slot — the
    // drop is silently lost and the inventory is unchanged.
    const seventhType = 107 as unknown as BlockType;
    const before = inventory;
    inventory = addDrop(inventory, seventhType);

    expect(inventory).toBe(before);
    expect(inventory.slots).toHaveLength(HOTBAR_SIZE);
    expect(inventory.slots.some((slot) => slot.block === seventhType)).toBe(
      false,
    );
  });
});

describe("selectSlot", () => {
  it("selects a valid index in range", () => {
    const inventory = selectSlot(createInventory(), 3);
    expect(inventory.selected).toBe(3);
  });

  it("clamps an index above the valid range to the last slot", () => {
    const inventory = selectSlot(createInventory(), 99);
    expect(inventory.selected).toBe(HOTBAR_SIZE - 1);
  });

  it("clamps a negative index to slot 0", () => {
    const inventory = selectSlot(createInventory(), -1);
    expect(inventory.selected).toBe(0);
  });

  it("returns the same reference when the selection doesn't change", () => {
    const inventory = createInventory();
    expect(selectSlot(inventory, 0)).toBe(inventory);
  });
});

describe("cycleSelection", () => {
  it("advances one slot for a positive delta", () => {
    const inventory = cycleSelection(selectSlot(createInventory(), 2), 1);
    expect(inventory.selected).toBe(3);
  });

  it("goes back one slot for a negative delta", () => {
    const inventory = cycleSelection(selectSlot(createInventory(), 2), -1);
    expect(inventory.selected).toBe(1);
  });

  it("wraps from the last slot to the first going up", () => {
    const inventory = cycleSelection(
      selectSlot(createInventory(), HOTBAR_SIZE - 1),
      1,
    );
    expect(inventory.selected).toBe(0);
  });

  it("wraps from the first slot to the last going down", () => {
    const inventory = cycleSelection(selectSlot(createInventory(), 0), -1);
    expect(inventory.selected).toBe(HOTBAR_SIZE - 1);
  });

  it("only the sign of delta matters (large wheel deltaY still moves one slot)", () => {
    const inventory = cycleSelection(createInventory(), 137.5);
    expect(inventory.selected).toBe(1);
  });

  it("is a no-op for delta === 0", () => {
    const inventory = createInventory();
    expect(cycleSelection(inventory, 0)).toBe(inventory);
  });
});

describe("consumeSelected", () => {
  it("decrements the selected slot's count by one", () => {
    const inventory = addDrop(createInventory(), BlockType.Stone); // count: 1
    const { inventory: next, consumed } = consumeSelected(inventory);

    expect(consumed).toBe(true);
    expect(next.slots[0]).toEqual({ block: null, count: 0 });
  });

  it("clears block to null only once the count reaches zero", () => {
    let inventory = createInventory();
    inventory = addDrop(inventory, BlockType.Stone);
    inventory = addDrop(inventory, BlockType.Stone); // count: 2

    const { inventory: next, consumed } = consumeSelected(inventory);

    expect(consumed).toBe(true);
    expect(next.slots[0]).toEqual({ block: BlockType.Stone, count: 1 });
  });

  it("no-ops on an already-empty selected slot", () => {
    const inventory = createInventory();
    const { inventory: next, consumed } = consumeSelected(inventory);

    expect(consumed).toBe(false);
    expect(next).toBe(inventory);
  });

  it("consumes from whichever slot is selected, not always slot 0", () => {
    let inventory = createInventory();
    inventory = addDrop(inventory, BlockType.Dirt); // slot 0
    inventory = addDrop(inventory, BlockType.Stone); // slot 1
    inventory = selectSlot(inventory, 1);

    const { inventory: next, consumed } = consumeSelected(inventory);

    expect(consumed).toBe(true);
    expect(next.slots[0]).toEqual({ block: BlockType.Dirt, count: 1 });
    expect(next.slots[1]).toEqual({ block: null, count: 0 });
  });
});
