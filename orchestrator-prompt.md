Source: architecture review (2026-07-02) turned into issues #13-#16, all labeled `enhancement, ready-for-agent, game`.

| Item | Slice | Tracker key | Blocked by |
| --- | --- | --- | --- |
| #13 | Prefactor: one voxel-read interface, one player-box module, one CHUNK_SIZE source of truth | #13 | none |
| #14 | Deepen the world-state seam: one WorldStore module (fixes blocks placed into new chunks never rendering) | #14 | #13 |
| #16 | Deepen chunk meshing into a pure render-plan module (seam for future face culling) | #16 | #14 |
| #15 | Extract pure interaction module from BlockTargeting (eye-feet convention + face-normal placement) | #15 | #13, #14, #16 (resequenced, see Waves) |

You are the **orchestrator**. Drive all items below to completion autonomously, fanning out Sonnet specialist agents to do the implementation. Preserve your own context window: delegate implementation, keep plans and run state in files on disk rather than in context, and read those files back when you need them.

## Configuration

- Base branch: `main`
- Integration branch: `feat/architecture-deepening`
- PR model: `single`
- Per-item planning: `/bulletproof-plan` (run against each item's GitHub issue)

## Branching and worktree model

There is exactly one long-lived integration branch for this effort.

1. Create the integration branch from the latest base:
   ```
   git switch main && git pull
   git switch -c feat/architecture-deepening
   git push -u origin feat/architecture-deepening
   ```
2. Implement every item in its own git worktree on its own branch, branched from the current tip of the integration branch. Separate worktrees are what let parallel items proceed without sharing a working tree:
   ```
   git worktree add ../wt-<item> -b feat/<item-slug> feat/architecture-deepening
   ```
3. Branch each wave's worktrees from the integration tip only after the previous wave has merged, so dependent items inherit their dependencies' code with nothing to reconcile.

## Waves

Run items wave by wave. Within a wave, run items in parallel. Merge a wave fully (and re-verify integration) before branching the next wave.

### Wave 1 (sequential, single item): branch from main
- #13 Prefactor: one voxel-read interface, one player-box module, one CHUNK_SIZE source of truth. Depends on: none.

### Wave 2 (sequential, single item): branch from post-Wave-1 integration tip
- #14 Deepen the world-state seam: one WorldStore module. Depends on: #13.

### Wave 3 (sequential, single item): branch from post-Wave-2 integration tip
- #16 Deepen chunk meshing into a pure render-plan module. Depends on: #14.
  - Resequenced ahead of #15 by user decision: #16 replaces the untyped `userData.instanceToCoord` picking contract that `block-target.tsx` consumes, and #15 also rewrites `block-target.tsx`. Running #16 first means #15 builds directly on the new typed picking contract instead of two agents racing to rewrite the same file.

### Wave 4 (sequential, single item): branch from post-Wave-3 integration tip
- #15 Extract pure interaction module from BlockTargeting. Depends on: #13, #14, and (by resequencing) #16's typed picking contract.
  - Originally specified as blocked by #13 and #14 only; the orchestrator must also treat #16 as a hard prerequisite because of the shared-surface conflict above. Do not start #15 before #16 has merged into integration.

<!-- No shared-surface conflicts remain: every wave above has exactly one item, so there is no cross-item parallelism risk to guard against mid-wave. -->

## Per-item loop

For each item, in wave order:

1. **Plan.** Run `/bulletproof-plan` against the item's GitHub issue (`gh issue view <id>`) to produce an implementation plan. Save it to `plans/<item>.md` rather than holding it in context. The plan must include explicit review and verification steps.
2. **Execute.** Fan out one or more Sonnet specialist agents inside that item's worktree to implement the plan. Give each agent only the scope it needs: the item, its plan file, and the relevant paths.
3. **Review and fix.** Follow the review process defined in the plan. Apply any fixes it surfaces.
4. **Verification gate (must pass before merge).** In the item's worktree, run this repo's minimum bar (`pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`): build green, lint clean, typecheck clean, all tests pass, and the item's acceptance criteria met. Honor any item-specific budget or guard noted in the plan.
5. **Decision/ADR checkpoint.** #14 carries an ADR-0001 compatibility note (the WorldStore reshape must keep the frozen `Command`/`CommandResult` Zod contract untouched). Record the decision as taken in the worktree (commit message or short note) before merging, and list it for sign-off at PR review.
6. **Commit hygiene.** Conventional commits that reference the item, e.g. `feat(<area>): <change> (#<id>)`.
7. **Record progress** to `STATE.md` (status, branch, merged yes/no) so the run is resumable if interrupted.

## Merge to integration (single-PR model)

When an item passes its verification gate, merge locally and re-verify:
```
git switch feat/architecture-deepening && git pull
git merge --no-ff feat/<item-slug>
# run pnpm build + lint + typecheck + test on integration; fix any merge fallout before continuing
git push
git worktree remove ../wt-<item>
```
Open no PR until every item has merged into integration.

## Finalization (once all items have merged)

1. Run the full `pnpm build` + `pnpm lint` + `pnpm typecheck` + `pnpm test` suite one final time on `feat/architecture-deepening`.
2. Open one PR: `feat/architecture-deepening` into `main`. In the body, include `Closes #13`, `Closes #14`, `Closes #16`, `Closes #15`, and summarize every decision/ADR for reviewer confirmation (in particular the #14 ADR-0001 compatibility note, and the #16-before-#15 resequencing rationale).
3. Remove any remaining worktrees and delete merged item branches.
4. Do not merge the final PR yourself; leave it for human review.

## Guardrails

- One item per worktree; never run two agents against the same working tree.
- Every wave in this plan contains exactly one item (the natural parallelism was collapsed to two items wide at most, and the one real parallel pair, #15/#16, was serialized due to a shared-surface conflict on `block-target.tsx` and the instance-picking contract). Do not re-parallelize #15 and #16 without re-confirming with the user.
- Re-verify integration after every merge, not just at the end, so conflicts surface early against a known-green baseline.
- If a verification gate fails and an agent cannot resolve it after a reasonable attempt, stop and report rather than merging broken work.
- Keep `plans/` files and `STATE.md` current; treat them as the source of truth so you can resume after a restart.
- Mark unknowns explicitly; do not invent keys, dependencies, or decisions.
