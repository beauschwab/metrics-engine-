# Consuming the registry at run time

This is the contract a pipeline or an application uses to get transformation
logic out of the registry. It is deliberately small: **four GETs and no SDK
required.**

- [`python/keel_runtime.py`](python/keel_runtime.py) — a zero-dependency client
- [`python/run_2052a_duckdb.py`](python/run_2052a_duckdb.py) — a worked example,
  end to end, against a client-shaped table

Both are executed by `server/client-example.test.ts` on every run, so the code
here is checked rather than described.

---

## The lifecycle: why you never read the working copy

The authoring surface saves every settled edit as a revision, automatically.
That is good for authors and would be poison for you: whatever you read would
change mid-afternoon because somebody was typing.

So editing and deploying are separate acts.

| | what it is | who does it | what it changes for you |
| --- | --- | --- | --- |
| **revision** | one saved edit | an author, constantly | nothing |
| **release** | every artifact pinned at one revision, immutable | someone deliberately, `POST /api/releases` | nothing yet |
| **promotion** | a channel now points at a release | someone deliberately, `PUT /api/channels/{name}` | everything |

**You dereference a channel, never a release.** `production` and `staging` are
names; what they point at changes only when a human or a pipeline promotes.
Rollback is repointing the channel at an older release — nothing is edited back,
and the old release is still exactly what it was.

Every promotion records who did it, when, and why. `GET /api/channels/production`
returns that history, so *"what were we computing on the 14th"* is a query.

### The gate

A promotion that weakens something — silences a monitor threshold, restates
filed history, drops a dimension from a submission — is **refused** unless the
caller passes `acknowledgeReview: true`, and the acknowledgement is written into
the promotion record. The comparison is against what that channel currently
serves, so it judges rollbacks too.

---

## The contract

### `GET /api/runtime/{channel}` — the manifest

```json
{
  "channel": "production",
  "release": { "version": 7, "promotedAt": "2026-06-30T09:14:02Z", "promotedBy": "aparna" },
  "artifacts": [
    { "name": "fr2052a_product_id", "kind": "classification", "stage": "prepare",
      "revision": 12, "contentHash": "9f2c…" }
  ]
}
```

**This is your poll target and your cache key.** Releases are immutable — the
same version is always the same bytes — so cache everything else against
`release.version` and re-fetch only when it moves. There is no need to poll
faster than your own runs.

### `GET /api/runtime/{channel}/plan/{report}?target=sql`

The compiled plan, as the deployed release defines it. `target` is `sql`,
`polars` or `pyspark`.

The `text` is the **whole** plan, materialize step included — you are the
pipeline, and writing the sink is your job. `split_plan()` in the client
separates the read half if the write is handled by other machinery.

Add `&binding=…` when your table is not shaped like the canonical source; see
below.

### `GET /api/runtime/{channel}/rules/{classification}?asOf=…`

The rule set resolved to **evaluation order**, with each rule's condition,
emitted value and citation. For clients that apply rules themselves rather than
running SQL.

> First match wins, so a rule's position is part of its meaning. Apply them in
> the order given. This endpoint exists so you never re-derive that from YAML.

`asOf` selects the version in force on a date — rule sets are effective-dated.

### Errors

A `400` is a refusal with a reason: an unfaithful binding, an unknown target.
Read it, do not retry. The client raises `KeelError` carrying the registry's own
words.

---

## When your columns are not the canonical columns

The rules are written once against canonical names — `balance_usd`, `segment`,
`is_secured`. Your system almost certainly does not use them. Murex calls the
balance `BAL_AMT_USD` and codes the segment `RTL`/`WSL`/`SBB`.

The tempting fix is to compile a different plan per system. Don't: that is N
plans to keep conformant, and the whole point of the compiler is that there is
one.

**Instead, register a `source_binding` and the registry generates an adapter
view.** Your table is presented under the canonical names, and the canonical
plan runs on top of it — byte-identical to the plan every other system runs.

```yaml
version: 1
kind: source_binding
name: murex_eu
binds: alm.fct_2052a_positions      # the canonical source it stands in for
table: murex.v_liq_positions        # your table

columns:
  - canonical: balance_usd
    column: BAL_AMT_USD

  - canonical: segment
    column: CUST_SEG
    map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}
```

Two kinds of difference, both real:

- **Names** — a rename in the generated view.
- **Vocabularies** — `map:` becomes a `CASE`, and an unmapped client code
  becomes **NULL**, not the raw code. NULL lands in classification coverage as
  *unmapped*, which is where the surface already makes gaps visible; passing the
  raw code through would make it fail every rule while looking like data.

A binding is a governed artifact — revisioned, releasable, reviewable — because
a wrong mapping changes what a number means exactly as much as a wrong rule
does.

### The check that makes this safe

Ask for a plan with `&binding=murex_eu` and the registry first verifies the
binding can *faithfully* stand in for the canonical source. Two refusals:

**A column the rules read that you did not map.** Survivable — it would fail
loudly in your engine — but there is no reason to let it get that far.

**A vocabulary that can never produce a value some rule tests for.** This is the
one the check exists for. Omit `SBB: SMALL_BUSINESS` and the small-business rule
never fires on your system, *forever*. Every number still computes. Every
coverage report still looks clean. Nothing downstream can see it. So:

```
400  refusing to serve murex_eu: the adapter would not be faithful:
       · the rules test segment = 'SMALL_BUSINESS', and no client value maps to
         it — that rule can never fire on murex_eu
```

### Applying it

```python
plan = client.plan("fr2052a_submission", target="sql", binding="murex_eu")

for statement in plan["adapter"]["statements"]:   # already split, in order
    connection.execute(statement)

connection.execute(plan["text"])                  # the canonical plan, unchanged
```

Use `adapter["statements"]`. Do **not** split `adapter["sql"]` on `;` — that
makes you a small, wrong SQL parser, and a semicolon inside a comment or a
string literal breaks it. `adapter["sql"]` is the same thing whole, for humans
and for migration files.

For clients that reshape a DataFrame instead of standing up a view,
`adapter["model"]` is the same mapping as data: `{renames, maps}`.

---

## Running the example

```
pip install duckdb

python clients/python/run_2052a_duckdb.py \
    --base http://localhost:8787 \
    --channel production \
    --report fr2052a_submission \
    --binding murex_eu \
    --db positions.duckdb
```

It prints the release it used to stderr. **Log that with every run** — *"which
rules computed this file"* is the first question anyone asks about a regulatory
submission, and the release version is the whole answer.
