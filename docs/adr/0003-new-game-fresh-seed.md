# 0003. "New Game" mints a fresh seed via atomic purge-then-reseed

## Status

Accepted

## Context

ADR-0002 gives each user exactly one active `SavedWorld`. A "New Game"
action needs to replace that world with an entirely new one — the whole
point is a different, unedited world to start over in, not a way to reset
the current world's edits back to its own base.

`src/server/world/active-world.ts`'s `newGame(db, userId, mintSeed?)` is the
sole implementation of this action.

## Decision

`newGame` runs inside a single `$transaction`, in this order:

1. **Delete** the user's current `SavedWorld` row. This cascades (`ChunkDelta
   .savedWorld`'s `onDelete: Cascade`) to purge every one of its stored
   chunk deltas in the same operation.
2. **Insert** a fresh `SavedWorld` row for the same user, with a newly
   minted seed (`mintSeed`, defaulting to `crypto.randomUUID()` — real
   server entropy, injectable so tests can control the seed
   deterministically).

Doing the delete and the insert inside one transaction, in that order,
means a fresh seed can never land on top of surviving deltas from the old
world: either both steps commit (clean purge + clean reseed) or neither
does (the old world, deltas and all, is untouched). There is no
intermediate state where a new seed exists in the same row alongside old
deltas that would now decode against the wrong base.

## Consequences

- **"New Game" is destructive and irreversible.** The old world's edit
  history is gone the moment the transaction commits — there is no undo,
  no archive of past worlds (consistent with ADR-0002's "exactly one active
  world per user").
- **The seed is the only source of a new game's identity.** Nothing else
  (spawn point, world size) is parameterized by `newGame`; a different seed
  through the same deterministic `generateWorld` (ADR-0001) is what makes
  the new world different from the old one.
- **`mintSeed`'s injectability keeps `newGame`'s own logic deterministic and
  unit-testable** (`src/server/world/__tests__/active-world.test.ts`)
  without needing real entropy in tests, while the router
  (`src/server/api/routers/world.ts`) still gets real randomness by relying
  on the default.

## References

- ADR-0001 (`0001-multiplayer-persistence-edit-deltas.md`) — why the seed
  alone (plus deltas) fully determines a world.
- ADR-0002 (`0002-per-user-world-persistence.md`) — the single-active-
  `SavedWorld`-per-user shape this operation replaces wholesale.
