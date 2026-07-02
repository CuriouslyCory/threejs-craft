# Orchestration State: feat/architecture-deepening

Source of truth for this run. Update after every state change (plan saved, agent dispatched, gate passed, branch merged). If the run is interrupted, read this file first to resume.

- Integration branch: `feat/architecture-deepening`
- Base branch / final PR target: `main`
- PR model: `single`
- Tracking context: architecture review 2026-07-02, issues #13, #14, #15, #16 (all labeled enhancement, ready-for-agent, game)
- Last updated: 2026-07-02 by orchestrator — run started. Integration branch `feat/architecture-deepening` created at `1cfd257` (scaffolding on 7e63afe). Baseline verified green on main (build+lint+typecheck+158 tests). ALL WAVES MERGED (#13 2d9deeb, #14 eb5bed8, #16 7553619, #15 9037813). Integration `feat/architecture-deepening` fully green (build+lint+typecheck+178 tests). **RUN COMPLETE** — final PR #17 opened into main, left OPEN for human review (orchestrator does not self-merge).

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

## Wave 1 (single item): branch from main

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #13 | `feat/13-voxel-read-player-box-chunk-size` | removed | #13 | none | `plans/13.md` | merged | yes (2d9deeb) |

## Wave 2 (single item): branch from post-Wave-1 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #14 | `feat/14-worldstore-seam` | removed | #14 | #13 | `plans/14.md` | merged | yes (eb5bed8) |

## Wave 3 (single item): branch from post-Wave-2 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #16 | `feat/16-render-plan-module` | removed | #16 | #14 | `plans/16.md` | merged | yes (7553619) |

## Wave 4 (single item): branch from post-Wave-3 integration tip

| Item | Slug / branch | Worktree | Tracker key | Depends on | Plan file | Status | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #15 | `feat/15-interaction-module` | removed | #15 | #13, #14, #16 (resequenced AFTER #16 due to shared-surface conflict, see Notes) | `plans/15.md` | merged | yes (9037813) |

## Verification gates

Record pass/fail and date when each item clears its gate in-worktree, before merge.

| Item | Build | Lint | Typecheck | Tests | Acceptance criteria | Item-specific check |
| --- | --- | --- | --- | --- | --- | --- |
| #13 | pass | pass | pass | pass (158/158) | met | met: 158/158 tests unchanged, greps confirm single homes (WorldReader/VoxelWorld gone, 1 CHUNK_SIZE, no step-player import in command.ts) |
| #14 | pass | pass | pass | pass (156/156) | met | met: new-chunk render path covered by regression test (getSnapshot includes edit-created chunk); O(dirty) entry-identity test; useSyncExternalStore caching verified in review |
| #16 | pass | pass | pass | pass (162/162) | met | met: visual output byte-identical (matrix math/group order/geometry keys preserved; cat-grass.ts + chunk-instances.ts untouched); typed WeakMap picking replaces userData; game-scene.tsx untouched; +6 render-plan tests |
| #15 | pass | pass | pass | pass (178/178) | met | met: behavior-parity review confirms identical eye→feet, face-normal snap, reach gate, empty-slot gate, break/place cells; EYE_HEIGHT single home (player-box.ts); +interaction.test.ts (17) + player-box.test.ts |

## Integration re-verification log

After each merge, re-run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` on the integration branch and log the result.

| Date | After merging | Build | Lint | Typecheck | Tests | Conflicts resolved | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-02 | #13 (merge 2d9deeb) | pass | pass (2 pre-existing warnings) | pass | 158/158 | none | Wave 1 complete; integration green |
| 2026-07-02 | #14 (merge eb5bed8) | pass | pass (2 pre-existing warnings) | pass | 156/156 | none | Wave 2 complete; integration green. Test count 158→156: deleted local-world-store.test.ts + remote-world-source.test.ts, added new-chunk + O(dirty) regression tests |
| 2026-07-02 | #16 (merge 7553619) | pass | pass (2 pre-existing warnings) | pass | 162/162 | none | Wave 3 complete; integration green. +6 render-plan.test.ts tests. Typed instance-picking seam now available for #15 |
| 2026-07-02 | #15 (merge 9037813) | pass | pass (2 pre-existing warnings) | pass | 178/178 | none | Wave 4 complete; ALL ITEMS MERGED; integration green. +interaction/player-box tests; EYE_HEIGHT relocated out of step-player |

## Decisions / ADRs to confirm

| Decision | Item | Recorded | Confirmed at PR review |
| --- | --- | --- | --- |
| WorldStore seam reshape stays compatible with ADR-0001 (edit-delta persistence): frozen `Command`/`CommandResult` Zod contract must remain untouched | #14 | yes — command.ts, command-schema.ts, server/api/routers/world.ts byte-for-byte unchanged (empty `git diff --stat`); parity asserts still compile; noted in merge commit eb5bed8 | no |
| #15 resequenced to run after #16 (not parallel) due to shared-surface conflict on `block-target.tsx` and the instance-picking contract | #15 / #16 | yes (this file) | no |
| #15 relocated `EYE_HEIGHT` from `step-player.ts` into `player-box.ts` (the issue's suggested shared home). Widens player-box's charter past #13's "collision-box only" framing; alternative was a dedicated `player-eye.ts`. Flag for reviewer to confirm preferred home | #15 | yes (implemented; noted in merge 9037813) | no |
| #16 typed picking transport uses a module-scoped `WeakMap<InstancedMesh, InstanceCoordLookup>` in `instance-picking.ts` (no `userData` at all), vs. a typed-`userData` accessor alternative | #16 | yes (implemented) | no |

## Finalization checklist

- [x] All items show `merged` (#13, #14, #16, #15)
- [x] Final full `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` all green on `feat/architecture-deepening` (9037813: build ✓, lint ✓ 2 pre-existing warnings, typecheck ✓, 178/178 tests)
- [x] PR opened into `main` per the configured PR model — **PR #17** (https://github.com/CuriouslyCory/threejs-craft/pull/17)
- [x] PR body includes `Closes #13`, `Closes #14`, `Closes #16`, `Closes #15`
- [x] PR body summarizes every decision/ADR for sign-off (ADR-0001 compat; #16-before-#15 resequencing; EYE_HEIGHT home; WeakMap picking transport)
- [x] All worktrees removed; merged item branches deleted (wt-13/14/15/16 removed; feat/13/14/15/16 branches deleted)
- [x] Final PR left for human review (orchestrator does not self-merge) — PR #17 left OPEN for human review

## Notes and blockers

- Original dependency graph (from issue text alone) would have put #15 and #16 in the same wave (both depend only on #14). Flagged as a shared-surface risk during planning: #16's acceptance criteria replace `block-target.tsx`'s untyped `userData.instanceToCoord` picking convention with a typed interface, and #15 simultaneously extracts derivation logic out of the same file. User chose to serialize #16 before #15 rather than run them in parallel, collapsing what could have been a 3-wave plan into 4 single-item waves. No worktree ever holds more than one item at a time as a result; there is currently no cross-item parallelism in this run.
