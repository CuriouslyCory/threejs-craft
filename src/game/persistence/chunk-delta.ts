/**
 * Compact sparse codec for chunk edits.
 *
 * Format (all integers big-endian via `DataView`):
 *   [uint8 version][uint16 count]( uint16 idx, uint8 val )*
 * - Version byte pins the format for future extensibility.
 * - `count` = number of edits.
 * - Each edit: index into the `CHUNK_VOLUME`-byte chunk + new block value.
 * - Untouched chunks encode to an empty delta (3-byte header, count === 0).
 *
 * Pure `Uint8Array`-in / `Uint8Array`-out. No `Buffer`, no base64 — this
 * module is imported by the browser r3f scene via `src/game/**`, and
 * `Buffer` is Node-only. Base64 (de)serialization for the wire/DB boundary
 * is a later issue's server-side concern, not this layer's.
 *
 * All functions are pure and do not mutate their inputs.
 */

import { CHUNK_VOLUME } from "~/game/chunk";

export const CHUNK_DELTA_VERSION = 1;

/** Byte offset of the version field. */
const VERSION_OFFSET = 0;
/** Byte offset of the uint16 edit-count field. */
const COUNT_OFFSET = 1;
/** Size of the fixed header: 1 byte version + 2 bytes count. */
const HEADER_SIZE = 3;
/** Size of a single (uint16 idx, uint8 val) edit record. */
const EDIT_SIZE = 3;

function assertChunkVolume(bytes: Uint8Array, label: string): void {
  if (bytes.length !== CHUNK_VOLUME) {
    throw new RangeError(
      `${label} must be exactly ${CHUNK_VOLUME} bytes, got ${bytes.length}`,
    );
  }
}

/**
 * Encode a sparse delta between `base` and `current` chunk bytes.
 * Emits only the indices where the two differ, storing `current`'s value.
 * Throws `RangeError` if either input is not exactly `CHUNK_VOLUME` bytes.
 */
export function encodeChunkDelta(
  base: Uint8Array,
  current: Uint8Array,
): Uint8Array {
  assertChunkVolume(base, "base");
  assertChunkVolume(current, "current");

  const edits: Array<{ idx: number; val: number }> = [];
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    const baseVal = base[i];
    const currentVal = current[i];
    if (baseVal !== currentVal) {
      edits.push({ idx: i, val: currentVal! });
    }
  }

  const buffer = new ArrayBuffer(HEADER_SIZE + edits.length * EDIT_SIZE);
  const view = new DataView(buffer);
  view.setUint8(VERSION_OFFSET, CHUNK_DELTA_VERSION);
  view.setUint16(COUNT_OFFSET, edits.length, false);

  edits.forEach(({ idx, val }, i) => {
    const offset = HEADER_SIZE + i * EDIT_SIZE;
    view.setUint16(offset, idx, false);
    view.setUint8(offset + 2, val);
  });

  return new Uint8Array(buffer);
}

/**
 * Decode `delta` and replay it onto `base`, returning the reconstructed
 * `current` bytes. Returns a new `Uint8Array`; does not mutate `base`.
 * Throws `RangeError` on an unsupported version or an out-of-range index.
 */
export function decodeChunkDelta(
  base: Uint8Array,
  delta: Uint8Array,
): Uint8Array {
  assertChunkVolume(base, "base");
  if (delta.length < HEADER_SIZE) {
    throw new RangeError(
      `Chunk delta too short: expected at least ${HEADER_SIZE} bytes, got ${delta.length}`,
    );
  }

  const view = new DataView(delta.buffer, delta.byteOffset, delta.byteLength);
  const version = view.getUint8(VERSION_OFFSET);
  if (version !== CHUNK_DELTA_VERSION) {
    throw new RangeError(
      `Unsupported chunk delta version: ${version} (expected ${CHUNK_DELTA_VERSION})`,
    );
  }

  const count = view.getUint16(COUNT_OFFSET, false);
  const expectedLength = HEADER_SIZE + count * EDIT_SIZE;
  if (delta.length < expectedLength) {
    throw new RangeError(
      `Chunk delta truncated: expected ${expectedLength} bytes for ${count} edits, got ${delta.length}`,
    );
  }

  const current = base.slice();
  for (let i = 0; i < count; i++) {
    const offset = HEADER_SIZE + i * EDIT_SIZE;
    const idx = view.getUint16(offset, false);
    const val = view.getUint8(offset + 2);
    if (idx >= CHUNK_VOLUME) {
      throw new RangeError(
        `Chunk delta references out-of-range voxel index: ${idx} (chunk volume ${CHUNK_VOLUME})`,
      );
    }
    current[idx] = val;
  }

  return current;
}

/**
 * True when `delta` encodes zero edits (reads the uint16 count field —
 * never inferred from `.length`).
 */
export function isEmptyChunkDelta(delta: Uint8Array): boolean {
  if (delta.length < HEADER_SIZE) {
    throw new RangeError(
      `Chunk delta too short: expected at least ${HEADER_SIZE} bytes, got ${delta.length}`,
    );
  }
  const view = new DataView(delta.buffer, delta.byteOffset, delta.byteLength);
  return view.getUint16(COUNT_OFFSET, false) === 0;
}
