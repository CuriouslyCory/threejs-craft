/**
 * Pure per-user "active world" persistence logic (#19): loads/creates a
 * user's single active `SavedWorld`, and applies + persists edit-deltas to
 * it.
 *
 * Every function here takes `db` as an explicit parameter — a minimal
 * structural slice of the generated Prisma Client (see `ActiveWorldDb`
 * below) — rather than importing `~/server/db` directly, so this module
 * unit-tests against a plain in-memory fake `db` with no real
 * Postgres/Prisma involved (see `__tests__/active-world.test.ts`). The real
 * `PrismaClient` (`~/server/db`) satisfies `ActiveWorldDb` structurally; the
 * router (`~/server/api/routers/world.ts`) is the only place that wires the
 * real thing in, and is also where the base64/`Buffer` boundary lives —
 * this module stays in `Uint8Array`, same as `src/game/persistence/**`.
 *
 * Reuses #18's pure `src/game/persistence/world-delta.ts`
 * (`hydrateWorld`/`computeChunkDelta`) and `chunk-delta.ts`
 * (`isEmptyChunkDelta`).
 *
 * See `docs/adr/0001-multiplayer-persistence-edit-deltas.md` (storage
 * model), `docs/adr/0002-per-user-world-persistence.md` (single active
 * world/user + Decision D1 — server applies only the voxel mutation, no
 * reach/inventory re-validation), and `docs/adr/0003-new-game-fresh-seed.md`
 * (purge-then-reseed).
 */

import { BlockType } from "~/game/blocks";
import type { Command } from "~/game/command";
import { chunkKey, worldToChunkCoord, type ChunkKey } from "~/game/coords";
import { isEmptyChunkDelta } from "~/game/persistence/chunk-delta";
import {
  computeChunkDelta,
  hydrateWorld,
  type ChunkDeltaRecord,
} from "~/game/persistence/world-delta";
import type { World } from "~/game/world";

/** A `SavedWorld` row as read from `db.savedWorld`. */
export interface SavedWorldRow {
  readonly id: string;
  readonly userId: string;
  readonly seed: string;
  readonly version: number;
  readonly updatedAt: Date;
}

/** A `ChunkDelta` row as read from `db.chunkDelta`. `data` is whatever
 *  byte-array-like value the store returns — real Prisma hands back a
 *  `Buffer`, the fake test db a plain `Uint8Array`; both are read the same
 *  way here since `Buffer` is a `Uint8Array`. */
export interface ChunkDeltaRow {
  readonly savedWorldId: string;
  readonly chunkKey: string;
  readonly data: Uint8Array;
}

/**
 * The minimal structural slice of a Prisma-Client-shaped `db` this module
 * needs, MINUS `$transaction` itself — this is what an interactive
 * transaction's callback receives (Prisma's own `Prisma.TransactionClient`
 * shape doesn't expose `$transaction` either; nested transactions aren't a
 * thing). Keeping this split from `ActiveWorldDb` means the type system
 * (not just convention) rules out accidentally calling `tx.$transaction(...)`
 * from inside an already-open transaction.
 */
