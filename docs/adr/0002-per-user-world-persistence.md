# 0002. Per-user world persistence: single active `SavedWorld`

## Status

Accepted

## Context

ADR-0001 decided *what* is persisted (edit-deltas over a seeded base, keyed
by chunk). This ADR decides *whose* world is persisted, and how many worlds
a user can have.

The router (`src/server/api/routers/world.ts`) is `protectedProcedure`-gated
(#19), so every request already carries an authenticated `userId`
(`ctx.session.user.id`). The simplest shape that satisfies "each signed-in
player resumes the world they left" is one row per user: `SavedWorld.userId
String @unique`, with its `ChunkDelta` children keyed by
`(savedWorldId, chunkKey)`.

## Decision

`SavedWorld.userId` is `@unique` — **exactly one active world per user**.
`loadWorld` auto-provisions this row (fresh minted seed, empty deltas) the
first time a user is seen; `newGame` (ADR-0003) atomically purges it and
reseeds a new one. There is no concept of "multiple saved worlds" or
"switching between saves" in this data model — a user has one active world,
full stop.

### Decision D1: the server applies only the command's voxel mutation

`recordEdit` (`src/server/world/active-world.ts`) reconstructs the world
from its seed + stored deltas (`hydrateWorld`), then applies **only**
`Command`'s literal voxel mutation:

- `BreakBlock` -> set `Air` at `command.at`.
- `PlaceBlock` -> set `command.block` at `command.at`.

It deliberately does **not** re-run `src/game/command.ts`'s `canBreak`/
`canPlace` reach/inventory gating. Doing so would require the server to
also persist (or receive, per-request) the player's inventory and world
position — both explicitly out of scope for #19 (and not part of ADR-0001's
edit-delta model at all). The authenticated client is trusted for gameplay
validity (reach, inventory, no-clip); this layer's job is persistence
integrity only: recomputing the correct delta for the touched chunk,
accumulating repeated edits correctly, and pruning a chunk's row back to
nothing when it reverts to its base state.

**Alternative rejected:** full server-side `applyCommand` re-validation
(reusing `src/game/command.ts` as-is). This was rejected because it would
require persisting/transmitting inventory and player-position state on
every edit purely to satisfy validation this issue has no other use for —
a materially bigger change than "persist the edit-deltas" for a gain (server
-side anti-cheat) that isn't this issue's goal. If gameplay-integrity
enforcement (not just persistence-integrity) becomes a requirement later,
revisit this decision alongside real inventory/position persistence.

## Consequences

- **Signed-out play has no persistence.** The router is fully
  `protectedProcedure`; there is no anonymous/guest `SavedWorld`. This is
  consistent with #19's scope (server-side persistence "behind
  `protectedProcedure`") and unrelated to whether the client can still play
  offline against a local, unpersisted world (a client-wiring concern, #20).
- **A malicious or buggy client can still desync the server's own record of
  the world** (e.g. break a block it wasn't in reach of) — D1 accepts this;
  the server is the source of truth for *what got persisted*, not for
  *whether the client should have been allowed to do it*.
- **Cascading deletes are load-bearing.** `SavedWorld.user` and
  `ChunkDelta.savedWorld` both use `onDelete: Cascade`, so deleting a `User`
  or a `SavedWorld` never leaves orphaned rows.

## OPEN — flagged for reviewer sign-off

A more multiplayer-friendly shape — `World { id, ownerId, seed, ... }`
(many worlds, potentially shared/joinable, `ownerId` instead of a
`@unique` `userId`) — is **deliberately not baked in** here. `SavedWorld
.userId @unique` is the narrower, simpler shape that satisfies #19's actual
requirement (one save per signed-in player); it is intentionally not
future-proofed against a shared/multiplayer-world feature that doesn't
exist yet. If/when that feature is scoped, this ADR's decision should be
revisited (likely superseded) rather than the current shape stretched to
fit it. Flagging this explicitly for reviewer accept/reject at PR time.

## References

- ADR-0001 (`0001-multiplayer-persistence-edit-deltas.md`) — the storage
  model this ADR assigns ownership over.
- ADR-0003 (`0003-new-game-fresh-seed.md`) — how a user's single
  `SavedWorld` gets reseeded.
