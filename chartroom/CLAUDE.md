# Chartroom — agent working agreement

- Read `chartroom-prd.md` and `chartroom-implementation-spec.md` (in the
  session's design uploads) plus `ADRS.md` here before any task. Spec §0
  decisions are pinned; `ADRS.md` records every deviation — propose new ADRs,
  don't silently deviate.
- `chartroom/spec` is pure: no fetch, no fs, no React, no Node APIs. If the
  linter needs data, add it to `LintContext` — contracts are injected, never
  fetched.
- Dependency direction: `spec ← widgets ← studio`, `spec ← server`. Nothing
  imports studio. Enforced by `chartroom/spec/test/boundaries.test.ts` — run it
  before committing.
- Every lint rule: one file in `spec/src/lint/rules/`, golden fixtures in
  `spec/test/fixtures/<RULE>/`, tests asserting findings AND fixes round-trip.
- Never let widgets fetch. Never let format overrides touch units (NUM-01).
  Never bypass promote gates client-side.
- Verification loop: `npm run -w chartroom-<pkg> test` and root
  `npm run typecheck`; studio changes also `npm run -w chartroom-studio e2e`.
- Anything the (Phase-2) data critic catches deterministically graduates into a
  linter rule — tag with `TODO(linter-graduation)`.
- Audit: every server mutation writes `chartroom_audit`, with the actor. A
  mutation without an audit row is a test failure (`server/test/api.test.ts`).
