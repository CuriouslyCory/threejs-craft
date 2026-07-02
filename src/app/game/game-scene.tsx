"use client";

/**
 * Composition root for #6/#7: builds the seeded static world, renders every
 * loaded chunk as instanced geometry, and (#7) drops the player into it with
 * pointer-lock FPS controls — replacing the #6-era `OrbitControls` demo
 * camera with `PlayerController` + its lock-state HUD overlays.
 *
 * Client-only per the threejs skill's Next.js integration guidance
 * (`references/react-three-fiber.md` → "Next.js integration") — `page.tsx`
 * loads this module via `next/dynamic` with `{ ssr: false }`, so it's safe
 * to touch `document`/canvas (via `createBlockAtlas`) and construct
 * `THREE.*` objects here at module-body/render time.
 */

import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { EYE_HEIGHT } from "~/game/player/player-box";
import { createBlockAtlas } from "~/game/render/atlas";
import { BlockTargeting } from "~/game/render/block-target";
import { ChunkMesh } from "~/game/render/chunk-mesh";
import { ControlsLegend } from "~/game/render/controls-legend";
import { CrosshairOverlay } from "~/game/render/crosshair-overlay";
import { HotbarHud } from "~/game/render/hotbar-hud";
import { LockOverlay } from "~/game/render/lock-overlay";
import {
  PlayerController,
  type LockState,
  type PlayerControllerHandle,
} from "~/game/render/player-controller";
import { createWorldStore } from "~/game/store/world-store";
import { GROUND_SURFACE_Y, generateWorld } from "~/game/worldgen";

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
  // Built once per mount: the pure/deterministic generated world, the one
  // `WorldStore` (mutation + the versioned chunk snapshot), and the
  // procedural atlas texture (canvas-backed — must stay client-only).
  const generated = useMemo(() => generateWorld(WORLD_CONFIG), []);
  const store = useMemo(() => createWorldStore(generated.world), [generated]);
  const atlas = useMemo(() => createBlockAtlas(), []);
  useEffect(() => () => atlas.texture.dispose(), [atlas]);

  // The versioned snapshot IS the mounted chunk set: subscribing here is
  // what makes `apply()` (called from `BlockTargeting` on a break/place)
  // actually cause a React re-render, and — because chunk existence is part
  // of this same snapshot — a chunk first created by an edit enters
  // `entries` on the very next render, so its `ChunkMesh` mounts
  // immediately (this is a discrete, user-driven re-render, not a
  // per-frame one, so it doesn't regress #7's zero-setState-per-frame
  // rule).
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const { size, spawn } = generated;

  // Center the player in the spawn column's footprint (worldgen's `spawn`
  // is an integer voxel coordinate) and stand it on the grass top face.
  const spawnFeetY = GROUND_SURFACE_Y + 1;
  const spawnPosition = useMemo(
    () => ({ x: spawn.x + 0.5, y: spawnFeetY, z: spawn.z + 0.5 }),
    [spawn.x, spawn.z, spawnFeetY],
  );
  const cameraPosition: [number, number, number] = [
    spawnPosition.x,
    spawnFeetY + EYE_HEIGHT,
    spawnPosition.z,
  ];

  // Lock-state is the *only* React state in the whole navigate feature — it
  // changes on user-facing transitions (click, Esc, a lock denial), never
  // per frame. See `player-controller.tsx` for the zero-re-render guarantee.
  const [lockState, setLockState] = useState<LockState>("start");
  const controllerRef = useRef<PlayerControllerHandle>(null);

  const requestLock = useCallback(() => {
    controllerRef.current?.requestLock();
  }, []);
  const dismissDenied = useCallback(
    () => setLockState("start"),
    [setLockState],
  );

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: cameraPosition, fov: 70, near: 0.1, far: 2000 }}
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

        {entries.map((entry) => (
          <ChunkMesh
            key={entry.key}
            chunk={entry.chunk}
            origin={entry.origin}
            atlas={atlas}
            version={entry.version}
          />
        ))}

        <PlayerController
          ref={controllerRef}
          world={generated.world}
          spawn={spawnPosition}
          onLockStateChange={setLockState}
        />

        <BlockTargeting store={store} />
      </Canvas>

      <CrosshairOverlay visible={lockState === "playing"} />
      <HotbarHud store={store} />

      <LockOverlay
        state={lockState}
        onRequestLock={requestLock}
        onDismissDenied={dismissDenied}
      />
      <ControlsLegend />
    </div>
  );
}
