"use client";

/**
 * #8's targeting + breaking component: rendered as a child of `<Canvas>`
 * alongside `ChunkMesh`/`PlayerController`.
 *
 * **One per-frame raycast from screen center** (verified against the
 * threejs skill's `references/interaction.md` → "Raycaster basics" /
 * "Reading an intersection result"): `raycaster.setFromCamera(ndcCenter,
 * camera)` where `ndcCenter` is the reused `Vector2(0, 0)` below — NDC
 * (0,0) is dead screen-center, which is exactly the crosshair position.
 * This is a deliberate case of "manual `useThree().raycaster` for
 * mesh-target picking" (the interaction reference otherwise steers toward
 * r3f's built-in JSX pointer events for mesh picking) — pointer-lock mode
 * freezes `clientX`/`clientY` and only reports relative `movementX/Y`, so
 * there is no real DOM pointer position for r3f's automatic event system to
 * raycast from; a screen-center ray is the only thing that matches an FPS
 * crosshair while locked.
 *
 * **InstancedMesh → block coord**: candidates are every `InstancedMesh` the
 * chunk renderer tagged with `userData.instanceToCoord` (`chunk-mesh.tsx`,
 * #6). `intersection.instanceId` indexes that map to recover the hit
 * instance's world-space block coordinate (`references/interaction.md` →
 * "Reading an intersection result": "`hit.instanceId` — set when
 * `hit.object` is an `InstancedMesh`").
 *
 * **Wireframe outline**: a single reused `LineSegments` + `EdgesGeometry`
 * of a unit box (`references/geometry.md`'s `EdgesGeometry` pattern,
 * confirmed via `scripts/docs_lookup.mjs EdgesGeometry`), repositioned and
 * shown/hidden imperatively every frame — never through React state, so
 * this preserves #7's zero-setState-per-frame property.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { DEFAULT_REACH, type Vec3 } from "~/game/command";
import type { InstanceToCoordMap } from "~/game/render/chunk-mesh";
import type { GameStore } from "~/game/store/world-store";

/** Reused every frame — screen-center NDC never changes. */
const NDC_CENTER = new THREE.Vector2(0, 0);

/** An `InstancedMesh` tagged by `chunk-mesh.tsx` with the `userData` #8 needs
 *  to resolve a hit instance back to a world-space block coordinate. */
interface PickableInstancedMesh extends THREE.InstancedMesh {
  userData: THREE.InstancedMesh["userData"] & {
    instanceToCoord?: InstanceToCoordMap;
  };
}

function isPickableInstancedMesh(
  object: THREE.Object3D,
): object is PickableInstancedMesh {
  return (
    (object as Partial<THREE.InstancedMesh>).isInstancedMesh === true &&
    "instanceToCoord" in object.userData
  );
}

/** Slightly larger than a unit block so the outline doesn't z-fight with
 *  the targeted block's own faces. */
const OUTLINE_SCALE = 1.002;

export interface BlockTargetingProps {
  readonly store: GameStore;
}

/** Renders nothing visible on its own besides the outline — the crosshair
 *  is a DOM overlay (`crosshair-overlay.tsx`) rendered outside `<Canvas>`. */
export function BlockTargeting({ store }: BlockTargetingProps) {
  const { camera, scene, raycaster, gl } = useThree();

  const outlineRef = useRef<THREE.LineSegments>(null);
  /** The current in-reach target, written every frame by `useFrame` and
   *  read by the click handler — a ref, not React state, per #7's
   *  zero-per-frame-setState rule. */
  const targetRef = useRef<Vec3 | null>(null);
  /** Scratch array reused every frame instead of allocating a new one. */
  const candidatesRef = useRef<THREE.Object3D[]>([]);

  useFrame(() => {
    // Re-gathered every frame rather than cached across `apply()` calls:
    // the world here is small (a few dozen chunk/block-type InstancedMeshes
    // at most), so a full `scene.traverse` is cheap, and it sidesteps any
    // timing question about whether a just-applied dirty-chunk rebuild's
    // new InstancedMesh has already committed by the time this frame runs.
    const candidates = candidatesRef.current;
    candidates.length = 0;
    scene.traverse((object) => {
      if (isPickableInstancedMesh(object)) {
        candidates.push(object);
      }
    });

    raycaster.setFromCamera(NDC_CENTER, camera);
    const hits = raycaster.intersectObjects(candidates, false);
    const hit = hits[0];

    let target: Vec3 | null = null;
    if (hit && hit.distance <= DEFAULT_REACH && hit.instanceId !== undefined) {
      const mesh = hit.object as PickableInstancedMesh;
      const coord = mesh.userData.instanceToCoord?.get(hit.instanceId);
      if (coord) {
        target = coord.world;
      }
    }
    targetRef.current = target;

    const outline = outlineRef.current;
    if (!outline) return;
    if (target) {
      outline.visible = true;
      outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    } else {
      outline.visible = false;
    }
  });

  useEffect(() => {
    const canvas = gl.domElement;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return; // left click only
      if (document.pointerLockElement !== canvas) return; // only while locked
      const at = targetRef.current;
      if (!at) return;

      const from: Vec3 = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      };
      store.apply({ type: "BreakBlock", at }, from);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    return () => canvas.removeEventListener("pointerdown", handlePointerDown);
  }, [gl, camera, store]);

  const edgesGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(
      OUTLINE_SCALE,
      OUTLINE_SCALE,
      OUTLINE_SCALE,
    );
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, []);
  useEffect(() => () => edgesGeometry.dispose(), [edgesGeometry]);

  return (
    <lineSegments
      ref={outlineRef}
      geometry={edgesGeometry}
      visible={false}
      renderOrder={999}
    >
      <lineBasicMaterial color="black" toneMapped={false} />
    </lineSegments>
  );
}
