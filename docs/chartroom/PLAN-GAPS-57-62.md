# Closing ADR-57–62 — the hardening plan

Status: Phase A shipped; B-E not started · Owner: platform ·
Prereq reading: `ADRS.md` (the "Proposed" section, ADR-57–62), `product.md` §7,
the exec pitch's "hard questions" appendix

This plan sequences the six proposed ADRs into five phases, in the order the
*pilot* needs them rather than the order they were found. Two are pilot
prerequisites (the human seam, the ingestion left edge), one is the pilot's
method (divergence machinery), two run during the pilot (the agent evidence
file, vocabulary growth on demand). The stubs in `ADRS.md` are authoritative
on intent; when a phase ships, its stub is fleshed out in place and loses the
"proposed" mark — where this plan and the shipped ADR disagree, the ADR wins.

What does not change, in any phase: approvals, saves, and promotion stay
human-only; `agent:*` refusals stay structural; no raw SQL enters a spec; the
row-stage vocabulary stays closed (it grows by governed addition, never by
escape hatch); deviations from this plan get ADRs.

---

## Dependency picture

```
Phase A (ADR-57, human seam) ──┐
                               ├──► pilot start ──► Phase C.4 (ADR-60, filing seam)
Phase B (ADR-58, left edge) ───┤          │
                               │          ├──► Phase D (ADR-59, agent evidence) — during
Phase C.1–C.3 (ADR-61,        ─┘          └──► Phase E (ADR-62, vocab growth) — on demand
  divergence machinery)
```

A and B are independent of each other; both gate the pilot. C.1–C.3 is the
pilot's method and must exist at pilot start. C.4 reuses C's machinery and is
blocked externally on a filing extract. D and E run inside the pilot window.

---

## Phase A — the human seam (ADR-57) · pilot prerequisite — SHIPPED

The agent↔human seam is structural; this phase makes the human↔human seam
match it, enforced in the same layers the agent refusals live in — never the
client.

| Epic | Scope | Size |
|---|---|---|
| **A.1 Identity required for writes** | `KEEL_REQUIRE_IDENTITY=1` mode: the registry's write routes (`PUT` artifact, releases, promote) refuse a request with no asserted identity, with a message naming the control. Identity keeps coming only from `KEEL_IDENTITY_HEADER` (the seam built for SSO) — never the body. registry-web sends the asserted identity through the dev proxy; production is the reverse proxy's job and is documented as such. | S |
| **A.2 Second-person acknowledgement** | Today `acknowledgeReview` rides the author's own save. Enforce at the gates that already exist: a tier-1 revision whose weakening was acknowledged only by its own author is `review_pending`; `create_release` refuses to pin it, and a new `POST /api/artifacts/:name/review` write (different identity required, refused to `agent:*`) records the second name. The author's ack remains what it is — intent — and the second name is the control. | M |
| **A.3 Cutter ≠ sole promoter** | For channels serving tier-1 artifacts, `promoteRelease` refuses when the promoting actor is the release's author unless a second sign-off is recorded against the release. Same shape as A.2, applied one gate later. | S |
| **A.4 Tests in the agent-refusal shape** | Same person, both roles → refused with the control named; identity-less write in required mode → refused; the happy path with two names → recorded against the revision and the promotion. Wire-level (registry api tests) plus one registry-web e2e for the refusal banner. | S |

**Acceptance:** one person cannot author, acknowledge, and promote a tier-1
change end to end; every refusal message names the missing second person; the
audit trail shows two names on every weakening that shipped.

## Phase B — the ingestion left edge (ADR-58) · pilot prerequisite

Lineage grows a left edge so "every number proves itself" starts at arrival,
not at the source table.

