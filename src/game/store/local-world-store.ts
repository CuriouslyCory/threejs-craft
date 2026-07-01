/**
 * Composition root for #6: wraps a `GeneratedWorld` (from `generateWorld`)
 * with a minimal, forward-compatible "world source" so `game-scene.tsx`
 * doesn't reach into `World` directly.
 *
 * This is deliberately thin. #8 (picking) and #10 (the frozen
 * Command/WorldSource contract) will formalize the real read/write surface
 * a world source needs to expose (mutation commands, change notifications,
 * etc.) — `LocalWorldSource` here is *just* enough read-only surface for
 * #6's static render, not a preview of that contract. Don't extend this
 * class's public surface to anticipate #8/#10's shape; let those issues
 * design it when they land.
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

/** Thin read-only placeholder over an in-memory `World`. */
export class LocalWorldSource {
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
  readonly source: LocalWorldSource;
}

/**
 * Build the composition-root store: a generated world plus its (placeholder)
 * world source. `SourceCtor` is injected — not hardcoded to `LocalWorldSource`
 * — purely so #8/#10 can swap in the formalized `WorldSource` later without
 * changing this factory's call sites.
 */
export function createLocalWorldStore(
  generated: GeneratedWorld,
  SourceCtor: new (world: World) => LocalWorldSource = LocalWorldSource,
): LocalWorldStore {
  return {
    generated,
    source: new SourceCtor(generated.world),
  };
}
