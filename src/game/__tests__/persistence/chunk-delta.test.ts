import { describe, expect, it } from "vitest";

import { CHUNK_VOLUME } from "~/game/chunk";
import {
  CHUNK_DELTA_VERSION,
  decodeChunkDelta,
  encodeChunkDelta,
  isEmptyChunkDelta,
} from "~/game/persistence/chunk-delta";
import { createRng } from "~/game/rng";

/** A base chunk with a simple deterministic pattern (not all-zero, so a
 * "revert to air" edit is exercised too). */
function makeBase(): Uint8Array {
  const base = new Uint8Array(CHUNK_VOLUME);
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    base[i] = i % 5; // small, in-range block ids
  }
  return base;
}

/** Apply a deterministic, seeded set of edits on top of `base`. */
function makeEditedChunk(base: Uint8Array, seed: string): Uint8Array {
  const rng = createRng(seed);
  const current = base.slice();
  const editCount = 50;
  for (let i = 0; i < editCount; i++) {
    const idx = Math.floor(rng() * CHUNK_VOLUME);
    const val = Math.floor(rng() * 6);
    current[idx] = val;
  }
  return current;
}

describe("chunk-delta codec", () => {
  it("round-trip identity: decode(base, encode(base, current)) deep-equals current", () => {
    const base = makeBase();
    const current = makeEditedChunk(base, "chunk-delta-roundtrip");

    const delta = encodeChunkDelta(base, current);
    const decoded = decodeChunkDelta(base, delta);

    expect(decoded).toEqual(current);
    // encode/decode must not mutate their inputs.
    expect(base).toEqual(makeBase());
  });

  it("untouched chunk encodes to an empty delta and decodes back to base", () => {
    const base = makeBase();
    const current = base.slice(); // no edits

    const delta = encodeChunkDelta(base, current);

    expect(isEmptyChunkDelta(delta)).toBe(true);
    expect(delta.length).toBe(3); // header only: version + count(0)

    const decoded = decodeChunkDelta(base, delta);
    expect(decoded).toEqual(base);
  });

  it("single-voxel edit produces a small sparse delta, not a full-grid blob", () => {
    const base = makeBase();
    const current = base.slice();
    current[42] = (current[42]! + 1) % 6;

    const delta = encodeChunkDelta(base, current);

    // header (3) + one edit record (3) = 6 bytes, nowhere near CHUNK_VOLUME.
    expect(delta.length).toBe(6);
    expect(delta.length).toBeLessThan(CHUNK_VOLUME);
    expect(isEmptyChunkDelta(delta)).toBe(false);

    const decoded = decodeChunkDelta(base, delta);
    expect(decoded).toEqual(current);
  });

  it("is deterministic: same base/current always encodes to the same bytes", () => {
    const base = makeBase();
    const current = makeEditedChunk(base, "determinism-seed");

    const deltaA = encodeChunkDelta(base, current);
    const deltaB = encodeChunkDelta(base, current);

    expect(deltaA).toEqual(deltaB);
  });

  it("produces different deltas for different edited chunks", () => {
    const base = makeBase();
    const currentA = makeEditedChunk(base, "seed-a");
    const currentB = makeEditedChunk(base, "seed-b");

    expect(encodeChunkDelta(base, currentA)).not.toEqual(
      encodeChunkDelta(base, currentB),
    );
  });

  it("decode rejects an out-of-range voxel index", () => {
    const base = makeBase();
    const buffer = new ArrayBuffer(6);
    const view = new DataView(buffer);
    view.setUint8(0, CHUNK_DELTA_VERSION);
    view.setUint16(1, 1, false); // one edit
    view.setUint16(3, CHUNK_VOLUME, false); // idx === CHUNK_VOLUME: out of range
    view.setUint8(5, 1);
    const badDelta = new Uint8Array(buffer);

    expect(() => decodeChunkDelta(base, badDelta)).toThrow(RangeError);
  });

  it("decode rejects an unsupported version", () => {
    const base = makeBase();
    const buffer = new ArrayBuffer(3);
    const view = new DataView(buffer);
    view.setUint8(0, CHUNK_DELTA_VERSION + 1); // wrong version
    view.setUint16(1, 0, false);
    const badDelta = new Uint8Array(buffer);

    expect(() => decodeChunkDelta(base, badDelta)).toThrow(RangeError);
  });

  it("encode rejects inputs that aren't exactly CHUNK_VOLUME bytes", () => {
    const base = makeBase();
    const tooShort = new Uint8Array(10);
    expect(() => encodeChunkDelta(base, tooShort)).toThrow(RangeError);
    expect(() => encodeChunkDelta(tooShort, base)).toThrow(RangeError);
  });

  it("isEmptyChunkDelta reads the count field, not the byte length", () => {
    const base = makeBase();
    const current = base.slice();
    current[0] = (current[0]! + 1) % 6;
    const nonEmptyDelta = encodeChunkDelta(base, current);
    expect(nonEmptyDelta.length).toBeGreaterThan(3);
    expect(isEmptyChunkDelta(nonEmptyDelta)).toBe(false);

    const emptyDelta = encodeChunkDelta(base, base.slice());
    expect(isEmptyChunkDelta(emptyDelta)).toBe(true);
  });
});
