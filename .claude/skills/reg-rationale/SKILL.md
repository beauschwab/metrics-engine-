---
name: reg-rationale
description: The protocol for attaching business rationale to governed rules and carrying it through to dashboards. Use this whenever authoring, reviewing, or explaining a registry rule that claims a regulatory basis — a classification rule, rate table entry, threshold, or measure with a citation — and whenever a dashboard, exception, or committee pack needs to say WHY a number is what it is. Load it before writing any citation field, revision message, or acknowledgeReview, and alongside any regime skill (fr2052a-report, lcr-rule, nsfr-rule, reg-yy-liquidity, fr-y15-stwf, pillar3-liquidity-disclosure).
---

# Attaching business rationale, registry through dashboard

A number in this platform can prove *what* it is (the trace, the compilation,
the revision history). Rationale is how it proves *why* it is — and rationale
that lives in a slide deck instead of the registry is rationale an examiner
cannot find and an agent cannot check. This skill says where each piece of
rationale lives, so it travels with the rule to every surface that renders it.

## Where rationale lives — the five anchors

The platform already has a home for every layer of "why". Use them; never
invent a side channel (a comment file, a wiki page, prose in a chat).

1. **The `citation:` field** — the regulatory basis, on the rule / rate /
   threshold / measure itself. This is machine-checked: a tier ≥ 1 measure
   without one is a KEEL031 *error* that blocks a save, and `assess_change`
   reports every rate that moved without its citation moving. Format it as
   the most specific locator that exists: `12 CFR 249.32(h)(2)`, not "the
   LCR rule"; `FR 2052a Instructions, O.D table` not "the Fed instructions";
   `SR 96-13` for supervisory letters. The regime skills carry the citation
   maps.
2. **The `description:` field** — the business meaning, in the author's
   vocabulary: what the measure computes and why it exists. Required at
   tier ≥ 1 (KEEL030). Write it for the committee member, not the compiler.
3. **The revision `message`** — the rationale for *this change*: what
   business event or regulatory change motivated it. It lands in the
   append-only history next to the author's name. "Edited" is not a
   rationale; "Q3 rate refresh per 2026-07 instructions update" is.
4. **The `acknowledgeReview` record** — when `assess_change` reports
   `needsReview: true`, the change weakens a control (silences breaches,
   reclassifies filed records, drops a dimension). The acknowledgement is
   recorded against the revision *with what was silenced*. Never acknowledge
   on the human's behalf: report the finding, state the rationale you would
   record, and let the human decide — the acknowledgement is their act.
5. **The governed threshold id** — a `variance_monitor` threshold
   (`SIGMA-30`, `HARD-USD`, …) is a named, cited, effective-dated object.
   Its id is the code a dashboard's exception strip shows, so a breach on a
   board traces to a threshold a steward can open — this is the pipe that
   carries rationale *through to dashboards*.

## The flow, end to end

```
citation on the rule  ──►  rule resolved by the engine  ──►  measure served
        │                                                        │
        ├─ description (business meaning)                        ├─ dashboard widget binds the measure
        ├─ revision message (why this change)                    ├─ metric contract carries description + status
        └─ monitor threshold (cited limit)  ────────────────────►└─ exception strip shows the threshold id
```

A reader who clicks from a breach code on a board must be able to reach the
cited threshold; a reviewer who opens a rule must find its citation, meaning,
and change history without leaving the registry. If any hop would break, fix
the hop — do not paste the rationale into the dashboard.

## The agent validation loop

When you (an agent) author or review a rule claiming a regulatory basis:

1. **Read before writing.** `get_lineage` first — `usedBy` is the list of
   things your change breaks. `get_history` — a rule three people have tuned
   carries rationale you must not silently overwrite.
2. **Check the citation against the regime skill.** Load the matching regime
   skill and verify: the cite is specific, it actually governs what the rule
   does, and the rate/threshold matches what that provision requires. A
   citation that names the wrong subsection is worse than none — it launders
   an ungoverned number.
3. **Prove, don't assert.** `validate` (the same catalogue a human is held
   to), `test_rules` (records matching no rule are the headline number),
   `preview_report` (what would actually file), and always `assess_change`.
4. **Present with the evidence attached.** The final body goes to the human
   in full, with: what the assessment said, which citations you added or
   moved, and the revision message you propose. The save is the human's act,
   under their own name.

## What to refuse

- A rule body with an empty or vague citation at tier ≥ 1 — the diagnostics
  will block it anyway; refuse earlier and say why.
- A request to "just update the rate" without moving its citation or stating
  a rationale — that is exactly the drift `assess_change` exists to catch.
- Putting a limit, rate, or rationale in a dashboard spec or client code —
  dashboards reference governed objects; they do not define them.
- Acknowledging a review finding yourself, ever.
