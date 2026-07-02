/**
 * Typed transport for the instance-id -> block coord picking contract
 * (`render-plan.ts`'s `InstanceCoordLookup`). Replaces the old
 * `userData.instanceToCoord` convention: `ChunkMesh` binds a mesh's lookup
 * here; block targeting reads it back with full types and no `userData`
 * sniffing. A WeakMap keyed by the mesh means bindings are dropped
 * automatically when a mesh unmounts / is rebuilt.
 */

import type * as THREE from "three";

import type { InstanceCoord, InstanceCoordLookup } from "~/game/render/render-plan";

const pickingByMesh = new WeakMap<THREE.InstancedMesh, InstanceCoordLookup>();

/** Called by the mesh adapter after it writes matrices. */
export function attachInstancePicking(
  mesh: THREE.InstancedMesh,
  lookup: InstanceCoordLookup,
): void {
  pickingByMesh.set(mesh, lookup);
}

/** Candidate filter for block targeting — an InstancedMesh this module owns. */
export function isPickableInstancedMesh(
  object: THREE.Object3D,
): object is THREE.InstancedMesh {
  return (
    (object as Partial<THREE.InstancedMesh>).isInstancedMesh === true &&
    pickingByMesh.has(object as THREE.InstancedMesh)
  );
}

/** Resolve a hit instance id back to its world/local block coord. */
export function readInstanceCoord(
  mesh: THREE.InstancedMesh,
  instanceId: number,
): InstanceCoord | undefined {
  return pickingByMesh.get(mesh)?.get(instanceId);
}
