/**
 * Pure, deterministic world generation for the flat "test map".
 *
 * `generateWorld` takes no ambient state (no `Math.random`, no `Date.now`,
 * no DOM/three imports) — everything it needs comes from `config`, and
 * every seeded decision is drawn from the `Rng` created from `config.seed`.
 * The same seed always produces a byte-identical `World`.
 */

import { BlockType } from "~/game/blocks";
import { createRng, type Rng } from "~/game/rng";
import { World } from "~/game/world";

/** Default map footprint: 48x48 voxels in x/z. */
export const DEFAULT_WORLD_SIZE = 48;

/** Terrain layer heights (world y). */
export const STONE_TOP_Y = 2; // stone occupies y 0..2
export const DIRT_Y = 3;
export const GRASS_Y = 4;
export const GROUND_SURFACE_Y = GRASS_Y;

/** Tree shape constants. */
const TRUNK_HEIGHT = 4;
const TREE_MIN_COUNT = 6;
const TREE_MAX_COUNT = 10;
/** Minimum center-to-center spacing between two trees, in blocks. */
const TREE_MIN_SPACING = 5;
/** Radius (in blocks, from map center) kept clear of trees for spawn. */
const SPAWN_EXCLUSION_RADIUS = 4;
/** Safety cap so tree placement can never loop forever. */
const MAX_PLACEMENT_ATTEMPTS = 2000;

export interface GenerateWorldConfig {
  /** Seed string driving every random decision. Same seed -> same world. */
  readonly seed: string;
  /** Map footprint in x/z voxels. Defaults to 48. */
  readonly size?: number;
}

export interface TreePlacement {
  readonly x: number;
  readonly z: number;
}

export interface GeneratedWorld {
  readonly world: World;
  /** Centers of every placed tree, exposed to make testing/inspection easy. */
  readonly trees: readonly TreePlacement[];
  readonly size: number;
  readonly spawn: { readonly x: number; readonly z: number };
}

function fillTerrainColumn(world: World, x: number, z: number): void {
  for (let y = 0; y <= STONE_TOP_Y; y++) {
    world.setBlock(x, y, z, BlockType.Stone);
  }
  world.setBlock(x, DIRT_Y, z, BlockType.Dirt);
  world.setBlock(x, GRASS_Y, z, BlockType.Grass);
}

function generateTerrain(world: World, size: number): void {
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      fillTerrainColumn(world, x, z);
    }
  }
}

function squaredDistance(
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Pick 6-10 tree center positions: off-spawn, min-spaced, canopy-in-bounds. */
function pickTreePositions(
  rng: Rng,
  size: number,
  spawn: { x: number; z: number },
): TreePlacement[] {
  const treeCount =
    TREE_MIN_COUNT +
    Math.floor(rng() * (TREE_MAX_COUNT - TREE_MIN_COUNT + 1));

  const positions: TreePlacement[] = [];
  // Canopy spans center-1..center+1, so keep a 1-voxel margin from the edges.
  const min = 1;
  const max = size - 2;

  let attempts = 0;
  while (positions.length < treeCount && attempts < MAX_PLACEMENT_ATTEMPTS) {
    attempts++;
    const x = min + Math.floor(rng() * (max - min + 1));
    const z = min + Math.floor(rng() * (max - min + 1));

    if (
      squaredDistance(x, z, spawn.x, spawn.z) <
      SPAWN_EXCLUSION_RADIUS * SPAWN_EXCLUSION_RADIUS
    ) {
      continue;
    }

    const tooClose = positions.some(
      (p) =>
        squaredDistance(x, z, p.x, p.z) < TREE_MIN_SPACING * TREE_MIN_SPACING,
    );
    if (tooClose) {
      continue;
    }

    positions.push({ x, z });
  }

  return positions;
}

function placeTree(world: World, center: TreePlacement): void {
  const trunkBaseY = GROUND_SURFACE_Y + 1;
  const trunkTopY = trunkBaseY + TRUNK_HEIGHT - 1;

  for (let i = 0; i < TRUNK_HEIGHT; i++) {
    world.setBlock(center.x, trunkBaseY + i, center.z, BlockType.Wood);
  }

  // Canopy layer 1: 3x3 at the trunk's top, leaving the trunk block itself.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(
        center.x + dx,
        trunkTopY,
        center.z + dz,
        BlockType.Leaves,
      );
    }
  }

  // Canopy layer 2: full 3x3 one voxel above the trunk top.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      world.setBlock(
        center.x + dx,
        trunkTopY + 1,
        center.z + dz,
        BlockType.Leaves,
      );
    }
  }
}

/**
 * Generate the flat 48x48 test map: stone (y0-2), dirt (y3), grass (y4),
 * plus 6-10 seeded trees placed off-spawn and min-spaced apart. Pure and
 * deterministic — the same `config.seed` always yields a byte-identical
 * world.
 */
export function generateWorld(config: GenerateWorldConfig): GeneratedWorld {
  const size = config.size ?? DEFAULT_WORLD_SIZE;
  const spawn = { x: Math.floor(size / 2), z: Math.floor(size / 2) };

  const rng = createRng(config.seed);
  const world = new World();

  generateTerrain(world, size);

  const trees = pickTreePositions(rng, size, spawn);
  for (const tree of trees) {
    placeTree(world, tree);
  }

  return { world, trees, size, spawn };
}
