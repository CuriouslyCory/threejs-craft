/**
 * Deterministic seeded randomness for worldgen.
 *
 * `xmur3` hashes an arbitrary string seed down to a 32-bit integer seed
 * function; `mulberry32` turns a 32-bit integer seed into a fast PRNG
 * producing numbers in [0, 1). Both are pure — no `Math.random`, no
 * ambient state — so the same seed always reproduces the same sequence.
 */

/** A pure pseudo-random number generator: repeated calls produce a
 * deterministic sequence of numbers in [0, 1). */
export type Rng = () => number;

/**
 * Hash an arbitrary string into a seed-generating function. Each call to
 * the returned function produces the next 32-bit unsigned integer in a
 * deterministic sequence derived from `seed`.
 */
export function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * Mulberry32 PRNG. Given a 32-bit integer seed, returns a function that
 * yields a deterministic sequence of numbers in [0, 1) on each call.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: build a deterministic RNG directly from a string seed. */
export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  return mulberry32(seedFn());
}
