"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type ReactNode } from "react";
import type { Group } from "three";

/**
 * Drag-to-rotate the primitive.
 *
 * We attach native pointer listeners to the canvas element (via useThree().gl)
 * rather than using r3f's per-object onPointer* events, for two reasons:
 *   1. A drag should keep rotating even when the cursor leaves the cube — mesh
 *      onPointerMove stops firing once the pointer is off the mesh.
 *   2. It avoids r3f's version-sensitive pointer-capture surface (the threejs
 *      skill flags TSL/r3f event internals as things to not guess at).
 * See .claude/skills/threejs/references/interaction.md for the pointer/NDC
 * fundamentals this builds on.
 */
function DragToRotate({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  // Target rotation the drag writes to; useFrame eases the group toward it.
  const target = useRef({ x: 0.35, y: 0.6 });
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      // Horizontal drag → yaw (Y), vertical drag → pitch (X).
      target.current.y += (e.clientX - lastX) * 0.01;
      target.current.x += (e.clientY - lastY) * 0.01;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [gl]);

  // useFrame IS the render loop in r3f (invariant 4 handled for us). Ease toward
  // the drag target so motion feels smooth instead of 1:1 jumpy.
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.rotation.x += (target.current.x - g.rotation.x) * 0.15;
    g.rotation.y += (target.current.y - g.rotation.y) * 0.15;
  });

  return <group ref={group}>{children}</group>;
}

export default function GameScene() {
  return (
    <Canvas
      camera={{ position: [3, 2, 4], fov: 50 }}
      shadows
      dpr={[1, 2]}
      // Set touch-action once at setup so touch drags rotate instead of scrolling
      // the page. Done here (callback param, not a hook value) rather than mutating
      // gl.domElement in an effect, which the react-hooks immutability rule forbids.
      onCreated={({ gl }) => {
        gl.domElement.style.touchAction = "none";
      }}
    >
      {/* Lights only — no external HDRI fetch so the route works offline. For
          image-based lighting, add <Suspense><Environment preset="city" /></Suspense>
          from @react-three/drei (see references/lighting-and-env.md). */}
      <hemisphereLight args={["#bfd4ff", "#1a1a2e", 0.6]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[5, 6, 4]}
        intensity={2.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      <DragToRotate>
        <mesh castShadow>
          <boxGeometry args={[1.5, 1.5, 1.5]} />
          <meshStandardMaterial color="#5b8def" roughness={0.35} metalness={0.1} />
        </mesh>
      </DragToRotate>

      {/* Ground plane to catch the shadow and give the cube a sense of place. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#12122a" />
      </mesh>
    </Canvas>
  );
}
