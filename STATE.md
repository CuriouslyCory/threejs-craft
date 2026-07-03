# Orchestration State: feat/world-persistence

Source of truth for this run. Update after every state change (plan saved, agent dispatched, gate passed, branch merged). If the run is interrupted, read this file first to resume.

- Integration branch: `feat/world-persistence`
- Base branch / final PR target: `main`
- PR model: `per-issue`
- Tracking context: GitHub issues #18, #19, #20, #21 (no parent epic). Source plan: `/home/curiouslycory/.claude/plans/please-make-a-bulletproof-plan-cached-iverson.md`
- Last updated: 2026-07-03 by orchestrator — **#19 MERGED** (PR #23, merge 12db0eb); integration re-verified green after `prisma generate` (see gotcha below). wt-19 removed. **Wave 3 (#20) executing** in wt-20 (branched from 12db0eb); dispatching specialist against `plans/20.md`. [Prior: #19 VERIFIED and PR #23 open] (`feat/19-server-persistence` → `feat/world-persistence`, commit a49401f). Gate green: db:generate ✓, build ✓, lint ✓ (2 pre-existing warnings), typecheck ✓, **221/221 tests**. Reviewed via CodeRabbit CLI (3 rounds, fixes applied) + orchestrator verification (scope/auth/base64/no-Buffer-in-game invariants checked). **BLOCKED on human merge of PR #23 before #20 can branch.** While waiting: pre-planning #20. [Prior: #18 MERGED (PR #22, 7a20ebc); Wave 2 executed] (`feat/18-edit-delta-core` → `feat/world-persistence`, commits d678096 + acc4f2d), left for human review/merge. Implemented by Sonnet specialist; independently reviewed by Code Reviewer agent (2 findings applied: strict delta-length validation + single-record-per-key doc). Gate green: build ✓, lint ✓ (2 pre-existing warnings), typecheck ✓, 198/198 tests, golden determinism test pinned. **BLOCKED on human merge of PR #22 before #19 can branch** (dependent worktree must branch from post-#18 integration tip). While waiting: pre-planning #19.

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
| #18 | `feat/18-edit-delta-core` | removed | #18 | none | `plans/18.md` | merged | yes (PR #22, merge 7a20ebc) |

## Wave 2 (single item): branch from the post-Wave-1 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #19 | `feat/19-server-persistence` | removed | #19 | #18 | `plans/19.md` | merged | yes (PR #23, merge 12db0eb) |

## Wave 3 (single item): branch from the post-Wave-2 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #20 | `feat/20-load-continuous-persist` | `../threejs-craft-wt-20` | #20 | #18, #19 | `plans/20.md` | in-progress (worktree created at 12db0eb; dispatching specialist) | no |

## Wave 4 (single item): branch from the post-Wave-3 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #21 | `feat/21-pause-menu` | `../wt-21` | #21 | #20 | `plans/21.md` | not-started | no |

## Verification gates

Record pass/fail and date when each item clears its gate in-worktree, before merge. #19 also runs `pnpm db:generate`.

| Item | Build | Lint | Typecheck | Tests | Acceptance criteria | Item-specific check |
| --- | --- | --- | --- | --- | --- | --- |
| #18 | pass | pass (2 pre-existing warnings) | pass | pass (198/198) | met | golden determinism test pinned (sha256 of 2 chunks, seed `persistence-golden-seed-v1`); strict delta-length + version/OOB guards |
| #19 | pass | pass (2 pre-existing warnings) | pass | pass (221/221) | met | `pnpm db:generate` clean; auth (UNAUTHORIZED signed-out) + same-chunk accumulation + revert-prune + newGame reseed tests all present |
| #20 | - | - | - | - | - | manual `/game` sign-in -> edit -> reload loop |
| #21 | - | - | - | - | - | manual full loop (sign in -> Save -> New Game -> reload); a11y disabled-Settings focusable |

## Integration re-verification log

