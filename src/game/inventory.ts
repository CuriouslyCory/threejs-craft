/**
 * Pure 6-slot hotbar inventory model.
 *
 * No three.js, no React, no DOM — `Inventory` values are plain readonly data
 * and every function here returns a new `Inventory` rather than mutating its
 * argument, so this is unit-testable in plain Node and safe to hand to
 * `GameStore` (`src/game/store/world-store.ts`) as the domain core it
 * mutates its own copy of.
 */

import { BlockType } from "~/game/blocks";

/** Fixed hotbar length — not configurable in the MVP. */
export const HOTBAR_SIZE = 6;

/** Maximum items a single slot can hold before it's considered full. */
export const STACK_CAP = 999;

/** An empty slot has no block and zero count. */
export interface InventorySlot {
  readonly block: BlockType | null;
  readonly count: number;
}

export interface Inventory {
  /** Always exactly `HOTBAR_SIZE` entries, index 0..5. */
  readonly slots: readonly InventorySlot[];
  /** Currently-selected hotbar slot index. Dormant in #8 — #9 wires number-key
   *  selection and consumes this for `PlaceBlock`'s source slot. */
  readonly selected: number;
}

const EMPTY_SLOT: InventorySlot = { block: null, count: 0 };

/** A fresh, all-empty 6-slot hotbar with slot 0 selected. */
export function createInventory(): Inventory {
  return {
    slots: Array.from({ length: HOTBAR_SIZE }, () => EMPTY_SLOT),
    selected: 0,
  };
}

function replaceSlotAt(
  slots: readonly InventorySlot[],
  index: number,
  slot: InventorySlot,
): readonly InventorySlot[] {
  return slots.map((existing, i) => (i === index ? slot : existing));
}

/**
 * Add one unit of `block` to the hotbar: stack into an existing slot of the
 * same block type that still has room under `STACK_CAP`, else the first
 * empty slot, else the drop is lost (hotbar is full and every matching slot
 * is capped) — the MVP has no overflow/ground-drop concept yet.
 */
export function addDrop(inventory: Inventory, block: BlockType): Inventory {
  if (block === BlockType.Air) {
    // Air is never a real drop (see `BlockRegistry[Air].drop`), but guard
    // defensively rather than let a slot silently claim to hold "Air".
    return inventory;
  }

  const { slots } = inventory;

  const matchIndex = slots.findIndex(
    (slot) => slot.block === block && slot.count < STACK_CAP,
  );
  if (matchIndex !== -1) {
    const slot = slots[matchIndex]!;
    return {
      ...inventory,
      slots: replaceSlotAt(slots, matchIndex, {
        block,
        count: slot.count + 1,
      }),
    };
  }

  const emptyIndex = slots.findIndex((slot) => slot.block === null);
  if (emptyIndex !== -1) {
    return {
      ...inventory,
      slots: replaceSlotAt(slots, emptyIndex, { block, count: 1 }),
    };
  }

  // Hotbar full and every slot holding `block` is at `STACK_CAP` — nothing
  // to do. Revisit once a "drop on ground" or overflow slot concept exists.
  return inventory;
}
