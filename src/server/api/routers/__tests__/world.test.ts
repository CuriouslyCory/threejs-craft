/**
 * Tests for the real `worldRouter` (#19), exercised via `createCaller`
 * (`~/server/api/root`) — the same server-side calling pattern used by the
 * #10 stub tests this file replaces.
 *
 * `~/server/api/trpc` unconditionally imports `~/server/auth` (NextAuth)
 * and `~/server/db` (Prisma) at module scope. Neither loads cleanly in
 * Vitest's plain-Node environment (see the #10-era comment this file
 * inherits the pattern from), so both are mocked out here with minimal
 * stand-ins. `ctx.db` is swapped for `FakeActiveWorldDb`
 * (`~/server/world/__tests__/fake-db`) — the same in-memory fake
 * `active-world.test.ts` uses — so this suite exercises the router's own
 * wiring (auth gating, base64 boundary, error translation) against real
 * persistence *logic*, without a real Postgres/Prisma involved.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  auth: async () => null,
}));

vi.mock("~/server/db", () => ({
  db: {},
}));

import { BlockType } from "~/game/blocks";
import { hydrateWorld } from "~/game/persistence/world-delta";
import { appRouter, createCaller } from "~/server/api/root";
import { FakeActiveWorldDb } from "~/server/world/__tests__/fake-db";

type Caller = ReturnType<typeof createCaller>;

/** A context satisfying the shape `createTRPCContext` would produce,
 *  without actually running NextAuth/Prisma — see the module doc comment.
 *  `db` is a fresh `FakeActiveWorldDb` per call unless one is passed in, so
 *  tests can share state across multiple procedure calls for the same
 *  "session". */
function buildTestContext(options?: {
  userId?: string | null;
  db?: FakeActiveWorldDb;
}): Parameters<typeof createCaller>[0] {
  // `?? "user-1"` would treat an explicit `userId: null` (meaning
  // "signed out") the same as "not provided" (`??` doesn't distinguish
  // `null` from `undefined`) — so presence is checked explicitly instead.
  const userId = options && "userId" in options ? options.userId : "user-1";
  const db = options?.db ?? new FakeActiveWorldDb();
  return {
    db,
    session: userId ? { user: { id: userId }, expires: "" } : null,
    headers: new Headers(),
  } as unknown as Parameters<typeof createCaller>[0];
}

function callerWithDb(db: FakeActiveWorldDb, userId = "user-1"): Caller {
  return createCaller(buildTestContext({ userId, db }));
}

