"use client";

/**
 * Renders one chunk's solid voxels as `THREE.InstancedMesh`es.
 *
 * A single `InstancedMesh` shares one geometry + material across every
 * instance it draws (verified against three@0.185.1's `InstancedMesh` docs
 * via `scripts/docs_lookup.mjs InstancedMesh` — instances vary transform/
 * color only, never per-instance geometry/UVs). Different block types need
 * different atlas UVs baked into the box geometry (grass: 3 distinct faces;
 * wood: 2; everything else: 1 — see `atlas-layout.ts`), so this component
 * renders **one `InstancedMesh` per (chunk, block type present in that
 * chunk)** rather than a single mesh per chunk. That's the intentional,
 * documented deviation from a literal "one mesh per chunk": getting genuine
 * per-instance texture variation into a single InstancedMesh would need a
 * custom per-instance atlas-tile attribute plus a hand-written shader
 * (`onBeforeCompile`), which the threejs skill's guidance is explicit about
 * not hand-waving — and #6's scope doesn't call for a custom shader. Draw
 * calls stay bounded by the (small, fixed) number of block types — at most
 * 5 per chunk, only when every type is present — which is still "roughly
 * one draw call per chunk" territory for this world's block-type variety,
 * and cheap regardless (a handful of chunks, a few thousand instances
 * total).
 *
 * Per-instance matrices are written in `useLayoutEffect` (before paint, so
 * there's no flash of unpositioned instances) via the scratch-`Object3D` +
 * `setMatrixAt` + `instanceMatrix.needsUpdate = true` pattern from
 * `references/geometry.md` → "Instancing — InstancedMesh". Each mesh also
 * gets `mesh.userData.instanceToCoord`, a `Map<instanceId, { local, world
 * }>` — the "instanceId -> block coord" deliverable #8's picking needs.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { BlockType, type BlockTypeId } from "~/game/blocks";
import type { Chunk } from "~/game/chunk";
import type { BlockAtlas } from "~/game/render/atlas";
import {
  getBlockFaceTiles,
  getCatGrassFaceTiles,
  tileRect,
  type BoxFaceTiles,
} from "~/game/render/atlas-layout";
import { remapBoxUV } from "~/game/render/box-uv";
import { splitCatGrassInstances } from "~/game/render/cat-grass";
import {
  computeChunkInstances,
  type ChunkInstance,
  type ChunkInstanceGroup,
  type Coord3,
} from "~/game/render/chunk-instances";

/** `instanceId -> block coord`, exposed on each mesh's `userData` for #8 picking. */
export interface InstanceCoord {
  readonly local: Coord3;
  readonly world: Coord3;
}
export type InstanceToCoordMap = ReadonlyMap<number, InstanceCoord>;

// Geometry only depends on block type (the atlas UV mapping is fixed per
// type, not per chunk/position), so every chunk's InstancedMesh for a given
// block type shares the same geometry object instead of rebuilding it.
// App-lifetime cache — fine for this static single-world MVP; a future
// hot-swappable-atlas feature would need to invalidate it.
const geometryCache = new Map<BlockTypeId, THREE.BoxGeometry>();

/** Build a fresh unit `BoxGeometry` whose per-face UVs sample `faceTiles`'s
 *  atlas rectangles (`box-uv.ts`'s per-face remap). Shared by both the
 *  per-block-type cache below and #11's cat-grass variant, which needs a
 *  geometry keyed by "Grass, but a different top tile" rather than by
 *  `BlockTypeId` alone. */
function buildFaceMappedGeometry(faceTiles: BoxFaceTiles): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const uvAttribute = geometry.attributes.uv;
  if (!uvAttribute) {
    throw new Error("BoxGeometry built without a uv attribute");
  }
  const baseUV = Array.from(uvAttribute.array);
  const remapped = remapBoxUV(baseUV, {
    top: tileRect(faceTiles.top),
    bottom: tileRect(faceTiles.bottom),
    px: tileRect(faceTiles.px),
    nx: tileRect(faceTiles.nx),
    pz: tileRect(faceTiles.pz),
    nz: tileRect(faceTiles.nz),
  });
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(remapped, 2));
  return geometry;
}

function getBlockGeometry(blockType: BlockTypeId): THREE.BoxGeometry {
  const cached = geometryCache.get(blockType);
  if (cached) return cached;

  const geometry = buildFaceMappedGeometry(getBlockFaceTiles(blockType));
  geometryCache.set(blockType, geometry);
  return geometry;
}

// Single shared geometry for the cat-grass variant — same cache-lazily
// pattern as `geometryCache`/`sharedMaterial` below, keyed separately since
// it isn't addressable by `BlockTypeId` (it's still `BlockType.Grass`, just
// with a different top-face tile).
let catGrassGeometry: THREE.BoxGeometry | undefined;

function getCatGrassGeometry(): THREE.BoxGeometry {
  catGrassGeometry ??= buildFaceMappedGeometry(getCatGrassFaceTiles());
  return catGrassGeometry;
}

// One shared material for the whole app: same atlas texture, same shading,
// regardless of chunk or block type (per-face variation lives in the
// geometry's UVs, not the material). Built lazily so the canvas-backed
// atlas texture is only ever touched client-side.
let sharedMaterial: THREE.MeshStandardMaterial | undefined;

