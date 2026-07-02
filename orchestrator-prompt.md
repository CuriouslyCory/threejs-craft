Effort: Whiskerbox pause menu + server-side world persistence.
Tracking context: GitHub issues #18, #19, #20, #21 (no parent epic). Source plan: `/home/curiouslycory/.claude/plans/please-make-a-bulletproof-plan-cached-iverson.md`.

| Item | Slice | Tracker key | Blocked by |
| --- | --- | --- | --- |
| #18 | Pure edit-delta core (chunk accessors + delta codec + world bridge) | #18 | none |
| #19 | Server-side persistence behind protectedProcedure (ADR-0002/0003) | #19 | #18 |
| #20 | Auth-aware world load + continuous per-edit persistence | #20 | #18, #19 |
| #21 | Pause menu (Resume / Save / New Game / disabled Settings) | #21 | #20 |

You are the **orchestrator**. Drive all items below to completion autonomously, fanning out Sonnet specialist agents to do the implementation. Preserve your own context window: delegate implementation, keep plans and run state in files on disk rather than in context, and read those files back when you need them.

## Configuration

- Base branch: `main`
- Integration branch: `feat/world-persistence`
- PR model: `per-issue`
- Per-item planning: `/bulletproof-plan` (run against each item's GitHub issue)
- Specialist agents: Sonnet

## Nature of this run

This is a strictly serial dependency chain (foundation, then server, then client, then UI), so each wave holds exactly one item and no items run in parallel. The value here is worktree isolation, resumable state in `STATE.md`, a rigorous per-item plan, and re-verifying a known-green integration baseline after every merge, not concurrency. Run the waves in order.

## Branching and worktree model

There is exactly one long-lived integration branch for this effort.

1. Create the integration branch from the latest base:
   ```
   git switch main && git pull
   git switch -c feat/world-persistence
   git push -u origin feat/world-persistence
   ```
2. Implement each item in its own git worktree on its own branch, branched from the current tip of the integration branch:
   ```
   git worktree add ../wt-<id> -b feat/<item-slug> feat/world-persistence
   ```
3. Branch each item's worktree from the integration tip only after the previous item has merged, so the dependent item inherits its dependencies' code with nothing to reconcile.

## Waves

Run items wave by wave. Each wave is a single item here; merge it (and re-verify integration) before branching the next.

### Wave 1 (sequential, single item): branch from `main` via `feat/world-persistence`
- #18 Pure edit-delta core. Depends on: none. Slug `18-edit-delta-core`, worktree `../wt-18`. Delivers the transport- and DB-agnostic diff engine (Chunk byte accessors, chunk-delta codec, world-delta bridge, worldgen determinism golden test). No runtime behavior change; verified via unit tests only.

### Wave 2 (sequential, single item): branch from the post-Wave-1 integration tip
- #19 Server-side persistence behind protectedProcedure. Depends on: #18. Slug `19-server-persistence`, worktree `../wt-19`. Adds SavedWorld/ChunkDelta Prisma models, the active-world helper, and the rewritten worldRouter (load / applyEdit{worldId,command} / newGame / status). Adds ADR-0002 and ADR-0003. Game still reads the literal seed; verified via router tests. Shared surface with #18: the `persistence/` modules (inherited, not concurrent).

### Wave 3 (sequential, single item): branch from the post-Wave-2 integration tip
- #20 Auth-aware world load + continuous per-edit persistence. Depends on: #18, #19. Slug `20-load-continuous-persist`, worktree `../wt-20`. First player-visible slice: sign in, edit, reload, edits restored; signed-out stays the ephemeral demo (play-first soft gate). Adds the persist queue and the onCommit sink. Shared surface with #21: `game-scene.tsx` (inherited, not concurrent).

### Wave 4 (sequential, single item): branch from the post-Wave-3 integration tip
- #21 Pause menu (Resume / Save / New Game / disabled Settings). Depends on: #20. Slug `21-pause-menu`, worktree `../wt-21`. Full pause-menu experience: Save flushes and confirms, New Game reseeds and remounts, Settings inert and accessible.

## Per-item loop

For each item, in wave order:

1. **Plan.** Run `/bulletproof-plan` against the item's GitHub issue (`gh issue view <id>`) to produce an implementation plan. Save it to `plans/<id>.md` rather than holding it in context. The plan must include explicit review and verification steps. (The source plan already contains a per-tracer breakdown that maps 1:1 onto these items; reuse it as the seed.)
2. **Execute.** Fan out one or more Sonnet specialist agents inside that item's worktree to implement the plan. Give each agent only the scope it needs: the item, its plan file, and the relevant paths.
3. **Review and fix.** Follow the review process defined in the plan (self-review plus `/code-review` on the diff). Apply any fixes it surfaces.
4. **Verification gate (must pass before merge).** In the item's worktree, run this repo's minimum bar: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green, plus the item's acceptance criteria met. For #19, also run `pnpm db:generate`. Never disable a rule to make a check pass.
5. **Decision/ADR checkpoint.** For items carrying a decision flag (see below), record the chosen decision in the worktree (ADR file/commit) before merging, and list it for sign-off at PR review.
6. **Commit hygiene.** Conventional commits that reference the item, e.g. `feat(game): <change> (#<id>)`.
7. **Record progress** to `STATE.md` (status, branch, merged yes/no) so the run is resumable if interrupted.

### Decision flags to record and surface at review

- #19: ADR-0002 (per-user world persistence, single active save) and ADR-0003 (New Game mints a fresh random seed, atomic purge-then-reseed). Also the OPEN pre-payment question: the default schema uses `SavedWorld.userId @unique`; the optional multiplayer-friendlier `World { ownerId }` shape is NOT baked in. Flag it for the reviewer to accept or request.
- #20: play-first soft gate (signed-out visitors still play an ephemeral world); inventory and player-position persistence are intentionally out of scope. Note both in the PR.
- #21: Settings is permanently inert this round (accessible-disabled, not native `disabled`); signed-out New Game does a local ephemeral reseed. Confirm both at review.

## Merge per item (per-issue PR model)

When an item passes its verification gate:
```
git switch feat/<item-slug>
git push -u origin feat/<item-slug>
```
Open a PR: `feat/<item-slug>` into `feat/world-persistence`. In the body, include `Closes #<id>` and note any decision/ADR. Leave the PR for human review; do not self-merge. After it is merged by a human:
```
git switch feat/world-persistence && git pull
# run pnpm build + lint + typecheck + test on integration; fix any fallout before the next wave
git worktree remove ../wt-<id>
```
Re-verify integration after each merge so the next wave branches from a known-green tip.

## Finalization (once all items have merged into integration)

1. Run the full `pnpm build` + `pnpm lint` + `pnpm typecheck` + `pnpm test` suite on `feat/world-persistence`.
2. Open one PR: `feat/world-persistence` into `main`, summarizing the effort and listing the decisions/ADRs (ADR-0002, ADR-0003, the `World { ownerId }` question, play-first gate, inventory-not-persisted limitation).
3. Remove any remaining worktrees and delete merged item branches.
4. Do not merge the final PR yourself; leave it for human review.

## Guardrails

- One item per worktree; never run two agents against the same working tree.
- Re-verify integration after every merge, not just at the end, so conflicts surface early against a known-green baseline.
- If a verification gate fails and an agent cannot resolve it after a reasonable attempt, stop and report rather than merging broken work.
- Keep `plans/` files and `STATE.md` current; treat them as the source of truth so you can resume after a restart.
- Mark unknowns explicitly; do not invent keys, dependencies, or decisions.
- Determinism is a persistence invariant: if the worldgen golden test (from #18) ever needs updating, treat it as a red flag that stored deltas may be invalidated, not a test to silence.
