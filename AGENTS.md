# AGENTS.md

## Guidance

### Always verify your work

No plan is complete without testing steps. `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` are minimum for "done".

### Write tests proactively

Every new module, system, or behavior change MUST have tests. This is not optional.

- **Before implementing**: check if existing tests cover the area. Read `src/game/__tests__/` for patterns.
- **During implementation**: write tests alongside code. Don't defer to "later".
- **After implementation**: run `pnpm test` and verify your new tests catch real bugs (intentionally break the code, confirm the test fails, then fix).
- **Test runner**: [Vitest](https://vitest.dev), run via `pnpm test` (non-watch, `vitest run`) or `pnpm test:watch` during development. Configured in `vitest.config.ts` at the repo root.
- **Environment**: tests run in plain Node (no jsdom). Keep game/domain logic testable as pure functions/modules that don't require a DOM or a real Three.js renderer.
- **Test structure**: co-locate tests under `src/game/__tests__/`, mirroring the domain modules as they're added (e.g. a module at `src/game/foo.ts` gets a test at `src/game/__tests__/foo.test.ts`). Grow subdirectories under `__tests__/` only as real domain modules warrant them — don't pre-create structure for code that doesn't exist yet.
- **Path alias**: the `~/` alias (from `tsconfig.json`, resolving to `src/`) works in tests via the `vite-tsconfig-paths` plugin — import with `~/game/...` the same way you would in app code.

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
