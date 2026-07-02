/**
 * World <-> bytes bridge: reconstructs a `World` from a seed plus a set of
 * stored per-chunk edit deltas (see `./chunk-delta`).
 *
 * Pure `Uint8Array`-in / `Uint8Array`-out, same as `chunk-delta.ts` — no
 * `Buffer`, no base64, no DOM. Regenerating the whole seeded world to
 * extract one chunk's "base" bytes is intentionally cheap and pure
 * (`generateWorld` is deterministic — see the pinned golden-hash test in
 * `worldgen.test.ts`).
 *
 * Every delta is decoded against the freshly-regenerated seeded base (never
 * against a chunk's current in-memory bytes), so applying a set of deltas is
 * both order-independent and idempotent.
 */

import { CHUNK_VOLUME } from "~/game/chunk";
import type { ChunkKey } from "~/game/coords";
import { parseChunkKey } from "~/game/coords";
import {
  decodeChunkDelta,
  encodeChunkDelta,
} from "~/game/persistence/chunk-delta";
import type { World } from "~/game/world";
import { generateWorld } from "~/game/worldgen";

/** A stored edit delta for a single chunk, keyed the same way `World` does. */
export interface ChunkDeltaRecord {
  readonly chunkKey: ChunkKey;
  readonly data: Uint8Array;
}

/**
 * The "base" bytes for `key` under `seed`: regenerates the whole seeded
 * world and snapshots the chunk at that key. Worldgen never creates
 * all-air chunks (chunks are lazy), so a key with no generated content
 * returns a zero-filled `CHUNK_VOLUME` array (air) rather than throwing.
 */
export function baseChunkBytes(seed: string, key: ChunkKey): Uint8Array {
  const { world } = generateWorld({ seed });
  const { cx, cy, cz } = parseChunkKey(key);
  const chunk = world.getChunk(cx, cy, cz);
  return chunk ? chunk.snapshot() : new Uint8Array(CHUNK_VOLUME);
}

/** Diff `current` chunk bytes against the seeded base for `key`. */
export function computeChunkDelta(
  seed: string,
  key: ChunkKey,
  current: Uint8Array,
): Uint8Array {
  return encodeChunkDelta(baseChunkBytes(seed, key), current);
}

/**
 * Apply stored deltas onto `world` in place. Each delta is decoded against
 * the seeded base for its chunk key (not the chunk's current bytes), so
 * this is safe to call with deltas in any order and safe to call more than
 * once (idempotent).
 */
export function applyStoredDeltas(
  world: World,
  seed: string,
  deltas: readonly ChunkDeltaRecord[],
): void {
  for (const { chunkKey: key, data } of deltas) {
    const base = baseChunkBytes(seed, key);
    const bytes = decodeChunkDelta(base, data);
    const { cx, cy, cz } = parseChunkKey(key);
    const chunk = world.ensureChunk(cx, cy, cz);
    chunk.load(bytes);
  }
}

/**
 * Reconstruct a full `World` from a seed plus its stored edit deltas:
 * regenerate the seeded world, then replay every delta on top of it.
 */
export function hydrateWorld(
  seed: string,
  deltas: readonly ChunkDeltaRecord[],
): World {
  const { world } = generateWorld({ seed });
  applyStoredDeltas(world, seed, deltas);
  return world;
}
