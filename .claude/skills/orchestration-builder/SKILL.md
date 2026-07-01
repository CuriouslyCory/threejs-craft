---
name: orchestration-builder
description: Convert a set of Jira stories or GitHub issues into a dependency-aware, parallelized orchestration plan plus a resumable STATE.md tracker. Use this skill whenever someone pastes a set of issues, stories, or a work-item table (especially with a "blocked by" / dependency column) and wants it turned into an agent-driven execution plan. Trigger on phrasings like "turn these issues into an orchestrated plan", "build me an orchestration plan", "make a wave plan", "fan out agents to implement these stories", "orchestrate this backlog", "plan parallel execution with worktrees", or when a tracking issue links several sub-issues that need coordinated implementation. Also trigger when someone has a dependency graph of work and wants maximum safe parallelism with a single clean merge.
---

# Orchestration Plan Builder

Turn a pasted set of work items (Jira stories or GitHub issues) into two drop-in files:

1. An **orchestrator prompt** that an agent can follow to implement every item autonomously, fanning out specialist agents, using git worktrees for safe parallelism, and producing a clean merge.
2. A **STATE.md** tracker that serves as the resumable source of truth for the run.

The core value is converting a flat "blocked by" list into **waves**: groups of items that can run in parallel because their dependencies are already satisfied. This extracts more parallelism than a strict serial critical path while keeping parallel work from colliding.

## Inputs

The user pastes the work items. Accept any reasonable shape: a markdown table, a bulleted list, or raw issue text. Extract these fields per item, leaving any you cannot find explicitly marked as unknown rather than inventing them:

- **id**: the issue number (e.g. `#128`). This is the handle used everywhere.
- **title / slice**: a short description of the work.
- **blocked by**: the list of ids this item depends on. "start now" / "none" / "-" all mean no dependency.
- **decision flags**: any ADR, design decision, or "confirm at review" note attached to the item.
- **branch slug**: derive a short kebab-case slug from the title if one is not given (e.g. `#128` "Crafting recipe book + tooltip preview" becomes `128-crafting-recipe-book`).

If the dependency column is missing entirely, ask the user whether items are independent or share an order before guessing. Do not fabricate dependencies.

## Step 1: Parse the work items

Build a normalized list of items with the fields above. Echo back a compact table of what you parsed so the user can catch a misread before you plan around it. Keep terminology exactly as the user wrote it (issue ids, keys, names).

## Step 2: Build the dependency graph and derive waves

Treat each item as a node and each "blocked by" entry as an edge from dependency to dependent.

1. **Check for cycles.** If A blocks B and B blocks A (directly or transitively), stop and report the cycle. A cyclic dependency cannot be waved; the user must break it.
2. **Layer topologically.** Assign each item a wave number: an item with no dependencies is Wave 1; any other item lands one wave after the latest wave of all its dependencies. Formally, `wave(item) = 1 + max(wave(d) for d in deps)`, or `1` if it has no deps.
3. **Maximize parallelism, do not over-serialize.** Derive waves purely from the dependency graph. If an item only depends on one early item, it belongs in the next wave even if a human might have listed it later in a serial path. (Example: an item that depends only on a Wave 1 item belongs in Wave 2, in parallel with other Wave 2 items, not pushed to the end.)
4. **Flag shared-surface risk.** Items in the same wave run in parallel, so they must not edit the same files at the same time. You usually cannot prove file overlap from issue text, so scan titles and descriptions for shared modules, shared accessors, or the same component named across two same-wave items. List any such pairs as "potential shared surface, confirm with user" rather than silently assuming they are safe. The worktree model (below) contains the conflict, but flagging lets the user split a wave if needed.

Present the derived waves to the user (which items in each wave, and why) and the shared-surface flags before generating files.

## Step 3: Confirm configuration

The generated plan has a small configuration block. Confirm or default these:

- **base branch**: default `main`.
- **integration branch**: default `feat/<short-effort-slug>`. Ask for the effort slug if not obvious.
- **PR model**: `single` (default) or `per-issue`.
  - `single`: every item merges locally into the integration branch; one PR opens at the very end targeting the base branch. Fewer reviews, one clean diff.
  - `per-issue`: each item opens its own PR into the integration branch as it completes. More granular review, more overhead.
- **agent model for specialists**: default "Sonnet specialist agents".
- **planning step**: default the `/bulletproof-plan` skill for per-item planning. This is pluggable; if the user has no such skill, substitute "produce a written implementation plan with explicit review and verification steps."

## Step 4: Generate the two files

Fill the templates in `assets/` and write both files where the user can grab them.

- `assets/orchestrator-prompt-template.md` becomes the orchestrator prompt. Substitute the configuration, drop in the per-wave tables you derived, and select the `single` or `per-issue` finalization block. Delete the unused block; do not leave both in.
- `assets/STATE-template.md` becomes `STATE.md`. One row per item, grouped by wave, with branch slug, worktree path, dependencies, and status. Pre-fill the verification-gate and ADR tables from the decision flags you parsed.

Keep the two files consistent. If you change a branch name or wave assignment, reconcile it in both. Echo the integration branch name identically in each.

## Wave and worktree model (why the plan is shaped this way)

The generated plan rests on three rules. Preserve them when filling the template.

- **One long-lived integration branch, plus per-item worktrees.** Each item is implemented in its own git worktree on its own branch, branched from the current tip of the integration branch. Separate worktrees mean two parallel agents never share a working tree, so same-wave work cannot clobber the same files mid-edit.
- **Branch each wave after the previous wave merges.** Dependent items inherit their dependencies' code by branching from the post-merge integration tip, so there is nothing to reconcile when they start. Re-verify the integration branch (build, lint, tests) after every merge so conflicts surface against a known-green baseline instead of piling up.
- **Do not self-merge the final PR.** The orchestrator stops at an open PR for human review.

## Worked example

Input (abbreviated):

```
#10 Player character controller    blocked by: none
#11 Camera system                  blocked by: none
#12 Physics collision              blocked by: #10, #11
#13 Multiplayer synchronization    blocked by: #12
#14 Animation framework            blocked by: #11
```

Derived waves:

- Wave 1 (parallel): #10, #11 (no deps)
- Wave 2 (parallel): #12 (needs #10, #11), #14 (needs #11 only, so it joins Wave 2 rather than being serialized to the end)
- Wave 3: #13 (needs #12)

Note #14 lands in Wave 2 even though a human-written serial path might place it last. That is the parallelism the wave derivation is meant to surface. #12 and #14 would both be flagged for a shared-surface check if they touch the same animation or camera components.

## Things to get right

- Mark unknowns explicitly; never invent a Jira key, dependency, or ADR.
- Use the user's exact ids and terminology throughout both files.
- When PR model is `single`, the final PR body lists `Closes <id>` for every item so they auto-close on merge, and summarizes every decision/ADR for sign-off.
- Avoid em-dashes in the generated files; use commas or parentheses.
- The plan delegates implementation to specialist agents and keeps plans and state in files on disk, so the orchestrator preserves its own context window. Reinforce this in the generated prompt.

## Output

Write `orchestrator-prompt.md` and `STATE.md`, present both, and give a two to three line summary of the wave structure and any shared-surface flags. Offer to adjust wave splits or switch the PR model.