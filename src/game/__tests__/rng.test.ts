import { describe, expect, it, vi } from "vitest";

import { createRng, mulberry32, xmur3 } from "~/game/rng";

describe("rng", () => {
  it("xmur3 produces a deterministic sequence for the same seed", () => {
    const a = xmur3("hello-world");
    const b = xmur3("hello-world");
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("xmur3 produces different sequences for different seeds", () => {
    const a = xmur3("seed-one");
    const b = xmur3("seed-two");
    expect(a()).not.toBe(b());
  });

  it("mulberry32 produces a deterministic sequence for the same numeric seed", () => {
    const rngA = mulberry32(12345);
    const rngB = mulberry32(12345);
    const seqA = Array.from({ length: 10 }, () => rngA());
    const seqB = Array.from({ length: 10 }, () => rngB());
    expect(seqA).toEqual(seqB);
  });

  it("mulberry32 always yields numbers in [0, 1)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("createRng(seed) is deterministic end-to-end for the same seed", () => {
    const rngA = createRng("world-1");
    const rngB = createRng("world-1");
    const valuesA = Array.from({ length: 20 }, () => rngA());
    const valuesB = Array.from({ length: 20 }, () => rngB());
    expect(valuesA).toEqual(valuesB);
  });

  it("createRng(seed) differs across seeds", () => {
    const rngA = createRng("world-1");
    const rngB = createRng("world-2");
    const valuesA = Array.from({ length: 20 }, () => rngA());
    const valuesB = Array.from({ length: 20 }, () => rngB());
    expect(valuesA).not.toEqual(valuesB);
  });

  it("never calls Math.random under the hood", () => {
    const spy = vi.spyOn(Math, "random");
    const rng = createRng("no-math-random");
    for (let i = 0; i < 50; i++) rng();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
