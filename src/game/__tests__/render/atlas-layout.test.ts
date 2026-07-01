import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  TILE_LAYOUT,
  getBlockFaceTiles,
  getCatGrassFaceTiles,
  tileRect,
  type TileName,
} from "~/game/render/atlas-layout";

describe("tileRect", () => {
  it("gives every tile a unit-square rect within [0,1]", () => {
    for (const name of Object.keys(TILE_LAYOUT) as TileName[]) {
      const rect = tileRect(name);
      expect(rect.u1 - rect.u0).toBeCloseTo(1 / ATLAS_COLS);
      expect(rect.v1 - rect.v0).toBeCloseTo(1 / ATLAS_ROWS);
      expect(rect.u0).toBeGreaterThanOrEqual(0);
      expect(rect.u1).toBeLessThanOrEqual(1);
      expect(rect.v0).toBeGreaterThanOrEqual(0);
      expect(rect.v1).toBeLessThanOrEqual(1);
    }
  });

  it("gives every tile a distinct, non-overlapping rect", () => {
    const names = Object.keys(TILE_LAYOUT) as TileName[];
    const rects = names.map(tileRect);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlapsU = a.u0 < b.u1 && b.u0 < a.u1;
        const overlapsV = a.v0 < b.v1 && b.v0 < a.v1;
        expect(overlapsU && overlapsV).toBe(false);
      }
    }
  });
});

describe("getBlockFaceTiles", () => {
  it("gives grass 3 distinct tiles matching its topSideBottom texture mode", () => {
    const faces = getBlockFaceTiles(BlockType.Grass);
    expect(faces.top).toBe("grass_top");
    expect(faces.bottom).toBe("grass_bottom");
    expect(faces.px).toBe("grass_side");
    expect(faces.nx).toBe("grass_side");
    expect(faces.pz).toBe("grass_side");
    expect(faces.nz).toBe("grass_side");
  });

  it("gives wood 2 distinct tiles matching its topSide texture mode", () => {
    const faces = getBlockFaceTiles(BlockType.Wood);
    expect(faces.top).toBe("wood_top");
    expect(faces.bottom).toBe("wood_top");
    expect(faces.px).toBe("wood_side");
    expect(faces.nx).toBe("wood_side");
    expect(faces.pz).toBe("wood_side");
    expect(faces.nz).toBe("wood_side");
  });

  it("gives uniform-mode blocks (dirt, stone, leaves) the same tile on every face", () => {
    for (const [blockType, expected] of [
      [BlockType.Dirt, "dirt"],
      [BlockType.Stone, "stone"],
      [BlockType.Leaves, "leaves"],
    ] as const) {
      const faces = getBlockFaceTiles(blockType);
      expect(new Set(Object.values(faces))).toEqual(new Set([expected]));
    }
  });
});

describe("getCatGrassFaceTiles", () => {
  it("matches plain grass on every face except the top", () => {
    const grass = getBlockFaceTiles(BlockType.Grass);
    const catGrass = getCatGrassFaceTiles();

    expect(catGrass.top).toBe("cat_face_grass_top");
    expect(catGrass.bottom).toBe(grass.bottom);
    expect(catGrass.px).toBe(grass.px);
    expect(catGrass.nx).toBe(grass.nx);
    expect(catGrass.pz).toBe(grass.pz);
    expect(catGrass.nz).toBe(grass.nz);
  });

  it("the cat-face tile has its own atlas rect (present in TILE_LAYOUT, distinct from grass_top)", () => {
    expect(TILE_LAYOUT.cat_face_grass_top).toBeDefined();
    const catRect = tileRect("cat_face_grass_top");
    const grassRect = tileRect("grass_top");
    expect(catRect).not.toEqual(grassRect);
  });
});
