/**
 * Pure, deterministic selection of the rare "cat-face grass" cosmetic
 * variant (#11): ~1/40 grass blocks get a cat face on their top face
 * instead of the plain `grass_top` tile. This is a render-layer-only
 * decision — it never influences which blocks are solid, drop, or place
 * (that stays whatever `blocks.ts`/`command.ts` say `Grass` is); it only
 * decides which of two `InstancedMesh`es (`chunk-mesh.tsx`) a given Grass
 * instance's box lands in.
 *
 * Deterministic and *not* session-random: hashes the block's absolute world
 * coordinate through the same xmur3 -> mulberry32 pipeline `rng.ts` uses for
 * worldgen (not `Math.random`), so the same coordinate always gets the same
 * answer, on every load, forever — no seed carried in from the caller, no
 * ambient state.
 */

import { createRng } from "~/game/rng";
import type { ChunkInstance, Coord3 } from "~/game/render/chunk-instances";

/** Target rate of grass blocks that get the cat-face variant. */
export const CAT_GRASS_RATE = 1 / 40;

/**
 * Deterministic per-coordinate pick: the same world coordinate always
 * returns the same answer, across calls and across process/page loads.
 */
export function isCatGrass(world: Coord3): boolean {
  const rng = createRng(`cat-grass:${world.x},${world.y},${world.z}`);
  return rng() < CAT_GRASS_RATE;
}

export interface CatGrassSplit {
  readonly normal: readonly ChunkInstance[];
  readonly catGrass: readonly ChunkInstance[];
}

/**
 * Partitions a group of Grass instances into the "plain grass_top" bucket
 * and the "cat-face grass_top" bucket, reindexing each bucket's `index` to
 * a dense 0-based sequence. Reindexing is required: each bucket becomes its
 * own `InstancedMesh` in `chunk-mesh.tsx`, and `setMatrixAt`/
 * `instanceToCoord` both index from 0 within *that mesh's own* instance
 * buffer, not the original combined group.
 *
 * Callers are expected to only pass instances that are already known to be
 * Grass (`chunk-mesh.tsx` filters by `blockType` before calling this) —
 * `isCatGrass` itself doesn't know or care about block type, since the
 * variant is purely a function of world coordinate.
 */
export function splitCatGrassInstances(
  instances: readonly ChunkInstance[],
): CatGrassSplit {
  const normal: ChunkInstance[] = [];
  const catGrass: ChunkInstance[] = [];

  for (const instance of instances) {
    const bucket = isCatGrass(instance.world) ? catGrass : normal;
    bucket.push({ ...instance, index: bucket.length });
  }

  return { normal, catGrass };
}
