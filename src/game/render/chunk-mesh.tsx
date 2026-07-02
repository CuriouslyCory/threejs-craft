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
 * This component is a thin Three.js adapter over `render-plan.ts`'s pure
 * `buildRenderPlan`: it resolves each plan group's renderer-free geometry
 * spec to a cached `THREE.BoxGeometry`, writes per-instance matrices, and
 * attaches the typed instance-id -> block coord picking contract via
 * `instance-picking.ts`'s `attachInstancePicking` (no `userData`). The
 * cat-grass split (#11), block-type grouping, and coord-map construction all
 * live in `render-plan.ts` now — this file owns only geometry/material
 * caching and Three object lifecycle.
 *
 * Per-instance matrices are written in `useLayoutEffect` (before paint, so
 * there's no flash of unpositioned instances) via the scratch-`Object3D` +
 * `setMatrixAt` + `instanceMatrix.needsUpdate = true` pattern from
 * `references/geometry.md` → "Instancing — InstancedMesh".
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { Chunk } from "~/game/chunk";
import type { BlockAtlas } from "~/game/render/atlas";
import { tileRect, type BoxFaceTiles } from "~/game/render/atlas-layout";
import { remapBoxUV } from "~/game/render/box-uv";
import { attachInstancePicking } from "~/game/render/instance-picking";
import {
  buildRenderPlan,
  type Coord3,
  type RenderGeometrySpec,
  type RenderPlanGroup,
} from "~/game/render/render-plan";

// Geometry only depends on the plan's geometry spec (the atlas UV mapping is
// fixed per spec, not per chunk/position), so every chunk's InstancedMesh
// for a given geometry identity shares the same geometry object instead of
// rebuilding it. App-lifetime cache — fine for this static single-world
// MVP; a future hot-swappable-atlas feature would need to invalidate it.
const geometryCache = new Map<string, THREE.BoxGeometry>();

/** Build a fresh unit `BoxGeometry` whose per-face UVs sample `faceTiles`'s
 *  atlas rectangles (`box-uv.ts`'s per-face remap). */
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

/** Resolve a plan group's renderer-free geometry spec to a cached, shared
 *  `THREE.BoxGeometry` — built once per `spec.key`, reused across chunks. */
function resolveGeometry(spec: RenderGeometrySpec): THREE.BoxGeometry {
  const cached = geometryCache.get(spec.key);
  if (cached) return cached;

  const geometry = buildFaceMappedGeometry(spec.faceTiles);
  geometryCache.set(spec.key, geometry);
  return geometry;
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

interface PlanGroupMeshProps {
  readonly group: RenderPlanGroup;
  readonly geometry: THREE.BoxGeometry;
  readonly material: THREE.Material;
}

function PlanGroupMesh({ group, geometry, material }: PlanGroupMeshProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();

    for (const instance of group.instances) {
      dummy.position.set(
        instance.local.x + 0.5,
        instance.local.y + 0.5,
        instance.local.z + 0.5,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(instance.index, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    attachInstancePicking(mesh, group.instanceToCoord); // typed; no userData
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
   * **in place** by `WorldStore.apply` (see `command.ts`'s `World.setBlock`),
   * so its object identity never changes when a block breaks — `useMemo`
   * below would never see `chunk` as "different" without this. Callers pass
   * the chunk's `WorldChunkEntry.version` from `WorldStore.getSnapshot()`; bumping it is what
   * actually triggers `buildRenderPlan` to re-run for *this* chunk
   * only, which is the O(dirty chunks)-not-O(world) rebuild the render
   * layer requires. Defaults to 0 so #6's original (no dirty-tracking)
   * call sites keep working unchanged.
   */
  readonly version?: number;
}

/** One chunk's worth of instanced geometry, positioned at its world origin. */
export function ChunkMesh({ chunk, origin, atlas, version = 0 }: ChunkMeshProps) {
  const plan = useMemo(() => {
    // `version` is intentionally not read here — it exists purely so this
    // dep array busts the memo when `WorldStore` bumps it for this
    // chunk's key, since `chunk` mutates in place and never changes
    // identity on its own. The `void` keeps `react-hooks/exhaustive-deps`
    // (correctly) satisfied that every listed dep is deliberate, not a
    // request to disable/ignore the rule.
    void version;
    return buildRenderPlan(chunk, origin);
  }, [chunk, origin, version]);
  const material = getSharedMaterial(atlas);

  return (
    <group position={[origin.x, origin.y, origin.z]}>
      {plan.groups.map((group) => (
        <PlanGroupMesh
          key={group.key}
          group={group}
          geometry={resolveGeometry(group.geometry)}
          material={material}
        />
      ))}
    </group>
  );
}
