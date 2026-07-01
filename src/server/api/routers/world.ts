/**
 * Stub multiplayer world router (#10). Establishes the seam a real
 * multiplayer backend will fill in later — it validates a `Command` through
 * the shared wire schema (`~/game/command-schema`) and honestly reports
 * that applying it isn't implemented yet. No persistence, no transport, no
 * auth-gating: this issue proves the contract is additive, not that a
 * server exists.
 *
 * `meta` mirrors the fixed seed the client's composition root
 * (`src/app/game/game-scene.tsx`'s `WORLD_CONFIG.seed`) currently generates
 * the world from — kept as its own literal here (not imported from
 * `game-scene.tsx`, which is a client component) so this file stays
 * server/render-free. When real world persistence lands (see
 * `docs/adr/0001-multiplayer-persistence-edit-deltas.md`), this becomes the
 * seed a stored world was generated from, not a hardcoded stub.
 */

import { z } from "zod";

import { CommandSchema } from "~/game/command-schema";
import { DEFAULT_WORLD_SIZE } from "~/game/worldgen";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/** Must match `game-scene.tsx`'s `WORLD_CONFIG.seed` until a real world
 *  store replaces this stub. */
const STUB_SEED = "threejs-craft-static-world-v1";

const StubMetaSchema = z.object({
  size: z.number(),
  /** Bumped whenever this stub's shape changes; unrelated to any real
   *  world-format version. */
  version: z.literal(1),
});

export type WorldMeta = z.infer<typeof StubMetaSchema>;

/** The typed "validated, not implemented" result `applyEdit` returns for
 *  every otherwise-valid `Command`. Distinct from the frozen
 *  `CommandResult`'s four rejection reasons (`OutOfRange`/`TargetIsAir`/
 *  `Occupied`/`NotInInventory`) — those describe a *validated-and-rejected*
 *  gameplay command, whereas this describes "the server seam exists but
 *  nothing is wired up behind it yet". Keeping them separate means a real
 *  implementation can't accidentally satisfy tests by returning a gameplay
 *  rejection instead of actually applying the command. */
export interface NotImplementedResult {
  readonly ok: false;
  readonly reason: "NOT_IMPLEMENTED";
}

export const worldRouter = createTRPCRouter({
  /** Stub world metadata: the seed the (client-generated) world uses, plus
   *  a small stub `meta` object. No server-side world state backs this
   *  yet — see the ADR for the planned edit-delta persistence model. */
  meta: publicProcedure.query(() => {
    return {
      seed: STUB_SEED,
      meta: StubMetaSchema.parse({ size: DEFAULT_WORLD_SIZE, version: 1 }),
    };
  }),

  /** Validates `input` against the shared `CommandSchema` (throwing tRPC's
   *  usual validation error on a malformed command) and then honestly
   *  reports that applying it server-side isn't implemented — no fake
   *  success, no DB writes. */
  applyEdit: publicProcedure
    .input(CommandSchema)
    .mutation((): NotImplementedResult => {
      return { ok: false, reason: "NOT_IMPLEMENTED" };
    }),
});
