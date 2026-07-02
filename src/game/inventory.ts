/**
 * Pure 6-slot hotbar inventory model.
 *
 * No three.js, no React, no DOM — `Inventory` values are plain readonly data
 * and every function here returns a new `Inventory` rather than mutating its
 * argument, so this is unit-testable in plain Node and safe to hand to
 * `WorldStore` (`src/game/store/world-store.ts`) as the domain core it
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
  /** Currently-selected hotbar slot index (0..HOTBAR_SIZE-1). Set by
   *  `selectSlot`/`cycleSelection` below; `PlaceBlock` places from and
   *  `consumeSelected` decrements this slot. */
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

/**
 * Select a hotbar slot by absolute index (e.g. number keys 1-6 -> 0..5).
 * Clamped into the valid `0..HOTBAR_SIZE-1` range rather than throwing, so a
 * stray out-of-range index can't corrupt `selected` — callers that already
 * validate their own index (e.g. `index = key - 1` for keys 1-6) never hit
 * the clamp in practice.
 */
export function selectSlot(inventory: Inventory, index: number): Inventory {
  const clamped = Math.max(0, Math.min(HOTBAR_SIZE - 1, Math.trunc(index)));
  if (clamped === inventory.selected) {
    return inventory;
  }
  return { ...inventory, selected: clamped };
}

/**
 * Move the selection by one slot in the direction of `delta`'s sign,
 * wrapping around both ends (5 -> 0 going up, 0 -> 5 going down) — the
 * mouse-wheel hotbar convention. Only the sign of `delta` matters (a wheel
 * event's `deltaY` magnitude varies by device/browser); `delta === 0` is a
 * no-op rather than an arbitrary direction.
 */
export function cycleSelection(inventory: Inventory, delta: number): Inventory {
  if (delta === 0) {
    return inventory;
  }
  const step = delta > 0 ? 1 : -1;
  const next =
    (((inventory.selected + step) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  return { ...inventory, selected: next };
}

export interface ConsumeResult {
  readonly inventory: Inventory;
  /** False when the selected slot was already empty — a no-op, not an error. */
  readonly consumed: boolean;
}

/**
 * Decrement one unit from the currently-selected slot, clearing it back to
 * `EMPTY_SLOT` once its count reaches zero. This is the mutation half of
 * placing a block — callers (`command.ts`'s `PlaceBlock` handling) must
 * already have checked `canPlace`'s `NotInInventory` rejection before
 * calling this; `consumeSelected` itself just no-ops (`consumed: false`) on
 * an empty slot rather than re-validating.
 */
export function consumeSelected(inventory: Inventory): ConsumeResult {
  const slot = inventory.slots[inventory.selected];
  if (slot?.block == null || slot.count <= 0) {
    return { inventory, consumed: false };
  }

  const nextCount = slot.count - 1;
  const nextSlot: InventorySlot =
    nextCount === 0 ? EMPTY_SLOT : { block: slot.block, count: nextCount };

  return {
    inventory: {
      ...inventory,
      slots: replaceSlotAt(inventory.slots, inventory.selected, nextSlot),
    },
    consumed: true,
  };
}
