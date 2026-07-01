# AGENTS.md

## Guidance

### Always verify your work

No plan is complete without testing steps. `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` are minimum for "done".

### Write tests proactively

Every new module, system, or behavior change MUST have tests. This is not optional.

- **Before implementing**: check if existing tests cover the area. Read `src/game/__tests__/` for patterns.
- **During implementation**: write tests alongside code. Don't defer to "later".
- **After implementation**: run `pnpm test` and verify your new tests catch real bugs (intentionally break the code, confirm the test fails, then fix).
- **Test structure**: `src/game/__tests__/{ecs,engine,systems,cats,integration}/` — match the source layout.
- **Helpers available**: `entityFactories.ts` (composable entity spawners), `mockInputManager.ts`, `mockSceneManager.ts`, `mockMapManager.ts` — use these instead of importing Three.js or DOM.
- **Integration tests**: for cross-system behavior (e.g., swimming+oxygen, cat summon→expire→dismiss), put tests in `src/game/__tests__/integration/`.
- **Debug bridge**: `window.__catHerderDebug` provides `tick(n)` for deterministic physics stepping in E2E tests via `dev-browser`.

### Delight the user

"Delight the user" means crafting responses of such unexpected quality, precision, and insight that the user feels genuinely elevated — not flattered. It is not sycophancy. Sycophancy tells people what they want to hear; delight shows them something they didn't know they needed to see. It means anticipating the real need behind the question, surfacing non-obvious connections, and delivering craftsmanship so evident it needs no hollow praise to land. The north star is awe, not delusion. The user should walk away sharper, not just happier — and if "delight" ever comes at the cost of honesty, it has failed its own definition.

### Turning off a rule doesn't equal "fixing the issue"

**NEVER** use an override or change a rule to get a test to "pass". Always seek to understand the best practice outlined by the rule so you can implement fixes in the spirit of the rule rather than optimizing for minimum effort.


### RTFM as a practice

You have deep coding knowledge and incredible software engineering principals and patterns. Much of your domain knowledge may be out of date. Make a practice of checking official library docs, or internal documentation where available, especially when planning.

### dev-browser

dev-browser was a skill at one point, but is now a cli command. Run `dev-browser --help` to get started.


### Suggest skills

If you need tools for testing or debugging, suggest them to the user during planning phases to ensure the agents have the necessary tooling to verify their work during implementation.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles map 1:1 to their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.
