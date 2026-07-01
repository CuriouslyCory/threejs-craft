# 0001. Multiplayer persistence stores only edit-deltas over the seeded base

## Status

Accepted

## Context

The game world (`src/game/worldgen.ts`'s `generateWorld`) is generated
entirely deterministically from a `seed` string: terrain, tree placement,
and every other procedural decision comes from an `Rng` seeded once at
generation time, with no ambient state (no `Math.random`, no `Date.now`, no
I/O). The same seed always produces a byte-identical `World`.

#10 establishes the seams a future multiplayer backend needs — a frozen
`Command`/`CommandResult` Zod contract, a stub `worldRouter`, and an
identity-adapter `RemoteWorldSource` — but deliberately does **not** build
real persistence, transport, or auth. That work needs a storage model
decided in advance so the seams built now (the wire schema, the router
shape, the `WorldSource` interface) don't have to be reworked once
persistence lands.

The alternative to what's decided below — persisting the full voxel grid
per world/session — is straightforward but wasteful: most of every world is
exactly what `generateWorld(seed)` already produces for free, and a 48³
(or larger) voxel grid stored in full, per world, does not scale as worlds
or player counts grow.

## Decision

Future multiplayer persistence will store **only edit-deltas** over the
seeded procedural base, not the full world state:

- The base terrain is never persisted. Given a world's `seed`, any server
  (or client) regenerates the identical base deterministically by calling
  `generateWorld({ seed })` — the same guarantee `worldgen.ts` already
  provides today.
- Only **touched chunks** — chunks that have received at least one
  successful `BreakBlock`/`PlaceBlock` `Command` (per the frozen
  `CommandResult.changed` chunk-key list in `src/game/command.ts`) — are
  persisted, each as a compact `Bytes` blob (a serialized diff of that
  chunk's voxels against its freshly-regenerated base state), keyed by the
  chunk's `ChunkKey` (`src/game/coords.ts`).
- Loading a world becomes: regenerate the base from `seed`, then apply the
  stored per-chunk `Bytes` deltas on top, in chunk-key order, to reach the
  current authoritative state.
- This issue (#10) establishes the seams only — the shared `Command`/
  `CommandResult` Zod schema, the stub `worldRouter`, and the
  `LocalWorldSource`/`RemoteWorldSource` swap — so that a later issue can
  implement this storage model behind those seams without changing them
  again.

## Consequences

- **Storage scales with player activity, not world size.** An untouched
  world costs zero persisted bytes beyond its `seed` string; cost grows
  only with the chunks players actually edit.
- **The `seed` becomes part of a world's identity and must never silently
  change** for a world with existing persisted deltas — regenerating the
  base with a different seed invalidates every stored delta's meaning
  (they'd be diffs against the wrong base).
- **Base-generation determinism is now a hard persistence invariant, not
  just a nice property.** Any future change to `generateWorld` (terrain
  rules, tree placement, RNG algorithm) that isn't seed-gated will silently
  corrupt every previously-persisted world; changes to world generation
  must ship as a new seed/version, never as a same-seed behavior change.
- **Chunk-level granularity is the unit of both dirtiness and storage** —
  this reuses, rather than redefines, the `ChunkKey`/`CommandResult.changed`
  concept #8 already introduced for render-side dirty tracking, so the
  persistence layer and the render layer agree on what "a chunk changed"
  means.
- **This ADR does not implement storage.** No database schema, no `Bytes`
  column, no delta-encoding format is defined here — only the shape future
  work must take. The stub `worldRouter.applyEdit` (#10) continues to
  return a typed `NOT_IMPLEMENTED` until that follow-up work lands.