function getSharedMaterial(atlas: BlockAtlas): THREE.MeshStandardMaterial {
  sharedMaterial ??= new THREE.MeshStandardMaterial({
    map: atlas.texture,
    roughness: 1,
    metalness: 0,
  });
  return sharedMaterial;
}

interface BlockTypeInstancesProps {
  readonly group: ChunkInstanceGroup;
  readonly geometry: THREE.BoxGeometry;
  readonly material: THREE.Material;
}

function BlockTypeInstances({
  group,
  geometry,
  material,
}: BlockTypeInstancesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    const instanceToCoord = new Map<number, InstanceCoord>();

    for (const instance of group.instances) {
      dummy.position.set(
        instance.local.x + 0.5,
        instance.local.y + 0.5,
        instance.local.z + 0.5,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(instance.index, dummy.matrix);
      instanceToCoord.set(instance.index, {
        local: instance.local,
        world: instance.world,
      });
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.instanceToCoord = instanceToCoord as InstanceToCoordMap;
    mesh.userData.blockType = group.blockType;
  }, [group]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, group.instances.length]}
      castShadow
      receiveShadow
    />
  );
}

export interface ChunkMeshProps {
  readonly chunk: Chunk;
  /** World-space coordinate of this chunk's local (0,0,0) voxel. */
  readonly origin: Coord3;
  readonly atlas: BlockAtlas;
  /**
   * #8's dirty-chunk signal: `chunk` (a `Chunk` instance) is mutated
   * **in place** by `GameStore.apply` (see `command.ts`'s `World.setBlock`),
   * so its object identity never changes when a block breaks — `useMemo`
   * below would never see `chunk` as "different" without this. Callers pass
   * `store.getChunkVersion(key)` for this chunk's key; bumping it is what
   * actually triggers `computeChunkInstances` to re-run for *this* chunk
   * only, which is the O(dirty chunks)-not-O(world) rebuild the render
   * layer requires. Defaults to 0 so #6's original (no dirty-tracking)
   * call sites keep working unchanged.
   */
  readonly version?: number;
}

/** One `InstancedMesh`'s worth of data, already resolved to its final
 *  geometry — the output of splitting #11's cat-grass variant out of the
 *  plain per-block-type groups `computeChunkInstances` returns. */
interface RenderGroup {
  /** Unique within one `ChunkMesh` — `group.blockType` for ordinary groups,
   *  suffixed for the cat-grass split of a Grass group. */
  readonly key: string;
  readonly blockType: BlockTypeId;
  readonly instances: readonly ChunkInstance[];
  readonly geometry: THREE.BoxGeometry;
}

/**
 * Expands `computeChunkInstances`'s per-block-type groups into render
 * groups, splitting `BlockType.Grass` into its "plain grass_top" and
 * "cat-face grass_top" (#11) buckets via `splitCatGrassInstances`. Every
 * other block type passes through unchanged. Groups/buckets with zero
 * instances are dropped so an empty `InstancedMesh` is never mounted.
 */
function buildRenderGroups(
  groups: readonly ChunkInstanceGroup[],
): RenderGroup[] {
  const result: RenderGroup[] = [];

  for (const group of groups) {
    if (group.blockType !== BlockType.Grass) {
      if (group.instances.length === 0) continue;
      result.push({
        key: String(group.blockType),
        blockType: group.blockType,
        instances: group.instances,
        geometry: getBlockGeometry(group.blockType),
      });
      continue;
    }

    const { normal, catGrass } = splitCatGrassInstances(group.instances);
    if (normal.length > 0) {
      result.push({
        key: String(group.blockType),
        blockType: group.blockType,
        instances: normal,
        geometry: getBlockGeometry(group.blockType),
      });
    }
    if (catGrass.length > 0) {
      result.push({
        key: `${group.blockType}-cat`,
        blockType: group.blockType,
        instances: catGrass,
        geometry: getCatGrassGeometry(),
      });
    }
  }

  return result;
}

/** One chunk's worth of instanced geometry, positioned at its world origin. */
export function ChunkMesh({ chunk, origin, atlas, version = 0 }: ChunkMeshProps) {
  const renderGroups = useMemo(() => {
    // `version` is intentionally not read here — it exists purely so this
    // dep array busts the memo when #8's `GameStore` bumps it for this
    // chunk's key, since `chunk` mutates in place and never changes
    // identity on its own. The `void` keeps `react-hooks/exhaustive-deps`
    // (correctly) satisfied that every listed dep is deliberate, not a
    // request to disable/ignore the rule.
    void version;
    return buildRenderGroups(computeChunkInstances(chunk, origin));
  }, [chunk, origin, version]);
  const material = getSharedMaterial(atlas);

  return (
    <group position={[origin.x, origin.y, origin.z]}>
      {renderGroups.map((renderGroup) => (
        <BlockTypeInstances
          key={renderGroup.key}
          group={{
            blockType: renderGroup.blockType,
            instances: renderGroup.instances,
          }}
          geometry={renderGroup.geometry}
          material={material}
        />
      ))}
    </group>
  );
}
