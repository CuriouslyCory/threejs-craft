/**
 * Tests for the stub `worldRouter` (#10), exercised via `createCaller`
 * (`~/server/api/root`) rather than an HTTP layer — that's the same
 * server-side calling pattern the tRPC docs recommend for testing routers.
 *
 * `~/server/api/trpc` unconditionally imports `~/server/auth` (NextAuth)
 * and `~/server/db` (Prisma) at module scope. Neither loads cleanly in
 * Vitest's plain-Node environment (`next-auth` resolves a `next/server`
 * import that only exists under Next's own runtime), and `worldRouter`
 * doesn't touch `ctx.db`/`ctx.session` at all — so both are mocked out here
 * with minimal stand-ins, keeping this test node-env with no real DB/auth.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  auth: async () => null,
}));

vi.mock("~/server/db", () => ({
  db: {},
}));

import { BlockType } from "~/game/blocks";
import { DEFAULT_WORLD_SIZE } from "~/game/worldgen";
import { appRouter, createCaller } from "~/server/api/root";

/** A context satisfying the shape `createTRPCContext` would produce,
 *  without actually running NextAuth/Prisma — see the module doc comment. */
function buildTestContext(): Parameters<typeof createCaller>[0] {
  return {
    db: {},
    session: null,
    headers: new Headers(),
  } as unknown as Parameters<typeof createCaller>[0];
}

describe("worldRouter", () => {
  it("is registered under `world` on the app router", () => {
    expect(appRouter._def.procedures).toHaveProperty("world.meta");
    expect(appRouter._def.procedures).toHaveProperty("world.applyEdit");
  });

  describe("meta", () => {
    it("returns the stub seed and meta", async () => {
      const caller = createCaller(buildTestContext());

      const result = await caller.world.meta();

      expect(result).toEqual({
        seed: "threejs-craft-static-world-v1",
        meta: { size: DEFAULT_WORLD_SIZE, version: 1 },
      });
    });
  });

  describe("applyEdit", () => {
    it("validates a Command and returns the typed NOT_IMPLEMENTED result", async () => {
      const caller = createCaller(buildTestContext());

      const result = await caller.world.applyEdit({
        type: "BreakBlock",
        at: { x: 1, y: 2, z: 3 },
      });

      expect(result).toEqual({ ok: false, reason: "NOT_IMPLEMENTED" });
    });

    it("validates a PlaceBlock Command too", async () => {
      const caller = createCaller(buildTestContext());

      const result = await caller.world.applyEdit({
        type: "PlaceBlock",
        at: { x: 4, y: 5, z: 6 },
        block: BlockType.Stone,
      });

      expect(result).toEqual({ ok: false, reason: "NOT_IMPLEMENTED" });
    });

    it("rejects a malformed Command with a validation error", async () => {
      const caller = createCaller(buildTestContext());

      await expect(
        caller.world.applyEdit({
          type: "FlyBlock",
          at: { x: 1, y: 2, z: 3 },
        } as never),
      ).rejects.toThrow();
    });

    it("rejects a Command missing required fields", async () => {
      const caller = createCaller(buildTestContext());

      await expect(
        caller.world.applyEdit({
          type: "PlaceBlock",
          at: { x: 1, y: 2, z: 3 },
        } as never),
      ).rejects.toThrow();
    });
  });
});
