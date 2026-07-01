/**
 * Coordinate conversions between world space, chunk space, and a chunk's
 * local 0..15 voxel space. All chunks are 16^3 voxels.
 *
 * Every conversion here must behave correctly for negative world
 * coordinates: floor-division for the chunk coordinate (not truncation),
 * and a modulo that always lands in 0..15 (not JS's sign-following `%`).
 */

export const CHUNK_SIZE = 16;

/** World coordinate -> the chunk coordinate that contains it. */
export function worldToChunk(worldCoord: number): number {
  return Math.floor(worldCoord / CHUNK_SIZE);
}

/** World coordinate -> the local (0..15) coordinate within its chunk. */
export function worldToLocal(worldCoord: number): number {
  // JS `%` follows the sign of the dividend (and can yield `-0`), so a
  // single modulo isn't enough for negatives. A second modulo after adding
  // CHUNK_SIZE normalizes the result into 0..15 (and away from `-0`).
  return ((worldCoord % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}

export interface ChunkCoord {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
}

export interface LocalCoord {
  readonly lx: number;
  readonly ly: number;
  readonly lz: number;
}

/** Convert a world-space voxel position to its chunk coordinate. */
export function worldToChunkCoord(
  x: number,
  y: number,
  z: number,
): ChunkCoord {
  return { cx: worldToChunk(x), cy: worldToChunk(y), cz: worldToChunk(z) };
}

/** Convert a world-space voxel position to its local-in-chunk coordinate. */
export function worldToLocalCoord(
  x: number,
  y: number,
  z: number,
): LocalCoord {
  return { lx: worldToLocal(x), ly: worldToLocal(y), lz: worldToLocal(z) };
}

/** Stable, human-readable key identifying a chunk, safe to use as a Map key. */
export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/**
 * Reverse of `chunkKey` — recovers the chunk coordinate from a key produced
 * by it. Used by `World.chunkEntries()` so callers (the render layer) can
 * enumerate loaded chunks with their coordinates without `World` needing to
 * store coordinates redundantly alongside its `Map` keys.
 */
export function parseChunkKey(key: string): ChunkCoord {
  const [cxRaw, cyRaw, czRaw] = key.split(",");
  return { cx: Number(cxRaw), cy: Number(cyRaw), cz: Number(czRaw) };
}
