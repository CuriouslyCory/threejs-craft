import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { DEFAULT_REACH } from "~/game/command";
import {
  deriveInteraction,
  resolveTargetCells,
  type CameraPose,
  type RaycastHit,
} from "~/game/interaction";
import { addDrop, createInventory } from "~/game/inventory";
import { EYE_HEIGHT } from "~/game/player/player-box";

const EYE = { x: 0.5, y: 10, z: 0.5 };
const POSE: CameraPose = { eye: EYE };
/** Within DEFAULT_REACH of EYE. */
const CELL = { x: 0, y: 8, z: 0 };

function hitAt(
  distance: number,
  overrides: Partial<RaycastHit> = {},
): RaycastHit {
  return { cell: CELL, distance, ...overrides };
}

function inventoryWithSelection(): ReturnType<typeof createInventory> {
  return addDrop(createInventory(), BlockType.Dirt);
}

describe("resolveTargetCells", () => {
  it("returns nulls when the hit is out of reach", () => {
    const hit = hitAt(DEFAULT_REACH + 0.1);
    expect(resolveTargetCells(hit)).toEqual({ target: null, place: null });
  });

  it("resolves the target at exactly the reach boundary (inclusive)", () => {
    const hit = hitAt(DEFAULT_REACH);
    expect(resolveTargetCells(hit).target).toEqual(CELL);
  });

  it("returns nulls when there is no hit at all", () => {
    expect(resolveTargetCells(null)).toEqual({ target: null, place: null });
  });

  it("snaps a near-+y face normal to place one cell above target", () => {
    const hit = hitAt(1, { faceNormal: { x: 0.0001, y: 0.9999, z: 0 } });
    const { place } = resolveTargetCells(hit);
    expect(place).toEqual({ x: CELL.x, y: CELL.y + 1, z: CELL.z });
  });

  it("snaps a -x face normal to place one cell in -x", () => {
    const hit = hitAt(1, { faceNormal: { x: -1, y: 0, z: 0 } });
    const { place } = resolveTargetCells(hit);
    expect(place?.x).toBe(CELL.x - 1);
  });

  it("has a null place cell when the hit carries no face normal", () => {
    const hit = hitAt(1);
    const { target, place } = resolveTargetCells(hit);
    expect(target).toEqual(CELL);
    expect(place).toBeNull();
  });
});

describe("deriveInteraction — break", () => {
  it("derives a BreakBlock command from an in-reach hit", () => {
    const hit = hitAt(1);
    const result = deriveInteraction(
      POSE,
      hit,
      inventoryWithSelection(),
      "break",
    );
    expect(result).not.toBeNull();
    expect(result?.command).toEqual({ type: "BreakBlock", at: CELL });
    expect(result?.from).toEqual(EYE);
    expect(result?.playerPosition).toEqual(EYE);
    expect(result?.reach).toBe(DEFAULT_REACH);
  });

  it("succeeds even with an empty inventory (break gate is place-only)", () => {
    const hit = hitAt(1);
    const result = deriveInteraction(POSE, hit, createInventory(), "break");
    expect(result).not.toBeNull();
  });

  it("returns null when out of reach", () => {
    const hit = hitAt(DEFAULT_REACH + 0.1);
    const result = deriveInteraction(
      POSE,
      hit,
      inventoryWithSelection(),
      "break",
    );
    expect(result).toBeNull();
  });

  it("returns null when there is no hit", () => {
    const result = deriveInteraction(
      POSE,
      null,
      inventoryWithSelection(),
      "break",
    );
    expect(result).toBeNull();
  });
});

describe("deriveInteraction — place", () => {
  it("derives a PlaceBlock command via the face normal", () => {
    const hit = hitAt(1, { faceNormal: { x: 0, y: 1, z: 0 } });
    const inventory = inventoryWithSelection();
    const selectedBlock = inventory.slots[inventory.selected]?.block;
    const result = deriveInteraction(POSE, hit, inventory, "place");
    expect(result).not.toBeNull();
    expect(result?.command).toEqual({
      type: "PlaceBlock",
      at: { x: CELL.x, y: CELL.y + 1, z: CELL.z },
      block: selectedBlock,
    });
    expect(result?.from).toEqual(EYE);
    expect(result?.reach).toBe(DEFAULT_REACH);
  });

  it("returns null when out of reach", () => {
    const hit = hitAt(DEFAULT_REACH + 0.1, {
      faceNormal: { x: 0, y: 1, z: 0 },
    });
    const result = deriveInteraction(
      POSE,
      hit,
      inventoryWithSelection(),
      "place",
    );
    expect(result).toBeNull();
  });

  it("returns null when there is no hit", () => {
    const result = deriveInteraction(
      POSE,
      null,
      inventoryWithSelection(),
      "place",
    );
    expect(result).toBeNull();
  });

  it("returns null when the hit has no face normal", () => {
    const hit = hitAt(1);
    const result = deriveInteraction(
      POSE,
      hit,
      inventoryWithSelection(),
      "place",
    );
    expect(result).toBeNull();
  });

  it("rejects placement when the selected slot is empty", () => {
    const hit = hitAt(1, { faceNormal: { x: 0, y: 1, z: 0 } });
    const result = deriveInteraction(POSE, hit, createInventory(), "place");
    expect(result).toBeNull();
  });
});

describe("deriveInteraction — eye <-> feet round-trip", () => {
  it("recovers the exact feet position via EYE_HEIGHT, matching player-controller's inverse", () => {
    const feet = { x: 3, y: 12, z: -7 };
    const eye = { x: feet.x, y: feet.y + EYE_HEIGHT, z: feet.z };
    const hit = hitAt(1, { faceNormal: { x: 0, y: 1, z: 0 } });
    const result = deriveInteraction(
      { eye },
      hit,
      inventoryWithSelection(),
      "place",
    );
    expect(result?.playerPosition).toEqual(feet);
  });
});
