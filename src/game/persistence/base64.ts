/**
 * Browser-safe base64 <-> bytes conversion (#20). The server's
 * `world.load`/`applyEdit` wire shapes carry chunk delta bytes as base64
 * strings (`src/server/api/routers/world.ts`'s `toWireDelta`, which uses
 * Node's `Buffer` — fine server-side); the client must decode those back
 * into `Uint8Array` for `applyStoredDeltas` (`./world-delta.ts`) WITHOUT
 * `Buffer`, since `game-scene.tsx` runs in the browser bundle, not Node.
 *
 * Deliberately kept out of `chunk-delta.ts`/`world-delta.ts`, which stay
 * pure `Uint8Array`-in/out with no base64/DOM concerns at all — this is the
 * one place that boundary is crossed, and only on the client.
 *
 * Uses `atob`/`btoa` (available in every browser and in modern Node, so
 * this is unit-testable in the plain `node` vitest environment too — see
 * `../__tests__/persistence/base64.test.ts`).
 */

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
