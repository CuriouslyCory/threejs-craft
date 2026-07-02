/**
 * Pure render plan for one chunk: chunk + origin -> material-grouped instances,
 * each group carrying its geometry identity, its ordered instances, and a typed
 * instance-id -> coord map. No `three` import -> unit-testable without a
 * renderer or DOM. The rare cat-face grass split (#11) is an internal detail
 * here; `chunk-mesh.tsx` only writes matrices for whatever groups this returns.
 * This is the seam a later issue's face culling / greedy meshing lands behind.
 */

import { BlockType, type BlockTypeId } from "~/game/blocks";
import type { Chunk } from "~/game/chunk";
import {
  getBlockFaceTiles,
  getCatGrassFaceTiles,
  type BoxFaceTiles,
} from "~/game/render/atlas-layout";
import { splitCatGrassInstances } from "~/game/render/cat-grass";
import {
  computeChunkInstances,
  type ChunkInstance,
  type Coord3,
} from "~/game/render/chunk-instances";

export type { Coord3 }; // re-export so consumers need one import site

/** One instance's transform source + its dense 0-based InstancedMesh slot. */
export type PlanInstance = ChunkInstance; // { index, local, world }

/** THE typed instance-id -> block coord picking contract (was InstanceCoord in
 *  chunk-mesh.tsx). Shared by this module and block targeting via instance-picking.ts. */
export interface InstanceCoord {
  readonly local: Coord3;
  readonly world: Coord3;
}
export type InstanceCoordLookup = ReadonlyMap<number, InstanceCoord>;

/** Renderer-free geometry identity: a stable cache key + the per-face atlas
 *  tiles `chunk-mesh.tsx` bakes into a shared BoxGeometry's UVs. */
export interface RenderGeometrySpec {
  readonly key: string;
  readonly faceTiles: BoxFaceTiles;
}

/** One InstancedMesh's worth of plan. */
export interface RenderPlanGroup {
  readonly key: string; // unique within a plan (React/mesh key)
  readonly blockType: BlockTypeId;
  readonly geometry: RenderGeometrySpec;
  readonly instances: readonly PlanInstance[];
  readonly instanceToCoord: InstanceCoordLookup;
}

export interface RenderPlan {
  readonly groups: readonly RenderPlanGroup[];
}

function toGroup(
  key: string,
  blockType: BlockTypeId,
  faceTiles: BoxFaceTiles,
  instances: readonly ChunkInstance[],
): RenderPlanGroup {
  const instanceToCoord = new Map<number, InstanceCoord>();
  for (const i of instances) {
    instanceToCoord.set(i.index, { local: i.local, world: i.world });
  }
  return { key, blockType, geometry: { key, faceTiles }, instances, instanceToCoord };
}

/**
 * Pure: chunk + origin -> complete render plan. Group order and per-instance
 * indices are IDENTICAL to the old `buildRenderGroups(computeChunkInstances(...))`
 * path (visual output unchanged). Grass is split into plain / cat-face buckets
 * internally; zero-instance buckets are dropped so no empty mesh is mounted.
 */
export function buildRenderPlan(chunk: Chunk, origin: Coord3): RenderPlan {
  const groups: RenderPlanGroup[] = [];

  for (const group of computeChunkInstances(chunk, origin)) {
    if (group.blockType !== BlockType.Grass) {
      if (group.instances.length === 0) continue;
      groups.push(
        toGroup(
          String(group.blockType),
          group.blockType,
          getBlockFaceTiles(group.blockType),
          group.instances,
        ),
      );
      continue;
    }

    const { normal, catGrass } = splitCatGrassInstances(group.instances);
    if (normal.length > 0) {
      groups.push(
        toGroup(String(group.blockType), group.blockType, getBlockFaceTiles(BlockType.Grass), normal),
      );
    }
    if (catGrass.length > 0) {
      groups.push(
        toGroup(`${group.blockType}-cat`, group.blockType, getCatGrassFaceTiles(), catGrass),
      );
    }
  }

  return { groups };
}
