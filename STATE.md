# Orchestration State: feat/world-persistence

Source of truth for this run. Update after every state change (plan saved, agent dispatched, gate passed, branch merged). If the run is interrupted, read this file first to resume.

- Integration branch: `feat/world-persistence`
- Base branch / final PR target: `main`
- PR model: `per-issue`
- Tracking context: GitHub issues #18, #19, #20, #21 (no parent epic). Source plan: `/home/curiouslycory/.claude/plans/please-make-a-bulletproof-plan-cached-iverson.md`
- Last updated: 2026-07-02 by orchestrator — #18 VERIFIED and **PR #22 open** (`feat/18-edit-delta-core` → `feat/world-persistence`, commits d678096 + acc4f2d), left for human review/merge. Implemented by Sonnet specialist; independently reviewed by Code Reviewer agent (2 findings applied: strict delta-length validation + single-record-per-key doc). Gate green: build ✓, lint ✓ (2 pre-existing warnings), typecheck ✓, 198/198 tests, golden determinism test pinned. **BLOCKED on human merge of PR #22 before #19 can branch** (dependent worktree must branch from post-#18 integration tip). While waiting: pre-planning #19.

## Status legend

- `not-started` no worktree yet
- `planning` running the per-item planning step
- `planned` plan file written, ready for agents
- `in-progress` specialist agents executing
- `review` review steps running
- `fixing` applying review fixes
- `verified` build, lint, typecheck, tests, and acceptance criteria all green in the worktree
- `merged` merged into integration and integration re-verified
- `blocked` waiting on a dependency or a failed gate (see Notes)

## Wave 1 (single item): branch from `main` via `feat/world-persistence`

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #18 | `feat/18-edit-delta-core` | `../threejs-craft-wt-18` | #18 | none | `plans/18.md` | verified (PR #22 open, awaiting human merge) | no |

## Wave 2 (single item): branch from the post-Wave-1 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #19 | `feat/19-server-persistence` | `../wt-19` | #19 | #18 | `plans/19.md` | not-started | no |

## Wave 3 (single item): branch from the post-Wave-2 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #20 | `feat/20-load-continuous-persist` | `../wt-20` | #20 | #18, #19 | `plans/20.md` | not-started | no |

## Wave 4 (single item): branch from the post-Wave-3 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #21 | `feat/21-pause-menu` | `../wt-21` | #21 | #20 | `plans/21.md` | not-started | no |

## Verification gates

Record pass/fail and date when each item clears its gate in-worktree, before merge. #19 also runs `pnpm db:generate`.

| Item | Build | Lint | Typecheck | Tests | Acceptance criteria | Item-specific check |
| --- | --- | --- | --- | --- | --- | --- |
| #18 | pass | pass (2 pre-existing warnings) | pass | pass (198/198) | met | golden determinism test pinned (sha256 of 2 chunks, seed `persistence-golden-seed-v1`); strict delta-length + version/OOB guards |
| #19 | - | - | - | - | - | `pnpm db:generate` clean; router auth/accumulation/prune tests |
| #20 | - | - | - | - | - | manual `/game` sign-in -> edit -> reload loop |
| #21 | - | - | - | - | - | manual full loop (sign in -> Save -> New Game -> reload); a11y disabled-Settings focusable |

## Integration re-verification log

After each merge, re-run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` on the integration branch and log the result.

| Date | After merging | Build | Lint | Typecheck | Tests | Conflicts resolved | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| - | - | - | - | - | - | - | - |

## Decisions / ADRs to confirm

| Decision | Item | Recorded | Confirmed at PR review |
| --- | --- | --- | --- |
| ADR-0002: per-user world persistence, single active save | #19 | no | no |
| ADR-0003: New Game mints a fresh random seed, atomic purge-then-reseed | #19 | no | no |
| OPEN: default schema `SavedWorld.userId @unique` vs optional multiplayer-friendlier `World { ownerId }` (not baked in) | #19 | no | no |
| Play-first soft gate (signed-out plays an ephemeral world) | #20 | no | no |
| Inventory and player-position persistence intentionally out of scope | #20 | no | no |
| Settings permanently inert (accessible-disabled, not native `disabled`) | #21 | no | no |
| Signed-out New Game does a local ephemeral reseed | #21 | no | no |

## Finalization checklist

- [ ] All items show `merged`
- [ ] Final full `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` all green on `feat/world-persistence`
- [ ] PR opened into `main` per the configured PR model
- [ ] PR body includes `Closes #<id>` for every item
- [ ] PR body summarizes every decision/ADR for sign-off
- [ ] All worktrees removed; merged item branches deleted
- [ ] Final PR left for human review (orchestrator does not self-merge)

## Notes and blockers

Use this space for anything that affected the run: a failed gate and how it was resolved, a conflict during integration, a decision rationale, or a reason an item is `blocked`.

- Strictly serial chain (#18 -> #19 -> #20 -> #21); no intra-wave parallelism. Orchestration value is worktree isolation, resumable state, per-item planning, and green-baseline re-verification.
- **2026-07-02 — Wave 1 plan written.** Issue #18 plan generated: pure edit-delta core (chunk accessors, codec, world bridge, worldgen determinism test). Dispatching Sonnet agent to worktree `../wt-18` for implementation.