export interface ActiveWorldTx {
  savedWorld: {
    findUnique(args: {
      where: { userId: string };
    }): Promise<SavedWorldRow | null>;
    /** Atomic get-or-create by `userId` (backed by the `userId @unique`
     *  constraint): returns the existing row untouched if one exists
     *  (`update` is always `{}` — no-op — from every current call site),
     *  or atomically inserts `create`'s row if not. Prefer this over a
     *  `findUnique` + `create` pair for provisioning: that pair has a
     *  check-then-act race between two concurrent first-loads for the same
     *  user, which this upsert (a single `INSERT ... ON CONFLICT` at the
     *  DB level for the real Prisma client) does not. */
    upsert(args: {
      where: { userId: string };
      create: { userId: string; seed: string };
      update: Record<string, never>;
    }): Promise<SavedWorldRow>;
    /** Mirrors the `userId @unique` constraint: real Prisma rejects a
     *  second `create` for a `userId` that already has a row. Only
     *  `newGame` uses this, always immediately after `deleteMany` purges
     *  any existing row for the same user. */
    create(args: {
      data: { userId: string; seed: string };
    }): Promise<SavedWorldRow>;
    update(args: {
      where: { id: string };
      data: { version: { increment: number } };
    }): Promise<SavedWorldRow>;
    deleteMany(args: {
      where: { userId: string };
    }): Promise<{ count: number }>;
  };
  chunkDelta: {
    findMany(args: {
      where: { savedWorldId: string };
    }): Promise<ChunkDeltaRow[]>;
    upsert(args: {
      where: {
        savedWorldId_chunkKey: { savedWorldId: string; chunkKey: string };
      };
      // The real generated Prisma client's `Bytes` column input requires a
      // concretely `ArrayBuffer`-backed byte array (not the wider
      // `ArrayBufferLike`, which also covers `SharedArrayBuffer`) — matched
      // here so this interface stays structurally assignable from the real
      // `PrismaClient`. `Buffer` (used at the call site in `recordEdit`)
      // satisfies this.
      create: {
        savedWorldId: string;
        chunkKey: string;
        data: Uint8Array<ArrayBuffer>;
      };
      update: { data: Uint8Array<ArrayBuffer> };
    }): Promise<ChunkDeltaRow>;
    deleteMany(args: {
      where: { savedWorldId: string; chunkKey: string };
    }): Promise<{ count: number }>;
  };
}

/**
 * The minimal structural slice of a Prisma-Client-shaped `db` this module
 * needs, including the interactive-transaction callback shape Prisma's
 * `$transaction` supports. The real generated `PrismaClient`
 * (`~/server/db`) satisfies this structurally without any adapter code;
 * tests pass a plain in-memory fake instead — see `__tests__/`.
 */
export interface ActiveWorldDb extends ActiveWorldTx {
  $transaction<T>(fn: (tx: ActiveWorldTx) => Promise<T>): Promise<T>;
}

/** Real server entropy for a fresh world's seed — injectable (every
 *  exported function below defaults to this but accepts an override) so
 *  worldgen stays pure/deterministic in tests. */
const defaultMintSeed = (): string => crypto.randomUUID();

/** What `loadWorld` returns: enough to hydrate the world, plus the
 *  identity/version a later `applyEdit`/`status` call echoes back. */
export interface LoadedWorld {
  readonly worldId: string;
  readonly seed: string;
  readonly version: number;
  readonly deltas: readonly ChunkDeltaRecord[];
}

function toChunkDeltaRecord(row: ChunkDeltaRow): ChunkDeltaRecord {
  return { chunkKey: row.chunkKey, data: row.data };
}

/**
 * Load the caller's single active `SavedWorld`, auto-provisioning one with
 * a freshly minted seed (and no deltas) if they don't have one yet. Never
 * re-mints a seed for an existing world — the seed is part of a world's
 * identity (ADR-0001) and must stay fixed for its stored deltas to keep
 * meaning what they meant when they were written.
 *
 * Uses `savedWorld.upsert` (not a `findUnique` + `create` pair) so two
 * concurrent first-loads for the same user can't race each other into
 * violating the `userId @unique` constraint — the `update: {}` (a
 * deliberate no-op) is what guarantees an *existing* row is returned
 * untouched rather than re-seeded.
 */
export async function loadWorld(
  db: ActiveWorldDb,
  userId: string,
  mintSeed: () => string = defaultMintSeed,
): Promise<LoadedWorld> {
  const world = await db.savedWorld.upsert({
    where: { userId },
    create: { userId, seed: mintSeed() },
    update: {},
  });
  const rows = await db.chunkDelta.findMany({
    where: { savedWorldId: world.id },
  });
  return {
    worldId: world.id,
    seed: world.seed,
    version: world.version,
    deltas: rows.map(toChunkDeltaRecord),
  };
}

