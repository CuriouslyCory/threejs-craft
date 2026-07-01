/**
 * Tiny pure module with no three.js or DOM dependencies.
 *
 * Its sole purpose is to prove the test harness works end-to-end: the
 * `~/` path alias resolves under vitest, and pure game logic can be
 * unit-tested in a plain node environment. See
 * `src/game/__tests__/smoke.test.ts`.
 */
export function add(a: number, b: number): number {
  return a + b;
}
