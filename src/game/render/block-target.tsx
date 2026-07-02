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
 * chunk renderer registered with `instance-picking.ts`'s typed WeakMap-backed
 * picking contract (`chunk-mesh.tsx`'s `attachInstancePicking`, #6/#16).
 * `intersection.instanceId` resolves back to the hit instance's world-space
 * block coordinate via `readInstanceCoord` (`references/interaction.md` →
 * "Reading an intersection result": "`hit.instanceId` — set when
 * `hit.object` is an `InstancedMesh`").
 *
 * **Wireframe outline**: a single reused `LineSegments` + `EdgesGeometry`
 * of a unit box (`references/geometry.md`'s `EdgesGeometry` pattern,
 * confirmed via `scripts/docs_lookup.mjs EdgesGeometry`), repositioned and
 * shown/hidden imperatively every frame — never through React state, so
 * this preserves #7's zero-setState-per-frame property.
 *
 * **#9 face normal for placement**: three@0.185.1's `Mesh.raycast` computes
 * `intersection.face.normal` from the untransformed geometry vertices (see
 * `node_modules/three/src/objects/Mesh.js`'s `checkGeometryIntersection` —
 * verified by reading the pinned version's source directly rather than
 * assuming, per the threejs skill) — i.e. object/geometry space, *not*
 * auto-transformed to world space. Normally that would need a
 * `transformDirection(matrixWorld)` step. This scene's transform chain from
 * geometry to world is translation-only (the chunk `<group>` in
 * `chunk-mesh.tsx` only sets `position`, and every instance matrix written
 * by `setMatrixAt` there is built from a scratch `Object3D` with no
 * rotation/scale applied) — a pure translation never changes a direction
 * vector, so `intersection.face.normal` already equals the world-space face
 * normal here and needs no further transform. `Math.round` below only
 * guards against float noise on an otherwise-exact ±1/0/0 component.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { DEFAULT_REACH, type Vec3 } from "~/game/command";
import { EYE_HEIGHT } from "~/game/player/step-player";
import {
  isPickableInstancedMesh,
  readInstanceCoord,
} from "~/game/render/instance-picking";
import type { WorldStore } from "~/game/store/world-store";

/** Reused every frame — screen-center NDC never changes. */
const NDC_CENTER = new THREE.Vector2(0, 0);

/** `event.code` -> hotbar slot index, for number-key selection (1-6 -> 0..5). */
const DIGIT_TO_SLOT: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
  Digit6: 5,
};

/** Slightly larger than a unit block so the outline doesn't z-fight with
 *  the targeted block's own faces. */
const OUTLINE_SCALE = 1.002;

export interface BlockTargetingProps {
  readonly store: WorldStore;
}

/** Renders nothing visible on its own besides the outline — the crosshair
 *  is a DOM overlay (`crosshair-overlay.tsx`) rendered outside `<Canvas>`. */
export function BlockTargeting({ store }: BlockTargetingProps) {
  const { camera, scene, raycaster, gl } = useThree();

  const outlineRef = useRef<THREE.LineSegments>(null);
  /** The current in-reach target (the targeted block itself — what
   *  `BreakBlock` acts on), written every frame by `useFrame` and read by
   *  the click handler — a ref, not React state, per #7's
   *  zero-per-frame-setState rule. */
  const targetRef = useRef<Vec3 | null>(null);
  /** The cell adjacent to the targeted face (`target + faceNormal`) — what
   *  `PlaceBlock` acts on. `null` whenever `targetRef` is (no target) or the
   *  hit carried no usable face normal. */
  const placeAtRef = useRef<Vec3 | null>(null);
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
    let placeAt: Vec3 | null = null;
    if (hit && hit.distance <= DEFAULT_REACH && hit.instanceId !== undefined) {
      const coord = readInstanceCoord(
        hit.object as THREE.InstancedMesh,
        hit.instanceId,
      );
      if (coord) {
        target = coord.world;
        const normal = hit.face?.normal;
        if (normal) {
          // See the file-level comment: object-space normal already equals
          // world-space here (translation-only transform chain), so no
          // `transformDirection` is needed — just snap to the nearest axis.
          placeAt = {
            x: target.x + Math.round(normal.x),
            y: target.y + Math.round(normal.y),
            z: target.z + Math.round(normal.z),
          };
        }
      }
    }
    targetRef.current = target;
    placeAtRef.current = placeAt;

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
      if (document.pointerLockElement !== canvas) return; // only while locked

      const eyePosition: Vec3 = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      };

      if (event.button === 0) {
        // Left click: break the targeted block.
        const at = targetRef.current;
        if (!at) return;
        store.apply({ type: "BreakBlock", at }, eyePosition);
        return;
      }

      if (event.button === 2) {
        // Right click: place the selected hotbar block onto the targeted
        // face's adjacent cell. No-op (not even an `apply()` call) when
        // there's no target/face or the selected slot is already empty —
        // `canPlace`'s `NotInInventory` still covers this path for any
        // caller that *does* invoke `apply` with a stale selection.
        const at = placeAtRef.current;
        if (!at) return;
        const selected = store.getInventorySnapshot();
        const slot = selected.slots[selected.selected];
        if (!slot?.block) return;

        // Reach/`from` stays the eye position (matches BreakBlock's reach
        // gating); `playerPosition` is the feet position `canPlace` needs
        // for its player-clip AABB check, recovered from the eye position
        // by subtracting `EYE_HEIGHT` (the inverse of how
        // `player-controller.tsx` places the camera).
        const playerPosition: Vec3 = {
          x: eyePosition.x,
          y: eyePosition.y - EYE_HEIGHT,
          z: eyePosition.z,
        };
        store.apply(
          { type: "PlaceBlock", at, block: slot.block },
          eyePosition,
          DEFAULT_REACH,
          playerPosition,
        );
      }
    };

    // Right-click is a real game action (placement) here, not a browser
    // context menu — suppress it globally while this component is mounted.
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("contextmenu", handleContextMenu);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [gl, camera, store]);

  useEffect(() => {
    const canvas = gl.domElement;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.pointerLockElement !== canvas) return; // only while locked
      const slot = DIGIT_TO_SLOT[event.code];
      if (slot === undefined) return;
      store.selectSlot(slot);
    };

    const handleWheel = (event: WheelEvent) => {
      if (document.pointerLockElement !== canvas) return; // only while locked
      event.preventDefault();
      store.cycleSelection(event.deltaY);
    };

    window.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [gl, store]);

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