/**
 * Thrown by `recordEdit` when `worldId` doesn't match the caller's current
 * active world (e.g. a `New Game` purged/reseeded it after the client last
 * loaded, and the client is still queuing edits addressed to the old
 * world). Kept distinct from a generic `Error` so the router can translate
 * it to a specific tRPC error code instead of a bare internal-server-error.
 */
export class StaleWorldIdError extends Error {
  constructor(userId: string, worldId: string) {
    super(
      `worldId "${worldId}" is not the active SavedWorld for user "${userId}"`,
    );
    this.name = "StaleWorldIdError";
  }
}

/**
 * Apply only `command`'s voxel mutation to `world` — Decision D1 (see
 * `docs/adr/0002-per-user-world-persistence.md`): `BreakBlock` sets `Air`
 * at `command.at`; `PlaceBlock` sets `command.block` at `command.at`. This
 * deliberately does NOT re-run `src/game/command.ts`'s `canBreak`/
 * `canPlace` reach/inventory gating — inventory and player position are not
 * persisted server-side (out of scope), so there is nothing correct to gate
 * against here. The authenticated client is trusted for gameplay validity;
 * this layer owns persistence integrity (accumulation, revert-to-base
 * pruning) only. Returns the chunk key the mutation touched.
 */
function applyVoxelMutation(world: World, command: Command): ChunkKey {
  const blockId =
    command.type === "BreakBlock" ? BlockType.Air : command.block;
  const { x, y, z } = command.at;
  world.setBlock(x, y, z, blockId);
  const { cx, cy, cz } = worldToChunkCoord(x, y, z);
  return chunkKey(cx, cy, cz);
}

export interface RecordEditInput {
  readonly userId: string;
  readonly worldId: string;
  readonly command: Command;
}

/** What `recordEdit` returns: the world's identity/version after applying
 *  the edit, plus the chunk key(s) it touched (mirrors `CommandResult`'s
 *  `changed` field from `src/game/command.ts`). */
export interface RecordEditResult {
  readonly worldId: string;
  readonly seed: string;
  readonly version: number;
  readonly changed: readonly ChunkKey[];
}

/**
 * Apply `command` to the caller's active world and persist the result,
 * inside a `$transaction` (so load-authorize-hydrate-recompute-write is
 * atomic per edit).
 *
 * Recomputes the touched chunk's delta from the *stored* state (hydrate
 * from the currently-stored deltas, apply the mutation, re-diff against the
 * seeded base) rather than from the seeded base directly — that's what
 * makes repeated edits to the same chunk accumulate instead of each one
 * clobbering the last (the "lost update" a naive base-relative recompute
 * would cause).
 *
 * Reverting a chunk back to its base state (e.g. placing then breaking the
 * same block) deletes that chunk's `ChunkDelta` row rather than storing an
 * empty one — `isEmptyChunkDelta` is the trigger.
 *
 * Throws `StaleWorldIdError` if `worldId` doesn't match the caller's
 * current active world.
 *
 * Known limitation: this guards SEQUENTIAL edits (accumulation, revert-
 * pruning) against each other, but two *concurrent* `recordEdit` calls for
 * the same chunk can still race — the transaction's default isolation
 * level lets both read the same pre-edit `ChunkDelta` rows before either
 * writes, so the second write can clobber the first (a classic lost
 * update). Closing that fully needs either a stricter transaction
 * isolation level with retry, or per-world row locking; neither is in
 * place yet. For a single-player-focused persistence layer (#19's scope —
 * see ADR-0002) the practical exposure is a double-submitted request from
 * the same client, not genuine multiplayer contention; flagged here for a
 * future hardening pass rather than solved now.
 */
