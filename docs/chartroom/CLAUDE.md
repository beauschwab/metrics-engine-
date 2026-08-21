# Chartroom — agent working agreement

- Read `chartroom-prd.md` and `chartroom-implementation-spec.md` (in the
  session's design uploads) plus `ADRS.md` here before any task. Spec §0
  decisions are pinned; `ADRS.md` records every deviation — propose new ADRs,
  don't silently deviate.
- `packages/chartroom-spec` is pure: no fetch, no fs, no React, no Node APIs. If the
  linter needs data, add it to `LintContext` — contracts are injected, never
  fetched.
- Dependency direction: `spec ← widgets ← studio`, `spec ← server`. Nothing
  imports studio. Enforced by `packages/chartroom-spec/test/boundaries.test.ts` — run it
  before committing.
- Outward, the registry is a dependency, not a neighbour: import `keel-engine/*`
  and `keel-registry/db|dialect`, never a relative path out of the workspace (ADR-49/50). The
  same boundaries test fails on any relative import that climbs out of a
  workspace, and a new cross-package import means a line in that package's
  `package.json` — chartroom-server imported chartroom-widgets for three phases
  without declaring it.
- Every lint rule: one file in `spec/src/lint/rules/`, a `describe` block in
  `spec/test/rules.test.ts` with the violation, the clean case, and — where a
  fix exists — the round-trip (apply it, re-lint, the rule stops firing).
  Shared contracts live in `spec/test/fixtures.ts`. Adding a rule also means
  a `RULE_GUIDE` entry in `chartroom-patterns`; the roster test requires the
  guide to cover exactly `RULE_IDS`, so the two move together.
- Never let widgets fetch. Never let format overrides touch units (NUM-01).
  Never bypass promote gates client-side.
- A widget's `family` is a claim about which rules apply to it, not a label —
  several rules key off it (ADR-42). Before reusing a family, check what its
  members are subscribed to; a new family is often the honest answer.
- Verification loop: `npm run -w chartroom-<pkg> test` and root
  `npm run typecheck`; studio changes also `npm run -w chartroom-studio e2e`.
  In a sandbox with a pre-installed browser, set `CHROMIUM_PATH` (the config
  reads it; never hard-code a path). Always read `EXIT=` from a backgrounded
  verify log — the task's own exit code is the trailing `echo`'s.
- Tests that spawn a server must claim their own port block and wait on the
  route under test, not `/api/health` — every server here answers health, so
  a collision otherwise binds you to a stranger and fails somewhere else.
- Anything the (Phase-2) data critic catches deterministically graduates into a
  linter rule — tag with `TODO(linter-graduation)`.
- Audit: every server mutation writes `chartroom_audit`, with the actor. A
  mutation without an audit row is a test failure (`apps/chartroom-api/test/api.test.ts`).
- Prefer refusing to guessing, and say so where the reader will see it: a
  renderer that cannot draw something honestly renders the reason instead
  (ADR-44/45). If a docstring claims a safety property, verify the code
  actually has it — ADR-44 shipped a claim the arithmetic could not support.
