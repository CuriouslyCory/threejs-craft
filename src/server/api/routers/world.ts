/**
 * Real per-user world persistence router (#19), replacing #10's stub. Every
 * procedure is `protectedProcedure` — a signed-out caller gets `UNAUTHORIZED`
 * automatically (`~/server/api/trpc`'s `protectedProcedure` middleware),
 * before any of the business logic below ever runs.
 *
 * This router is thin: all the actual load/apply/reseed logic lives in the
 * pure, injected-`db` `~/server/world/active-world` module (unit-tested
 * there against a fake `db`, no Prisma involved). This file's own job is
 * the wire/DB boundary `active-world.ts` deliberately stays out of:
 *
 * - Wiring the real `ctx.db` (`~/server/db`'s `PrismaClient`) and
 *   `ctx.session.user.id` into `active-world.ts`'s functions.
 * - The wire-facing base64 encoding of `ChunkDelta.data` for `load`'s
 *   response (`toWireDelta` below). Internally, deltas are `Uint8Array`
 *   (`src/game/persistence/**`); over the wire they're base64 strings
 *   (superjson has no byte-array-friendly default). There's no reverse
 *   "base64 in" direction on this router: `applyEdit` takes a structured
 *   `Command`, not raw delta bytes, so `active-world.ts` computes the
 *   delta itself and converts it to a `Buffer` (a `Uint8Array`, so it
 *   satisfies the Prisma `data: Bytes` column) right at that write —
 *   see the DB-write-boundary comment in `recordEdit`.
 *
 * See `docs/adr/0001-multiplayer-persistence-edit-deltas.md` (storage
 * model), `docs/adr/0002-per-user-world-persistence.md` (single active
 * world/user + Decision D1), and `docs/adr/0003-new-game-fresh-seed.md`
 * (purge-then-reseed).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { CommandSchema } from "~/game/command-schema";
import type { ChunkDeltaRecord } from "~/game/persistence/world-delta";
import {
  loadWorld,
  newGame,
  recordEdit,
  StaleWorldIdError,
  status,
} from "~/server/world/active-world";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/** Wire shape for a single chunk's stored delta: base64-encoded bytes
 *  instead of the internal `Uint8Array`. */
interface ChunkDeltaWire {
  readonly chunkKey: string;
  readonly data: string;
}

function toWireDelta(record: ChunkDeltaRecord): ChunkDeltaWire {
  return {
    chunkKey: record.chunkKey,
    data: Buffer.from(record.data).toString("base64"),
  };
}

const ApplyEditInputSchema = z.object({
  worldId: z.string(),
  command: CommandSchema,
});

export const worldRouter = createTRPCRouter({
  /** Load (auto-provisioning if necessary) the caller's single active
   *  world: its id, seed, version, and every stored per-chunk delta
   *  (base64-encoded). */
  load: protectedProcedure.query(async ({ ctx }) => {
    const loaded = await loadWorld(ctx.db, ctx.session.user.id);
    return {
      worldId: loaded.worldId,
      seed: loaded.seed,
      version: loaded.version,
      deltas: loaded.deltas.map(toWireDelta),
    };
  }),

  /** Apply one `Command` to the caller's active world and persist the
   *  result. `worldId` is an envelope, not just an id: it must match the
   *  caller's *current* active world, so an edit queued before a `newGame`
   *  reseed is rejected rather than silently landing on the wrong world. */
  applyEdit: protectedProcedure
    .input(ApplyEditInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await recordEdit(ctx.db, {
          userId: ctx.session.user.id,
          worldId: input.worldId,
          command: input.command,
        });
        return {
          worldId: result.worldId,
          seed: result.seed,
          version: result.version,
          changed: result.changed,
        };
      } catch (error) {
        if (error instanceof StaleWorldIdError) {
          // Generic client-facing message: `error.message` itself embeds
          // the raw `userId`/`worldId` values, which is fine for server
          // logs (kept via `cause`) but shouldn't be echoed back to the
          // client verbatim.
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The active world changed (e.g. a New Game) since this edit was queued; reload before retrying.",
            cause: error,
          });
        }
        throw error;
      }
    }),

  /** "New Game": atomically purge the caller's current world (and its
   *  deltas) and reseed a fresh one. */
  newGame: protectedProcedure.mutation(async ({ ctx }) => {
    const fresh = await newGame(ctx.db, ctx.session.user.id);
    return {
      worldId: fresh.worldId,
      seed: fresh.seed,
      version: fresh.version,
    };
  }),

  /** Cheap status/metadata for the caller's active world — `null` if they
   *  don't have one yet (this does NOT auto-provision, unlike `load`). */
  status: protectedProcedure.query(async ({ ctx }) => {
    return status(ctx.db, ctx.session.user.id);
  }),
});