export async function recordEdit(
  db: ActiveWorldDb,
  input: RecordEditInput,
): Promise<RecordEditResult> {
  return db.$transaction(async (tx) => {
    const world = await tx.savedWorld.findUnique({
      where: { userId: input.userId },
    });
    if (world?.id !== input.worldId) {
      throw new StaleWorldIdError(input.userId, input.worldId);
    }

    const rows = await tx.chunkDelta.findMany({
      where: { savedWorldId: world.id },
    });
    const hydrated = hydrateWorld(world.seed, rows.map(toChunkDeltaRecord));

    const changedKey = applyVoxelMutation(hydrated, input.command);
    const { cx, cy, cz } = worldToChunkCoord(
      input.command.at.x,
      input.command.at.y,
      input.command.at.z,
    );
    // `applyVoxelMutation` always writes through `World.setBlock`, which
    // creates the containing chunk on demand — so it is guaranteed to exist
    // here regardless of whether it existed before this edit.
    const chunk = hydrated.getChunk(cx, cy, cz);
    const snapshot = chunk ? chunk.snapshot() : new Uint8Array(0);
    const delta = computeChunkDelta(world.seed, changedKey, snapshot);

    if (isEmptyChunkDelta(delta)) {
      await tx.chunkDelta.deleteMany({
        where: { savedWorldId: world.id, chunkKey: changedKey },
      });
    } else {
      // `Buffer.from(delta)` at this DB-write boundary: `computeChunkDelta`
      // hands back a plain `Uint8Array` (this module stays `Uint8Array`-in/
      // out, same as `src/game/persistence/**`, per the module doc
      // comment), but the real generated Prisma client's `Bytes` column
      // input wants a concretely `ArrayBuffer`-backed byte array — `Buffer`
      // (Node-only, fine in this server-only file) satisfies that exactly.
      const dataForColumn = Buffer.from(delta);
      await tx.chunkDelta.upsert({
        where: {
          savedWorldId_chunkKey: {
            savedWorldId: world.id,
            chunkKey: changedKey,
          },
        },
        create: {
          savedWorldId: world.id,
          chunkKey: changedKey,
          data: dataForColumn,
        },
        update: { data: dataForColumn },
      });
    }

    const updated = await tx.savedWorld.update({
      where: { id: world.id },
      data: { version: { increment: 1 } },
    });

    return {
      worldId: updated.id,
      seed: updated.seed,
      version: updated.version,
      changed: [changedKey],
    };
  });
}

/** Cheap status/metadata read for the caller's active world — Save's
 *  confirm target. `null` if the user has no active world yet (unlike
 *  `loadWorld`, this does NOT auto-provision one). */
export interface WorldStatus {
  readonly worldId: string;
  readonly seed: string;
  readonly version: number;
  readonly updatedAt: Date;
}

export async function status(
  db: ActiveWorldDb,
  userId: string,
): Promise<WorldStatus | null> {
  const world = await db.savedWorld.findUnique({ where: { userId } });
  if (!world) {
    return null;
  }
  return {
    worldId: world.id,
    seed: world.seed,
    version: world.version,
    updatedAt: world.updatedAt,
  };
}

/**
 * "New Game": atomically purge the user's current `SavedWorld` (cascading
 * to its `ChunkDelta`s) and insert a fresh one with a newly minted seed —
 * see `docs/adr/0003-new-game-fresh-seed.md`. Doing the purge and the
 * reseed inside one `$transaction`, in that order, means a fresh seed can
 * never land on top of surviving deltas from the old world.
 *
 * Known limitation: two concurrent `newGame` calls for the *same* user
 * (e.g. a double-submitted request) both delete-then-insert, and the
 * second `create` can lose a race against the `userId @unique` constraint
 * — that request fails with a DB error rather than silently corrupting
 * state, but it isn't retried here. Closing that race fully would need a
 * per-user lock (e.g. a Postgres advisory lock) outside this module's
 * current Prisma-structural-typing design; out of scope for #19's single-
 * player-focused persistence layer, flagged here for any future
 * multiplayer-hardening pass.
 */
export async function newGame(
  db: ActiveWorldDb,
  userId: string,
  mintSeed: () => string = defaultMintSeed,
): Promise<WorldStatus> {
  return db.$transaction(async (tx) => {
    await tx.savedWorld.deleteMany({ where: { userId } });
    const created = await tx.savedWorld.create({
      data: { userId, seed: mintSeed() },
    });
    return {
      worldId: created.id,
      seed: created.seed,
      version: created.version,
      updatedAt: created.updatedAt,
    };
  });
}
