"use client";

/**
 * Composition root for #6: builds the seeded static world and renders every
 * loaded chunk as instanced geometry. Replaces the #5-era demo cube scene.
 *
 * Client-only per the threejs skill's Next.js integration guidance
 * (`references/react-three-fiber.md` → "Next.js integration") — `page.tsx`
 * loads this module via `next/dynamic` with `{ ssr: false }`, so it's safe
 * to touch `document`/canvas (via `createBlockAtlas`) and construct
 * `THREE.*` objects here at module-body/render time.
 */

import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";

import { createBlockAtlas } from "~/game/render/atlas";
import { ChunkMesh } from "~/game/render/chunk-mesh";
import { createLocalWorldStore } from "~/game/store/local-world-store";
import { generateWorld } from "~/game/worldgen";

/** Fixed seed — the acceptance bar is "identical every load," not variety. */
const WORLD_CONFIG = { seed: "threejs-craft-static-world-v1" };

/**
 * Logs `gl.info.render.calls` once shortly after mount so the "~1 draw call
 * per chunk" perf guard (threejs skill → `references/performance.md`) can be
 * spot-checked via the devtools console without a permanent on-screen HUD.
 */
function DrawCallProbe() {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const id = window.setTimeout(() => {
      console.info(
        "[game-scene] gl.info.render.calls =",
        gl.info.render.calls,
      );
    }, 300);
    return () => window.clearTimeout(id);
  }, [gl]);

  return null;
}

export default function GameScene() {
  // Built once per mount: the world itself (pure/deterministic) and the
  // procedural atlas texture (canvas-backed — must stay client-only).
  const store = useMemo(
    () => createLocalWorldStore(generateWorld(WORLD_CONFIG)),
    [],
  );
  const atlas = useMemo(() => createBlockAtlas(), []);
  useEffect(() => () => atlas.texture.dispose(), [atlas]);

  const { size, spawn } = store.generated;
  const chunkEntries = store.source.chunkEntries();

  // Frame the whole 48x48 footprint from a 3/4 elevated angle, centered
  // near spawn — well inside the camera's far plane at this world scale.
  const cameraPosition: [number, number, number] = [
    spawn.x - size * 0.15,
    size * 0.9,
    spawn.z + size * 1.35,
  ];
  const controlsTarget: [number, number, number] = [spawn.x, 4, spawn.z];

  return (
    <Canvas
      camera={{ position: cameraPosition, fov: 50, near: 0.1, far: 2000 }}
      shadows
      dpr={[1, 2]}
      // Set touch-action once at setup so touch drags orbit instead of
      // scrolling the page (callback param, not an effect mutating gl.domElement).
      onCreated={({ gl }) => {
        gl.domElement.style.touchAction = "none";
      }}
    >
      <DrawCallProbe />

      <hemisphereLight args={["#bfd4ff", "#1a1a2e", 0.7]} />
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[size * 0.6, size, size * 0.3]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      {chunkEntries.map(({ chunk, origin }) => (
        <ChunkMesh
          key={`${origin.x},${origin.y},${origin.z}`}
          chunk={chunk}
          origin={origin}
          atlas={atlas}
        />
      ))}

      <OrbitControls target={controlsTarget} makeDefault />
    </Canvas>
  );
}
