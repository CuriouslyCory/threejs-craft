/**
 * Unit tests for `../active-world` against `FakeActiveWorldDb`
 * (`./fake-db`) — no real Prisma/Postgres involved, matching the module's
 * "pure logic over an injected `db`" design (see the module doc comment in
 * `../active-world.ts`).
 *
 * `(0, 0, 0)` is used as the go-to edit target throughout: `worldgen.ts`'s
 * `fillTerrainColumn` unconditionally fills `y` 0..`STONE_TOP_Y` (2) with
 * `Stone` for every `(x, z)` in bounds, for *every* seed — tree placement
 * only ever touches `y >= GRASS_Y` (4) and never the stone layer — so
 * `(0, 0, 0)` is deterministically `Stone` in the base world regardless of
 * seed, without this test needing to know anything else about worldgen.
 */

import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import { hydrateWorld } from "~/game/persistence/world-delta";

import {
  loadWorld,
  newGame,
  recordEdit,
  StaleWorldIdError,
  status,
} from "../active-world";
import { FakeActiveWorldDb } from "./fake-db";

const USER = "user-1";

describe("loadWorld", () => {
  it("auto-provisions a fresh-seed, empty-delta world on first load", async () => {
    const db = new FakeActiveWorldDb();

    const loaded = await loadWorld(db, USER, () => "minted-seed");

    expect(loaded.seed).toBe("minted-seed");
    expect(loaded.version).toBe(1);
    expect(loaded.deltas).toEqual([]);
    expect(loaded.worldId).toEqual(expect.any(String));
  });

  it("reuses the existing world on reload and never re-mints its seed", async () => {
    const db = new FakeActiveWorldDb();
    const first = await loadWorld(db, USER, () => "seed-A");

    const second = await loadWorld(db, USER, () => "seed-B");

    expect(second.worldId).toBe(first.worldId);
    expect(second.seed).toBe("seed-A");
    expect(second.version).toBe(first.version);
  });

  it("provisions independent worlds for different users", async () => {
    const db = new FakeActiveWorldDb();

    const a = await loadWorld(db, "user-a", () => "seed-a");
    const b = await loadWorld(db, "user-b", () => "seed-b");

    expect(a.worldId).not.toBe(b.worldId);
    expect(a.seed).toBe("seed-a");
    expect(b.seed).toBe("seed-b");
  });
});

describe("recordEdit", () => {
  it("rejects a worldId that doesn't match the caller's active world", async () => {
    const db = new FakeActiveWorldDb();
    await loadWorld(db, USER, () => "seed-A");

    await expect(
      recordEdit(db, {
        userId: USER,
        worldId: "not-the-real-id",
        command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
      }),
    ).rejects.toThrow(StaleWorldIdError);
  });

  it("rejects when the user has no world at all yet", async () => {
    const db = new FakeActiveWorldDb();

    await expect(
      recordEdit(db, {
        userId: USER,
        worldId: "world-1",
        command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
      }),
    ).rejects.toThrow(StaleWorldIdError);
  });

  it("breaking a base-solid voxel upserts a reconstructable delta", async () => {
    const db = new FakeActiveWorldDb();
    const { worldId, seed } = await loadWorld(db, USER, () => "seed-A");

    const result = await recordEdit(db, {
      userId: USER,
      worldId,
      command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
    });

    expect(result.changed).toEqual(["0,0,0"]);

    const reloaded = await loadWorld(db, USER);
    expect(reloaded.deltas).toHaveLength(1);

    const world = hydrateWorld(seed, reloaded.deltas);
    expect(world.getBlock(0, 0, 0)).toBe(BlockType.Air);
  });

  it("two edits to the same chunk accumulate (recompute from stored state)", async () => {
    const db = new FakeActiveWorldDb();
    const { worldId, seed } = await loadWorld(db, USER, () => "seed-A");

    await recordEdit(db, {
      userId: USER,
      worldId,
      command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
    });
    await recordEdit(db, {
      userId: USER,
      worldId,
      command: { type: "BreakBlock", at: { x: 1, y: 0, z: 0 } },
    });

    const reloaded = await loadWorld(db, USER);
    // Both edits land in the same chunk ("0,0,0"), so only one delta row —
    // but it must carry BOTH edits, not just the most recent one.
    expect(reloaded.deltas).toHaveLength(1);

    const world = hydrateWorld(seed, reloaded.deltas);
    expect(world.getBlock(0, 0, 0)).toBe(BlockType.Air);
    expect(world.getBlock(1, 0, 0)).toBe(BlockType.Air);
  });

  it("reverting a chunk back to its base state deletes the delta row", async () => {
    const db = new FakeActiveWorldDb();
    const { worldId } = await loadWorld(db, USER, () => "seed-A");

    await recordEdit(db, {
      userId: USER,
      worldId,
      command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
    });
    const midway = await loadWorld(db, USER);
    expect(midway.deltas).toHaveLength(1);

    // Place the same block back -> chunk matches its seeded base again.
    await recordEdit(db, {
      userId: USER,
      worldId,
      command: {
        type: "PlaceBlock",
        at: { x: 0, y: 0, z: 0 },
        block: BlockType.Stone,
      },
    });

    const reloaded = await loadWorld(db, USER);
    expect(reloaded.deltas).toHaveLength(0);
  });

  it("bumps the world version on each successful edit", async () => {
    const db = new FakeActiveWorldDb();
    const { worldId } = await loadWorld(db, USER, () => "seed-A");

    const first = await recordEdit(db, {
      userId: USER,
      worldId,
      command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
    });
    const second = await recordEdit(db, {
      userId: USER,
      worldId,
      command: { type: "BreakBlock", at: { x: 1, y: 0, z: 0 } },
    });

    expect(second.version).toBeGreaterThan(first.version);
  });
});

describe("status", () => {
  it("returns null when the user has no active world", async () => {
    const db = new FakeActiveWorldDb();

    await expect(status(db, USER)).resolves.toBeNull();
  });

  it("returns cheap metadata for an existing world", async () => {
    const db = new FakeActiveWorldDb();
    const { worldId, seed } = await loadWorld(db, USER, () => "seed-A");

    const result = await status(db, USER);

    expect(result).toMatchObject({ worldId, seed, version: 1 });
    expect(result?.updatedAt).toBeInstanceOf(Date);
  });
});

describe("newGame", () => {
  it("atomically purges the old world and reseeds with empty deltas", async () => {
    const db = new FakeActiveWorldDb();
    const original = await loadWorld(db, USER, () => "seed-A");
    await recordEdit(db, {
      userId: USER,
      worldId: original.worldId,
      command: { type: "BreakBlock", at: { x: 0, y: 0, z: 0 } },
    });

    const fresh = await newGame(db, USER, () => "seed-B");

    expect(fresh.worldId).not.toBe(original.worldId);
    expect(fresh.seed).toBe("seed-B");

    const reloaded = await loadWorld(db, USER);
    expect(reloaded.worldId).toBe(fresh.worldId);
    expect(reloaded.seed).toBe("seed-B");
    expect(reloaded.deltas).toEqual([]);
  });

  it("reseeds even a user with no prior world", async () => {
    const db = new FakeActiveWorldDb();

    const fresh = await newGame(db, USER, () => "seed-only");

    expect(fresh.seed).toBe("seed-only");
    const reloaded = await loadWorld(db, USER);
    expect(reloaded.worldId).toBe(fresh.worldId);
  });
});
