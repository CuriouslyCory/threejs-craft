"use client";

/**
 * Composition root for #6/#7/#20: builds the world, renders every loaded
 * chunk as instanced geometry, and drops the player into it with
 * pointer-lock FPS controls.
 *
 * Client-only per the threejs skill's Next.js integration guidance
 * (`references/react-three-fiber.md` → "Next.js integration") — `page.tsx`
 * loads this module via `next/dynamic` with `{ ssr: false }`, so it's safe
 * to touch `document`/canvas (via `createBlockAtlas`) and construct
 * `THREE.*` objects here at module-body/render time.
 *
 * #20 splits this file into an outer/inner pair, gated on `api.world.load`
 * (auth is detected purely by that query erroring `UNAUTHORIZED` — a
 * play-first soft gate, `/game` is never redirected):
 *
 * - **`GameScene` (outer, this component)** is stable across a future New
 *   Game (#21): it owns the canvas-backed block atlas (must NOT churn on
 *   reseed — texture rebuilds are expensive and pointless), the
 *   `world.load` query, the `hydrated` state (`{worldId, seed, deltas}`)
 *   that names the active signed-in session, and the one `PersistQueue` for
 *   the whole play session. It renders one of: a loading placeholder, a
 *   surfaced error, the **signed-out ephemeral** `WorldSession` (literal
 *   seed, no persistence), or the **signed-in** `WorldSession`
 *   (server-owned `{worldId, seed, deltas}`, edits streamed through the
 *   queue).
 * - **`WorldSession` (inner)**, keyed by `hydrated.worldId` (or the
 *   constant `"ephemeral"` key signed-out) so a future New Game can force a
 *   full remount by changing that key, builds the actual per-mount play
 *   session: `generateWorld({seed}).world` hydrated with
 *   `applyStoredDeltas` *before* `createWorldStore(world, undefined,
 *   onCommit)`, then every per-mount scene body piece (spawn, camera,
 *   `useSyncExternalStore`, controls, targeting, HUD) that used to live
 *   directly in this file.
 *
 * Shared-surface note for #21 (pause menu, not implemented here): the outer
 * component's `setHydrated` setter (bump `{worldId, seed, deltas: []}` to
 * force `WorldSession` to remount after `newGame.mutateAsync()`) and
 * `queue` (`enqueue`/`flush`/`pendingCount`/`lastError`) are the seam it
 * needs for Save (`queue.flush()` + `status.fetch()`) and New Game.
 */

import { Canvas, useThree } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { Command } from "~/game/command";
import type { ChunkKey } from "~/game/coords";
import { EYE_HEIGHT } from "~/game/player/player-box";
import { base64ToBytes } from "~/game/persistence/base64";
import { createPersistQueue } from "~/game/persistence/persist-queue";
import {
  applyStoredDeltas,
  type ChunkDeltaRecord,
} from "~/game/persistence/world-delta";
import { createBlockAtlas, type BlockAtlas } from "~/game/render/atlas";
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
import { api } from "~/trpc/react";

/** The signed-out ephemeral world's fixed seed — the acceptance bar there
 *  is "identical every load, no persistence," not variety. This is now the
 *  ONLY seed literal in the client: a signed-in player's seed comes from
 *  the server (`world.load`), one per account, and survives reload via
 *  stored deltas. */
const EPHEMERAL_SEED = "threejs-craft-static-world-v1";

/** Stable empty-deltas reference for the signed-out ephemeral session. The
 *  `"ephemeral"` `WorldSession` instance persists across outer re-renders
 *  (e.g. a react-query background refetch that re-confirms `UNAUTHORIZED`),
 *  and `WorldSession` builds its world in `useMemo([seed, deltas])` — so a
 *  fresh inline `[]` each render would rebuild the world and wipe the
 *  player's ephemeral edits. Hoisting it keeps the reference identity-stable. */
const EMPTY_DELTAS: readonly ChunkDeltaRecord[] = [];

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

function StatusScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center gap-2 text-white/70">
      {children}
    </div>
  );
}

interface WorldSessionProps {
  /** Worldgen seed for this session — the literal `EPHEMERAL_SEED`
   *  signed-out, or the server-owned seed signed-in. */
  readonly seed: string;
  /** Stored edit deltas to hydrate onto the freshly generated world before
   *  play starts (`[]` for the signed-out ephemeral world — nothing to
   *  hydrate). */
  readonly deltas: readonly ChunkDeltaRecord[];
  /** The outer component's stable atlas — passed in so it never churns
   *  across a `WorldSession` remount. */
  readonly atlas: BlockAtlas;
  /** Fired by `WorldStore.apply` after each successful, chunk-dirtying
   *  edit. `undefined` signed-out — no persistence. */
  readonly onCommit?: (
    command: Command,
    changed: readonly ChunkKey[],
  ) => void;
}

/**
 * One play session's worth of world state, mounted fresh whenever the
 * outer component's `key` changes (a different `worldId`, or the
 * `"ephemeral"` signed-out session). Everything here is per-mount, matching
 * the original single-component `GameScene`'s behavior before the #20
 * split.
 */
