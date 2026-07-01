import { describe, expect, it } from "vitest";

import {
  CHUNK_SIZE,
  chunkKey,
  parseChunkKey,
  worldToChunk,
  worldToChunkCoord,
  worldToLocal,
  worldToLocalCoord,
} from "~/game/coords";

describe("coords", () => {
  it("floors positive world coords into their chunk", () => {
    expect(worldToChunk(0)).toBe(0);
    expect(worldToChunk(15)).toBe(0);
    expect(worldToChunk(16)).toBe(1);
    expect(worldToChunk(31)).toBe(1);
    expect(worldToChunk(32)).toBe(2);
  });

  it("floors negative world coords into their chunk (not truncation)", () => {
    expect(worldToChunk(-1)).toBe(-1);
    expect(worldToChunk(-16)).toBe(-1);
    expect(worldToChunk(-17)).toBe(-2);
    expect(worldToChunk(-32)).toBe(-2);
  });

  it("keeps local coords in 0..15 for positive world coords", () => {
    expect(worldToLocal(0)).toBe(0);
    expect(worldToLocal(15)).toBe(15);
    expect(worldToLocal(16)).toBe(0);
    expect(worldToLocal(31)).toBe(15);
  });

  it("keeps local coords in 0..15 for negative world coords", () => {
    expect(worldToLocal(-1)).toBe(15);
    expect(worldToLocal(-16)).toBe(0);
    expect(worldToLocal(-17)).toBe(15);
    expect(worldToLocal(-32)).toBe(0);
  });

  it("round-trips world -1 to chunk -1, local 15 (issue's explicit example)", () => {
    expect(worldToChunk(-1)).toBe(-1);
    expect(worldToLocal(-1)).toBe(15);
  });

  it("reconstructs the original world coord from chunk*16 + local", () => {
    for (const world of [-33, -17, -1, 0, 1, 15, 16, 47, 100, -100]) {
      const chunk = worldToChunk(world);
      const local = worldToLocal(world);
      expect(chunk * CHUNK_SIZE + local).toBe(world);
      expect(local).toBeGreaterThanOrEqual(0);
      expect(local).toBeLessThan(CHUNK_SIZE);
    }
  });

  it("computes chunk/local coord triples consistently, including negatives", () => {
    expect(worldToChunkCoord(-1, -17, 5)).toEqual({ cx: -1, cy: -2, cz: 0 });
    expect(worldToLocalCoord(-1, -17, 5)).toEqual({ lx: 15, ly: 15, lz: 5 });
  });

  it("produces a stable, distinguishable chunk key", () => {
    expect(chunkKey(0, 0, 0)).toBe("0,0,0");
    expect(chunkKey(-1, 2, -3)).toBe("-1,2,-3");
    expect(chunkKey(1, 0, 0)).not.toBe(chunkKey(0, 1, 0));
  });

  it("parseChunkKey reverses chunkKey, including negative coordinates", () => {
    for (const coord of [
      { cx: 0, cy: 0, cz: 0 },
      { cx: -1, cy: 2, cz: -3 },
      { cx: 12, cy: -7, cz: 100 },
    ]) {
      expect(parseChunkKey(chunkKey(coord.cx, coord.cy, coord.cz))).toEqual(
        coord,
      );
    }
  });
});