describe("worldRouter", () => {
  it("is registered under `world` on the app router", () => {
    expect(appRouter._def.procedures).toHaveProperty("world.load");
    expect(appRouter._def.procedures).toHaveProperty("world.applyEdit");
    expect(appRouter._def.procedures).toHaveProperty("world.newGame");
    expect(appRouter._def.procedures).toHaveProperty("world.status");
  });

  describe("signed out", () => {
    it("rejects load with UNAUTHORIZED", async () => {
      const caller = createCaller(buildTestContext({ userId: null }));
      await expect(caller.world.load()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("rejects applyEdit with UNAUTHORIZED", async () => {
      const caller = createCaller(buildTestContext({ userId: null }));
      await expect(
        caller.world.applyEdit({
          worldId: "whatever",
          command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rejects newGame with UNAUTHORIZED", async () => {
      const caller = createCaller(buildTestContext({ userId: null }));
      await expect(caller.world.newGame()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("rejects status with UNAUTHORIZED", async () => {
      const caller = createCaller(buildTestContext({ userId: null }));
      await expect(caller.world.status()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("load", () => {
    it("auto-provisions a world with empty deltas for a new user", async () => {
      const caller = callerWithDb(new FakeActiveWorldDb());

      const result = await caller.world.load();

      expect(result.worldId).toEqual(expect.any(String));
      expect(result.seed).toEqual(expect.any(String));
      expect(result.version).toBe(1);
      expect(result.deltas).toEqual([]);
    });

    it("reuses the same world (same seed) across repeated loads", async () => {
      const db = new FakeActiveWorldDb();
      const caller = callerWithDb(db);

      const first = await caller.world.load();
      const second = await caller.world.load();

      expect(second.worldId).toBe(first.worldId);
      expect(second.seed).toBe(first.seed);
    });
  });

  describe("applyEdit", () => {
    it("rejects a malformed Command with a validation error", async () => {
      const caller = callerWithDb(new FakeActiveWorldDb());

      await expect(
        caller.world.applyEdit({
          worldId: "world-1",
          command: { type: "FlyBlock", at: { x: 1, y: 2, z: 3 } } as never,
        }),
      ).rejects.toThrow();
    });

    it("rejects a Command missing required fields", async () => {
      const caller = callerWithDb(new FakeActiveWorldDb());

      await expect(
        caller.world.applyEdit({
          worldId: "world-1",
          command: { type: "PlaceBlock", at: { x: 1, y: 2, z: 3 } } as never,
        }),
      ).rejects.toThrow();
    });

    it("rejects a stale worldId with CONFLICT", async () => {
      const db = new FakeActiveWorldDb();
      const caller = callerWithDb(db);
      await caller.world.load();

      await expect(
        caller.world.applyEdit({
          worldId: "not-the-real-id",
          command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("break -> load round-trips through base64 and reconstructs the block", async () => {
      const db = new FakeActiveWorldDb();
      const caller = callerWithDb(db);
      const { worldId, seed } = await caller.world.load();

      const editResult = await caller.world.applyEdit({
        worldId,
        command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
      });
      expect(editResult.changed).toEqual(["0,0,0"]);

      const loaded = await caller.world.load();
      expect(loaded.deltas).toHaveLength(1);
      expect(typeof loaded.deltas[0]?.data).toBe("string");

      const records = loaded.deltas.map((d) => ({
        chunkKey: d.chunkKey,
        data: new Uint8Array(Buffer.from(d.data, "base64")),
      }));
      const world = hydrateWorld(seed, records);
      expect(world.getBlock(0, 0, 0)).toBe(BlockType.Air);
    });

    it("two edits to the same chunk accumulate", async () => {
      const db = new FakeActiveWorldDb();
      const caller = callerWithDb(db);
      const { worldId, seed } = await caller.world.load();

      await caller.world.applyEdit({
        worldId,
        command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
      });
      await caller.world.applyEdit({
        worldId,
        command: { type: "BreakBlock", at: { x: 1, y: 0, z: 0 } },
      });

      const loaded = await caller.world.load();
      expect(loaded.deltas).toHaveLength(1);

      const records = loaded.deltas.map((d) => ({
        chunkKey: d.chunkKey,
        data: new Uint8Array(Buffer.from(d.data, "base64")),
      }));
      const world = hydrateWorld(seed, records);
      expect(world.getBlock(0, 0, 0)).toBe(BlockType.Air);
      expect(world.getBlock(1, 0, 0)).toBe(BlockType.Air);
    });

    it("reverting a chunk to its base state prunes the delta", async () => {
      const db = new FakeActiveWorldDb();
      const caller = callerWithDb(db);
      const { worldId } = await caller.world.load();

      await caller.world.applyEdit({
        worldId,
        command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
      });
      const midway = await caller.world.load();
      expect(midway.deltas).toHaveLength(1);

      await caller.world.applyEdit({
        worldId,
        command: {
          type: "PlaceBlock",
          at: { x: 0, y: 0, z: 0 },
          block: BlockType.Stone,
        },
      });

      const reloaded = await caller.world.load();
      expect(reloaded.deltas).toHaveLength(0);
    });
  });

  describe("newGame", () => {
    it("reseeds with empty deltas and a new worldId", async () => {
      const db = new FakeActiveWorldDb();
      const caller = callerWithDb(db);
      const original = await caller.world.load();
      await caller.world.applyEdit({
        worldId: original.worldId,
        command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
      });

      const fresh = await caller.world.newGame();

      expect(fresh.worldId).not.toBe(original.worldId);

      const reloaded = await caller.world.load();
      expect(reloaded.worldId).toBe(fresh.worldId);
      expect(reloaded.seed).toBe(fresh.seed);
      expect(reloaded.deltas).toEqual([]);
    });
  });

  describe("status", () => {
    it("returns null before any world is loaded", async () => {
      const caller = callerWithDb(new FakeActiveWorldDb());

      await expect(caller.world.status()).resolves.toBeNull();
    });

    it("returns cheap metadata after a world exists", async () => {
      const db = new FakeActiveWorldDb();
      const caller = callerWithDb(db);
      const { worldId, seed, version } = await caller.world.load();

      const result = await caller.world.status();

      expect(result).toMatchObject({ worldId, seed, version });
    });
  });
});