function WorldSession({ seed, deltas, atlas, onCommit }: WorldSessionProps) {
  // Built once per mount: the pure/deterministic generated world (hydrated
  // with any stored deltas before anything else touches it) and the one
  // `WorldStore` (mutation + the versioned chunk snapshot + the #20
  // `onCommit` persistence hook). `seed`/`deltas` are listed as deps to
  // satisfy exhaustive-deps, but in practice they're fixed for this
  // component's whole lifetime — a different seed/deltas set always arrives
  // via a new `key` (a fresh mount), never a prop change on this instance.
  const generated = useMemo(() => {
    const result = generateWorld({ seed });
    applyStoredDeltas(result.world, seed, deltas);
    return result;
  }, [seed, deltas]);
  const store = useMemo(
    () => createWorldStore(generated.world, undefined, onCommit),
    [generated, onCommit],
  );

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

function toDeltaRecord(wire: {
  chunkKey: string;
  data: string;
}): ChunkDeltaRecord {
  return { chunkKey: wire.chunkKey, data: base64ToBytes(wire.data) };
}

export default function GameScene() {
  // The canvas-backed procedural atlas texture: built once for the whole
  // outer component's lifetime, independent of which `WorldSession` (or
  // how many, across a future New Game) mounts under it.
  const atlas = useMemo(() => createBlockAtlas(), []);
  useEffect(() => () => atlas.texture.dispose(), [atlas]);

  // Signed-out visitors get an immediate `UNAUTHORIZED` from
  // `protectedProcedure` (no real I/O latency to retry through), so retries
  // are disabled specifically for that code — the play-first ephemeral
  // fallback should be instant, not delayed by react-query's default
  // exponential-backoff retries.
  const loadQuery = api.world.load.useQuery(undefined, {
    retry: (failureCount, error) =>
      error.data?.code !== "UNAUTHORIZED" && failureCount < 3,
  });

  // The active signed-in session's identity: `worldId`, `seed`, and the
  // deltas to hydrate, captured once from the first successful
  // `world.load` and then held stable — deliberately NOT re-derived from
  // `loadQuery.data` on every render, so a background refetch (e.g. window
  // refocus) can never reset a live `WorldSession`'s in-memory
  // `World`/`WorldStore` out from under the player. A future New Game
  // (#21) bumps this by calling `setHydrated` again with the fresh
  // `{worldId, seed, deltas: []}`, which changes `WorldSession`'s `key` and
  // forces a remount.
  //
  // Set via React's documented "adjust state while rendering" pattern
  // (calling `setState` directly in the render body, guarded so it only
  // fires once per newly-loaded `worldId`) rather than a `useEffect` — this
  // avoids both an extra post-mount render frame before the first
  // `WorldSession` can appear and, per this codebase's `react-hooks/refs`
  // lint rule, the need for a ref to smuggle the freshly-loaded deltas out
  // of an effect and into this render's JSX.
  const [hydrated, setHydrated] = useState<{
    readonly worldId: string;
    readonly seed: string;
    readonly deltas: readonly ChunkDeltaRecord[];
  } | null>(null);

  if (loadQuery.data && loadQuery.data.worldId !== hydrated?.worldId) {
    setHydrated({
      worldId: loadQuery.data.worldId,
      seed: loadQuery.data.seed,
      deltas: loadQuery.data.deltas.map(toDeltaRecord),
    });
  }

  const worldId = hydrated?.worldId;
  const applyEditMutation = api.world.applyEdit.useMutation();
  const mutateAsync = applyEditMutation.mutateAsync;

  // Recreated only when `worldId` actually changes (undefined -> the first
  // loaded id, and later a New Game's fresh id) — `mutateAsync` is a
  // `useCallback`-stabilized reference from `@tanstack/react-query`'s
  // `useMutation`, so this doesn't recreate (and lose in-flight/queued
  // work) on every unrelated re-render.
  const queue = useMemo(() => {
    if (worldId === undefined) {
      return undefined;
    }
    return createPersistQueue((command) =>
      mutateAsync({ worldId, command }),
    );
  }, [worldId, mutateAsync]);

  const handleCommit = useCallback(
    (command: Command) => queue?.enqueue(command),
    [queue],
  );

  const isUnauthorized = loadQuery.error?.data?.code === "UNAUTHORIZED";

  if (loadQuery.status === "pending") {
    return (
      <StatusScreen>
        <span aria-hidden="true" className="text-3xl">
          🐾
        </span>
        <span className="text-sm">Loading world…</span>
      </StatusScreen>
    );
  }

  if (loadQuery.status === "error" && !isUnauthorized) {
    return (
      <StatusScreen>
        <span className="text-sm text-red-300">
          Couldn&apos;t load your world: {loadQuery.error.message}
        </span>
      </StatusScreen>
    );
  }

  if (isUnauthorized) {
    // Play-first soft gate: signed-out visitors still get the instant,
    // zero-friction ephemeral demo — no redirect, no persistence.
    return (
      <WorldSession
        key="ephemeral"
        seed={EPHEMERAL_SEED}
        deltas={EMPTY_DELTAS}
        atlas={atlas}
      />
    );
  }

  if (!hydrated) {
    // `loadQuery.status === "success"` but the render-time state-adjustment
    // above hasn't run yet for this data (shouldn't normally happen since
    // it runs unconditionally before this check, but keeps the return type
    // total without a non-null assertion).
    return (
      <StatusScreen>
        <span aria-hidden="true" className="text-3xl">
          🐾
        </span>
        <span className="text-sm">Loading world…</span>
      </StatusScreen>
    );
  }

  return (
    <WorldSession
      key={hydrated.worldId}
      seed={hydrated.seed}
      deltas={hydrated.deltas}
      atlas={atlas}
      onCommit={handleCommit}
    />
  );
}
