/**
 * Pure layout/lookup data for the procedural block texture atlas: which
 * tiles exist, where they sit in the atlas grid, and which tile each block
 * type's faces sample. No `three`/canvas/DOM here — `atlas.ts` (which does
 * touch `document`/`canvas`) imports this to know *where* to paint each
 * tile, and `chunk-mesh.tsx` imports it to know *which* atlas rectangle each
 * face of a given block type's `BoxGeometry` should sample.
 */

import { BlockType, type BlockTypeId } from "~/game/blocks";

/** Pixel size of one square tile in the atlas. */
export const ATLAS_TILE_PX = 16;

/** Atlas grid dimensions, in tiles. */
export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;

/** Every distinct tile the atlas paints. */
export type TileName =
  | "dirt"
  | "stone"
  | "leaves"
  | "grass_top"
  | "grass_side"
  | "grass_bottom"
  | "wood_top"
  | "wood_side";

interface TileCell {
  readonly col: number;
  readonly row: number;
}

/** Fixed grid position of every tile, in tile (not pixel) units. */
export const TILE_LAYOUT: Record<TileName, TileCell> = {
  dirt: { col: 0, row: 0 },
  stone: { col: 1, row: 0 },
  leaves: { col: 2, row: 0 },
  grass_top: { col: 3, row: 0 },
  grass_side: { col: 0, row: 1 },
  grass_bottom: { col: 1, row: 1 },
  wood_top: { col: 2, row: 1 },
  wood_side: { col: 3, row: 1 },
};

export interface AtlasRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/**
 * UV rectangle for a tile, in the [0,1] texture-coordinate space three.js
 * expects.
 *
 * Row 0 is the *top* row of the source canvas (canvas 2D draws top-down).
 * We map row 0 to the *upper* v band (closer to v=1) so that artwork drawn
 * visually "up" in the canvas (e.g. grass_side's green fringe, wood_top's
 * ring center) samples as "up" on a box face too — verified empirically
 * against three@0.185.1's `BoxGeometry`: its default per-face UVs place
 * v=1 at the box's +Y-ward vertices of that face (see `box-uv.ts` for the
 * full verification note), matching this convention with no extra flip.
 */
export function tileRect(name: TileName): AtlasRect {
  const { col, row } = TILE_LAYOUT[name];
  const u0 = col / ATLAS_COLS;
  const u1 = (col + 1) / ATLAS_COLS;
  const v1 = 1 - row / ATLAS_ROWS;
  const v0 = 1 - (row + 1) / ATLAS_ROWS;
  return { u0, v0, u1, v1 };
}

/** The 6 axis-aligned faces of a box, named by the world axis they face. */
export interface BoxFaceTiles {
  readonly top: TileName;
  readonly bottom: TileName;
  readonly px: TileName;
  readonly nx: TileName;
  readonly pz: TileName;
  readonly nz: TileName;
}

function uniformFaces(tile: TileName): BoxFaceTiles {
  return { top: tile, bottom: tile, px: tile, nx: tile, pz: tile, nz: tile };
}

const BLOCK_FACE_TILES: Partial<Record<BlockTypeId, BoxFaceTiles>> = {
  [BlockType.Dirt]: uniformFaces("dirt"),
  [BlockType.Stone]: uniformFaces("stone"),
  [BlockType.Leaves]: uniformFaces("leaves"),
  [BlockType.Grass]: {
    top: "grass_top",
    bottom: "grass_bottom",
    px: "grass_side",
    nx: "grass_side",
    pz: "grass_side",
    nz: "grass_side",
  },
  [BlockType.Wood]: {
    top: "wood_top",
    bottom: "wood_top",
    px: "wood_side",
    nx: "wood_side",
    pz: "wood_side",
    nz: "wood_side",
  },
};

/**
 * Per-face atlas tiles for a solid block type. `Air` (never rendered — see
 * `isSolid`) and any block type without an explicit entry fall back to the
 * "stone" tile on every face so a lookup here never throws.
 */
export function getBlockFaceTiles(id: BlockTypeId): BoxFaceTiles {
  return BLOCK_FACE_TILES[id] ?? uniformFaces("stone");
}
