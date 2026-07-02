import { describe, expect, it } from "vitest";

import {
  boxesOverlap,
  boxIntersectsSolid,
  sweepAxis,
  translateBox,
} from "~/game/player/aabb";
import { boxFromFeetPosition } from "~/game/player/player-box";
import { BlockType } from "~/game/blocks";
import { World } from "~/game/world";

describe("boxFromFeetPosition", () => {
  it("builds a box centered on x/z and resting on y", () => {
    const box = boxFromFeetPosition({ x: 5, y: 10, z: 5 }, 0.6, 1.8, 0.6);
    expect(box.min).toEqual({ x: 4.7, y: 10, z: 4.7 });
    expect(box.max).toEqual({ x: 5.3, y: 11.8, z: 5.3 });
  });
});

describe("translateBox", () => {
  it("shifts only the requested axis", () => {
    const box = boxFromFeetPosition({ x: 0, y: 0, z: 0 }, 1, 1, 1);
    const moved = translateBox(box, "y", 2);
    expect(moved.min).toEqual({ x: -0.5, y: 2, z: -0.5 });
    expect(moved.max).toEqual({ x: 0.5, y: 3, z: 0.5 });
  });
});

describe("boxIntersectsSolid", () => {
  it("is false over open air", () => {
    const world = new World();
    const box = boxFromFeetPosition({ x: 0, y: 10, z: 0 }, 0.6, 1.8, 0.6);
    expect(boxIntersectsSolid(world, box)).toBe(false);
  });

  it("is true when the box overlaps a solid voxel", () => {
    const world = new World();
    world.setBlock(0, 4, 0, BlockType.Stone);
    const box = boxFromFeetPosition({ x: 0, y: 4, z: 0 }, 0.6, 1.8, 0.6);
    expect(boxIntersectsSolid(world, box)).toBe(true);
  });
});

describe("sweepAxis", () => {
  it("returns the full delta unmodified when nothing is in the way", () => {
    const world = new World();
    const box = boxFromFeetPosition({ x: 0, y: 10, z: 0 }, 0.6, 1.8, 0.6);
    const result = sweepAxis(world, box, "x", 1);
    expect(result).toEqual({ delta: 1, collided: false });
  });

  it("clamps the delta just short of a solid voxel face and reports collision", () => {
    const world = new World();
    // Solid column at x in [3, 4). Box starts with max.x at 2.3, moving +2
    // would end at max.x = 4.3, well past the face at x=3.
    world.setBlock(3, 5, 0, BlockType.Stone);
    const box = boxFromFeetPosition({ x: 2, y: 5, z: 0 }, 0.6, 1.8, 0.6);
    const result = sweepAxis(world, box, "x", 2);

    expect(result.collided).toBe(true);
    expect(result.delta).toBeLessThan(1); // stopped well short of the full 2
    expect(result.delta).toBeGreaterThan(0);

    const resolved = translateBox(box, "x", result.delta);
    expect(resolved.max.x).toBeLessThanOrEqual(3);
    expect(boxIntersectsSolid(world, resolved)).toBe(false);
  });

  it("does not let the clamp cross to the other side of the face", () => {
    const world = new World();
    world.setBlock(-1, 5, 0, BlockType.Stone); // wall spans x in [-1, 0)
    const box = boxFromFeetPosition({ x: 1, y: 5, z: 0 }, 0.6, 1.8, 0.6);
    // A modest overshoot into the wall (not a multi-block leap, which would
    // legitimately tunnel through a single-voxel-thick wall — that's why
    // real callers must clamp dt/frame delta to sub-block steps).
    const result = sweepAxis(world, box, "x", -0.9);

    expect(result.collided).toBe(true);
    const resolved = translateBox(box, "x", result.delta);
    expect(resolved.min.x).toBeGreaterThanOrEqual(0);
  });
});

describe("boxesOverlap", () => {
  it("is true when two boxes' volumes overlap", () => {
    const a = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const b = { min: { x: 0.5, y: 0.5, z: 0.5 }, max: { x: 1.5, y: 1.5, z: 1.5 } };
    expect(boxesOverlap(a, b)).toBe(true);
  });

  it("is false when two boxes are far apart", () => {
    const a = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const b = { min: { x: 10, y: 10, z: 10 }, max: { x: 11, y: 11, z: 11 } };
    expect(boxesOverlap(a, b)).toBe(false);
  });

  it("is false when two boxes only touch along a shared face", () => {
    const a = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const b = { min: { x: 1, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } };
    expect(boxesOverlap(a, b)).toBe(false);
  });
});