| Epic | Scope | Size |
|---|---|---|
| **B.1 `ingestion_contract` document kind** | Parse + registry + diagnostics: expected feeds, arrival window relative to as-of, completeness checks (row count and notional against control totals), GL tie-out tolerance — each check cited and effective-dated, exactly like monitor thresholds. New KEEL1xx diagnostics for a contract naming no feed, an uncited tolerance, an unparseable window. | M |
| **B.2 The arrival ledger** | A fixture-shaped `feed_manifest` input: per as-of, per feed — landed-at, rows, notional, control totals. Fixtures first (the platform's pattern); the warehouse binding is a later column-mapping exercise through the existing `source_binding` machinery, not a new concept. | S |
| **B.3 Contract evaluation onto the strip** | Contracts evaluate like monitors: breaches carry threshold ids (`LAND-*`, `COMPLETE-*`, `TIE-*`) and land on `/api/exceptions` and the analyst strip beside the variance breaches — one place the morning is read. | M |
| **B.4 Lineage's left edge** | Feed nodes ahead of `source_binding`; `usedBy` answers "which filings does this feed's failure touch", and the authoring surface's lineage strip renders the edge. | S |
| **B.5 Skills learn the vocabulary** | `reg-rationale` and `fr2052a-report` gain the contract checklist (a rule claiming a filing regime should name the contract its source rides on); the definition agent can draft contracts but — as everywhere — cannot save them. | S |

**Acceptance:** removing one feed from the fixture manifest breaches the
contract onto the exception strip, naming the filings it touches; the breach
code resolves to a cited tolerance a steward can open.

## Phase C — divergence machinery (ADR-61, then ADR-60) · the pilot's method

Trust becomes a threshold id with a history. Built once, pointed twice: at
the incumbent process (adoption), then across the filing seam
(reconciliation).

| Epic | Scope | Size |
|---|---|---|
| **C.1 External series import** | CSV-grade import of the incumbent's numbers into an `external_series` store keyed by series, grain key, and date. Importing is a *write* — attributed, append-only, refused to `agent:*` — because a benchmark someone can silently restate is not a benchmark. | M |
| **C.2 `basis: external_divergence`** | A monitor basis comparing a governed measure against an external series at shared grain, with absolute / percentage / σ tolerances; breaches carry both values and the delta. Reuses `runMonitor`'s machinery and lands on the same strip. | M |
| **C.3 The divergence walk** | A dashboard pattern: divergence over time per measure with the tolerance band, plus a sign-off record when a measure stays inside tolerance for the agreed window — the cutover criterion as a governed, attributable act. | M |
| **C.4 The filing seam (ADR-60)** | The vendor extract is one more external series, at the filing's own grain: a mapping document for the extract's shape, a fixture-shaped extract to prove the loop, and C.2 pointed across the boundary. Externally blocked on access to one real extract; everything else ships with fixtures. | S |

**Acceptance:** a fixture quarter of parallel-run produces a divergence
report a committee can read without a narrator; the pilot's exit criteria are
threshold ids with histories, not slides.

## Phase D — the agent evidence file (ADR-59) · runs during the pilot

The agents get the file model risk will ask for, built from data already
flowing.

| Epic | Scope | Size |
|---|---|---|
| **D.1 Model-version stamping** | The agent service stamps model id and system-prompt hash on every act; audit rows carry both. A vendor model change becomes a visible event in the trail. | S |
| **D.2 Proposal capture** | Rail hand-overs (the fenced bodies) are logged server-side as proposal records — a log, not a governed write — so accept / reject / edited-before-save rates are computable against what humans actually saved. | M |
| **D.3 The evidence report** | A periodic report: proposals and their outcomes, sampled citation-accuracy checks (the regime skills define the check; a named human reviews the sample), and the period's model-version changes. "Show me the agent's file" becomes one artifact. | M |
| **D.4 The regression gate** | A pinned prompt set re-run when the model version changes, with results recorded before the new version serves either surface. The gate is an operational check, not a scientific eval — its job is to make drift a decision. | M |

**Acceptance:** for any period, one report answers what the agents proposed,
what humans did with it, how often citations checked out, and which model
versions were serving.

## Phase E — vocabulary growth, proved (ADR-62) · on demand

| Epic | Scope | Size |
|---|---|---|
| **E.1 The process, written** | The op-addition path documented where ADR-53 lives: who proposes, the standard an op must meet (stated semantics, all three backends, conformance, explicit refusal behavior for what it cannot do), and the expected lead time. | S |
| **E.2 Proved once** | Add one op a real FR 2052a derivation needs — candidate: `fx_convert` against a governed rate table (currency conversion is the first real book's first gap). The measured lead time from proposal to shipped op becomes the number E.1 publishes. | M |

**Acceptance:** the treasury SME's "what if you don't have my op" has a
documented process with one measured data point behind it.

---

## Ordering and the pilot

1. **Before pilot start:** Phase A and Phase B (parallel), then C.1–C.3.
2. **Pilot quarter:** parallel-run via C; D.1–D.3 accumulate the agent file;
   C.4 lands when extract access does; E fires the first time a real
   derivation needs an op the vocabulary lacks.
3. **Pilot exit:** divergence sign-offs (C.3) + the agent evidence report
   (D.3) + the scale benchmark from the pitch are the exit packet — every
   item a governed artifact, none of them a slide.

Each phase ships behind the platform's standing verification gate (`npm run
verify` green, e2e for surface changes, ADR fleshed out in place), and each
lands as its own PR so a phase can be reviewed — and rejected — on its own.
