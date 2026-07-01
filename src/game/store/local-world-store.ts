/**
 * Composition root for #6: wraps a `GeneratedWorld` (from `generateWorld`)
 * with a minimal, forward-compatible "world source" so `game-scene.tsx`
 * doesn't reach into `World` directly.
 *
 * This is deliberately thin. #8 (picking) formalized mutation
 * (`~/game/store/world-store.ts`'s `GameStore`) on top of it. #10 formalizes
 * the read-side `WorldSource` interface below — the seam that lets the
 * composition root (`game-scene.tsx`) swap `LocalWorldSource` for a
 * `RemoteWorldSource` (`~/game/store/remote-world-source.ts`) without any
 * other code changing.
 */

import type { Chunk } from "~/game/chunk";
import { CHUNK_SIZE } from "~/game/coords";
import type { World } from "~/game/world";
import type { GeneratedWorld } from "~/game/worldgen";

/** World-space coordinate of a chunk's local (0,0,0) voxel. */
export interface ChunkOrigin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChunkSourceEntry {
  readonly chunk: Chunk;
  readonly origin: ChunkOrigin;
}

/**
 * The read surface the render layer needs from *any* world source, local or
 * remote (#10). Both `LocalWorldSource` (below) and `RemoteWorldSource`
 * (`~/game/store/remote-world-source.ts`) satisfy this — it's what makes
 * the composition-root factory swap in `game-scene.tsx` type-check no
 * matter which one is chosen.
 */
export interface WorldSource {
  /** Every currently-loaded chunk, with its world-space origin. */
  chunkEntries(): ChunkSourceEntry[];
}

/** Thin read-only surface over an in-memory `World`. */
export class LocalWorldSource implements WorldSource {
  constructor(private readonly world: World) {}

  /** Every currently-loaded chunk, with its world-space origin. */
  chunkEntries(): ChunkSourceEntry[] {
    return this.world.chunkEntries().map(({ cx, cy, cz, chunk }) => ({
      chunk,
      origin: {
        x: cx * CHUNK_SIZE,
        y: cy * CHUNK_SIZE,
        z: cz * CHUNK_SIZE,
      },
    }));
  }
}

export interface LocalWorldStore {
  readonly generated: GeneratedWorld;
  readonly source: WorldSource;
}

/**
 * Build the composition-root store: a generated world plus its world
 * source. `SourceCtor` is injected — not hardcoded to `LocalWorldSource` —
 * which is what lets `game-scene.tsx` (#10) swap in `RemoteWorldSource`
 * (or any other `WorldSource`) at a single call site without changing this
 * factory or any of its other call sites.
 */
export function createLocalWorldStore(
  generated: GeneratedWorld,
  SourceCtor: new (world: World) => WorldSource = LocalWorldSource,
): LocalWorldStore {
  return {
    generated,
    source: new SourceCtor(generated.world),
  };
}