After each merge, re-run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` on the integration branch and log the result.

| Date | After merging | Build | Lint | Typecheck | Tests | Conflicts resolved | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-02 | #18 (merge 7a20ebc, PR #22) | pass | pass (2 pre-existing warnings) | pass | 198/198 | none | Wave 1 complete; integration green. wt-18 removed, branch deleted. wt-19 branched from 7a20ebc. |
| 2026-07-03 | #19 (merge 12db0eb, PR #23) | pass | pass (2 pre-existing warnings) | pass* | 221/221 | none | Wave 2 complete; integration green. *GOTCHA: typecheck+build initially FAILED (`PrismaClient missing savedWorld/chunkDelta`) — the generated Prisma client (gitignored, `generated/prisma/`) was stale after pulling #19's schema. Fix: `pnpm exec prisma generate`. Tests passed regardless (fake db). wt-19 removed; wt-20 branched from 12db0eb. |

## Decisions / ADRs to confirm

| Decision | Item | Recorded | Confirmed at PR review |
| --- | --- | --- | --- |
| ADR-0002: per-user world persistence, single active save | #19 | yes (docs/adr/0002, PR #23) | no |
| ADR-0003: New Game mints a fresh random seed, atomic purge-then-reseed | #19 | yes (docs/adr/0003, PR #23) | no |
| OPEN: default schema `SavedWorld.userId @unique` vs optional multiplayer-friendlier `World { ownerId }` (not baked in) | #19 | yes (flagged in PR #23 body) | no |
| D1: server applies command's voxel mutation only (no reach/inventory re-validation; client trusted) | #19 | yes (ADR-0002 + code doc, PR #23) | no |
| Migration baseline: first `prisma migrate dev` snapshots the FULL schema (all tables); deploying onto a `db push`-created DB needs `migrate resolve --applied` first | #19 | yes (flagged in PR #23 body) | no |
| Deferred concurrency: concurrent newGame double-submit + concurrent recordEdit lost-update under default isolation (out of scope; no race under #20 serial queue) | #19 | yes (code comments, PR #23) | no |
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
- **PRISMA GOTCHA (applies to every future pull of a schema-changing branch):** after `git pull` brings a `prisma/schema.prisma` change, the generated client (`generated/prisma/`, gitignored) is stale → `pnpm typecheck`/`pnpm build` fail with `PrismaClient missing <model>`. Run `pnpm exec prisma generate` (safe: no DB/migration) before re-verifying. Fresh worktrees also need `pnpm install` (postinstall runs `prisma generate`).
- **CodeRabbit CLI note:** was signed out in the #18 session; the #19 specialist got `coderabbit review --agent` working. If a specialist can't authenticate, fall back to a `Code Reviewer` subagent on the diff. (non-interactive session can't run `coderabbit auth login`). #18 was reviewed by an internal `Code Reviewer` subagent instead (2 findings applied). PRs will also get CodeRabbit's GitHub-app review if configured. To restore CLI review, run `coderabbit auth login` in an interactive session.
- **2026-07-02 — Wave 1 (#18) done to PR #22, awaiting human merge.** Earlier `plans/18.md` draft (and partial worktree code) had a `Buffer`/base64-in-client codec + private-`World.chunks` access + `GeneratedWorld`-as-`World` bugs; plan rewritten and code corrected before commit. Review findings applied: strict delta-length validation (reject a `count` that understates trailing bytes) and a documented single-record-per-`chunkKey` precondition (enforced downstream by #19's composite PK).
- **2026-07-02 — Wave 2 (#19) done to PR #23, awaiting human merge.** Migration nuance: repo `db:generate` = `prisma migrate dev`; no `prisma/migrations/` existed, so this PR introduces the dir with a full-schema baseline migration (all tables). Agent resolved D1 via direct `world.setBlock` (applyCommand needs unpersisted Inventory/playerBox). Two concurrency races documented+deferred.
- **2026-07-03 — #19 merged (12db0eb); Wave 3 (#20) executing** in wt-20.
- **RESUME POINT (after PR for #20 is merged by a human):** `git switch feat/world-persistence && git pull` → **`pnpm exec prisma generate`** (Prisma gotcha above) → re-verify integration (build/lint/typecheck/test) and log it → remove wt-20 + delete its branch → `git worktree add ../threejs-craft-wt-21 -b feat/21-pause-menu feat/world-persistence` → **pre-plan #21** (`plans/21.md` — not yet written; source-plan Tracer 4 detail at lines 165-196 of the source plan; grounds against #20's outer-component shape + `src/game/render/lock-overlay.tsx`) → execute. Flags for #21: Settings accessible-disabled (`aria-disabled`, not native `disabled`); signed-out New Game = local ephemeral reseed.
- **[Historical] RESUME POINT for #18→#19 (done):** PR #22 merged 7a20ebc; wt-19 branched; #19 executed.
- **2026-07-02 — Wave 1 plan written.** Issue #18 plan generated: pure edit-delta core (chunk accessors, codec, world bridge, worldgen determinism test). Dispatching Sonnet agent to worktree `../wt-18` for implementation.
