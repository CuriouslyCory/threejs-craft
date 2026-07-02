import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { Chunk } from "~/game/chunk";

describe("Chunk", () => {
  it("defaults every voxel to Air", () => {
    const chunk = new Chunk();
    expect(chunk.get(0, 0, 0)).toBe(BlockType.Air);
    expect(chunk.get(15, 15, 15)).toBe(BlockType.Air);
  });

  it("set then get round-trips a block id", () => {
    const chunk = new Chunk();
    chunk.set(1, 2, 3, BlockType.Stone);
    expect(chunk.get(1, 2, 3)).toBe(BlockType.Stone);
    // Neighboring voxels remain untouched.
    expect(chunk.get(1, 2, 4)).toBe(BlockType.Air);
  });

  it("does not alias voxels across the x/y/z axes (index math is distinct)", () => {
    const chunk = new Chunk();
    chunk.set(2, 0, 0, BlockType.Grass);
    chunk.set(0, 0, 2, BlockType.Dirt);
    chunk.set(0, 2, 0, BlockType.Wood);
    expect(chunk.get(2, 0, 0)).toBe(BlockType.Grass);
    expect(chunk.get(0, 0, 2)).toBe(BlockType.Dirt);
    expect(chunk.get(0, 2, 0)).toBe(BlockType.Wood);
  });

  it("returns Air for out-of-local-range reads instead of throwing", () => {
    const chunk = new Chunk();
    expect(() => chunk.get(-1, 0, 0)).not.toThrow();
    expect(chunk.get(-1, 0, 0)).toBe(BlockType.Air);
    expect(chunk.get(16, 0, 0)).toBe(BlockType.Air);
    expect(chunk.get(0, -1, 0)).toBe(BlockType.Air);
    expect(chunk.get(0, 16, 0)).toBe(BlockType.Air);
    expect(chunk.get(0, 0, -1)).toBe(BlockType.Air);
    expect(chunk.get(0, 0, 16)).toBe(BlockType.Air);
  });

  it("ignores out-of-local-range writes instead of throwing", () => {
    const chunk = new Chunk();
    expect(() => chunk.set(16, 0, 0, BlockType.Stone)).not.toThrow();
    expect(() => chunk.set(-1, 0, 0, BlockType.Stone)).not.toThrow();
    // Nothing was actually written to any in-bounds voxel by accident.
    expect(chunk.get(0, 0, 0)).toBe(BlockType.Air);
  });

  it("snapshot() returns a defensive copy; mutations don't affect the original", () => {
    const chunk = new Chunk();
    chunk.set(5, 5, 5, BlockType.Stone);

    const snap1 = chunk.snapshot();
    expect(snap1[snap1.length - 1]).toBe(0); // ensure we got the array

    // Mutate the snapshot directly
    snap1[0] = 99;

    // Original chunk is unaffected
    expect(chunk.get(0, 0, 0)).toBe(BlockType.Air);

    // Subsequent snapshots are unaffected by the mutation
    const snap2 = chunk.snapshot();
    expect(snap2[0]).toBe(0);
  });

  it("load() round-trip: snapshot → load → snapshot yields identical bytes", () => {
    const chunk = new Chunk();
    chunk.set(1, 2, 3, BlockType.Stone);
    chunk.set(7, 8, 9, BlockType.Dirt);
    chunk.set(15, 15, 15, BlockType.Leaves);

    const bytes1 = chunk.snapshot();

    // Load into a fresh chunk
    const chunk2 = new Chunk();
    chunk2.load(bytes1);

    const bytes2 = chunk2.snapshot();

    // Bytes should be identical
    expect(bytes2).toEqual(bytes1);

    // And reading the same coordinates should work
    expect(chunk2.get(1, 2, 3)).toBe(BlockType.Stone);
    expect(chunk2.get(7, 8, 9)).toBe(BlockType.Dirt);
    expect(chunk2.get(15, 15, 15)).toBe(BlockType.Leaves);
  });

  it("load() rejects wrong-length inputs with a RangeError", () => {
    const chunk = new Chunk();

    // Too short
    const tooShort = new Uint8Array(100);
    expect(() => chunk.load(tooShort)).toThrow(RangeError);
    expect(() => chunk.load(tooShort)).toThrow(/expected.*bytes, got 100/);

    // Too long
    const tooLong = new Uint8Array(5000);
    expect(() => chunk.load(tooLong)).toThrow(RangeError);
    expect(() => chunk.load(tooLong)).toThrow(/expected.*bytes, got 5000/);
  });

  it("snapshot() never mutates this.blocks", () => {
    const chunk = new Chunk();
    chunk.set(2, 3, 4, BlockType.Wood);

    const bytes = chunk.snapshot();
    const original = chunk.snapshot();

    // Mutate the returned snapshot
    bytes[10] = 255;
    bytes[20] = 128;

    // Original block state unchanged
    const afterMutation = chunk.snapshot();
    expect(afterMutation).toEqual(original);
  });
});
