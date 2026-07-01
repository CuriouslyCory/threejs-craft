/**
 * Shared Zod wire-schema for the frozen `Command`/`CommandResult` contract
 * (`src/game/command.ts`, #8/#9). Deliberately its own module — not folded
 * into `command.ts` — so server code (`src/server/api/routers/world.ts`,
 * #10) can `import` this without pulling in `command.ts`'s transitive
 * dependency on `~/game/player/step-player` and friends. Those modules are
 * pure TS today, but this file is the one place a future server-only
 * consumer is guaranteed a render-free import.
 *
 * `command.ts`'s `Command`/`CommandResult` types are FROZEN (#8/#9) — this
 * schema must mirror them exactly, not redefine them. The compile-time
 * assertions at the bottom of this file are what enforce that: if either
 * type drifts from the schema below, `pnpm typecheck`/`pnpm build` goes red.
 */

import { z } from "zod";

import { BlockType, type BlockTypeId } from "~/game/blocks";
import type { Command, CommandResult, RejectReason } from "~/game/command";

/** Mirrors `Vec3` (`src/game/player/aabb.ts`) — a plain world-space point. */
export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

/**
 * Mirrors `BlockTypeId`/`BlockType` (`src/game/blocks.ts`): every canonical
 * block id, spelled out as literals (not derived via `Object.values` +
 * `.map`, and deliberately NOT annotated as `z.ZodType<BlockTypeId>` — an
 * explicit widening annotation would make `z.infer` echo back the
 * annotation instead of the schema's real inferred shape, silently
 * defeating the parity check below if a literal were ever dropped). Left
 * to plain inference, this is the literal union `0 | 1 | 2 | 3 | 4 | 5`.
 */
export const BlockTypeSchema = z.union([
  z.literal(BlockType.Air),
  z.literal(BlockType.Grass),
  z.literal(BlockType.Dirt),
  z.literal(BlockType.Stone),
  z.literal(BlockType.Wood),
  z.literal(BlockType.Leaves),
]);

const BreakBlockSchema = z.object({
  type: z.literal("BreakBlock"),
  at: Vec3Schema,
});

const PlaceBlockSchema = z.object({
  type: z.literal("PlaceBlock"),
  at: Vec3Schema,
  block: BlockTypeSchema,
});

/** Mirrors `Command` (`src/game/command.ts`): `BreakBlock` | `PlaceBlock`. */
export const CommandSchema = z.discriminatedUnion("type", [
  BreakBlockSchema,
  PlaceBlockSchema,
]);

/** Mirrors `ChunkKey` (`src/game/coords.ts`) — a plain string under the hood. */
export const ChunkKeySchema = z.string();

/** Mirrors `RejectReason` (`src/game/command.ts`) — the four frozen literal
 *  rejection reasons, spelled out the same un-annotated way as
 *  `BlockTypeSchema` above so the inferred type stays the exact literal
 *  union rather than the (unchecked) widened `RejectReason` itself. */
export const RejectReasonSchema = z.union([
  z.literal("OutOfRange"),
  z.literal("TargetIsAir"),
  z.literal("Occupied"),
  z.literal("NotInInventory"),
]);

const CommandResultOkSchema = z.object({
  ok: z.literal(true),
  // `.readonly()` matters here, not just stylistically: `CommandResult`'s
  // `changed` field is `readonly ChunkKey[]`, and TS (unlike with object
  // properties) does NOT consider a mutable array type assignable to a
  // readonly one — dropping `.readonly()` breaks the type-parity assertion
  // at the bottom of this file.
  changed: z.array(ChunkKeySchema).readonly(),
  drop: BlockTypeSchema.optional(),
});

const CommandResultErrSchema = z.object({
  ok: z.literal(false),
  reason: RejectReasonSchema,
});

/** Mirrors `CommandResult` (`src/game/command.ts`): the ok/err union with
 *  the four frozen rejection reasons. */
export const CommandResultSchema = z.discriminatedUnion("ok", [
  CommandResultOkSchema,
  CommandResultErrSchema,
]);

// --- Compile-time type-parity assertions --------------------------------
//
// `Command`/`CommandResult` are frozen TS types (#8/#9); this file's job is
// to mirror them in Zod, not to redefine them. These assertions are the
// enforcement mechanism: each checks that the Zod-inferred type and the
// frozen domain type are mutually assignable (structurally identical). If
// either type is edited — e.g. a rejection `reason` is added/removed from
// `CommandResult`, or a `Command` variant's fields change — one of the two
// `extends` checks below fails, `AssertX` collapses to `false`, and
// assigning `true` to it is a type error: `pnpm typecheck`/`pnpm build`
// goes red until the schema and the frozen type agree again.
// `[A]`/`[B]` tuple-wrapping is load-bearing, not stylistic: with a bare
// `A extends B ? ... : ...`, a union `A` (e.g. `RejectReason` missing a
// literal) makes the conditional distribute over each union member, and the
// combined result of a distributed conditional can collapse to `boolean`
// instead of `false` — at which point `true` (assignable to `boolean`)
// silently passes the assertions below even when the types have drifted.
// Wrapping both sides in one-tuples suppresses distribution so `IsExact`
// evaluates as a single, non-distributed check.
type IsExact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

type AssertBlockTypeParity = IsExact<
  z.infer<typeof BlockTypeSchema>,
  BlockTypeId
>;
export const blockTypeSchemaMatchesBlockTypeId: AssertBlockTypeParity = true;

type AssertRejectReasonParity = IsExact<
  z.infer<typeof RejectReasonSchema>,
  RejectReason
>;
export const rejectReasonSchemaMatchesRejectReason: AssertRejectReasonParity =
  true;

type AssertCommandParity = IsExact<z.infer<typeof CommandSchema>, Command>;
export const commandSchemaMatchesCommandType: AssertCommandParity = true;

type AssertCommandResultParity = IsExact<
  z.infer<typeof CommandResultSchema>,
  CommandResult
>;
export const commandResultSchemaMatchesCommandResultType: AssertCommandResultParity =
  true;
