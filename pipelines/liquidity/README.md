# Daily liquidity pipeline — reference implementation

An Airflow pipeline that sources daily liquidity positions from source systems
under **Open Data Contracts**, conforms and normalizes them with **dbt-core**,
then calls the **rules-engine registry** (this repo's `packages/registry`) for
business-rule application, the **LCR calculation**, and the **FR 2052a daily
submission**. PySpark over Iceberg is the product target for every compute
step; development and CI run the identical pipeline on DuckDB.

Proven end to end: 22 pytest checks — contract refusal, conformance, rule
coverage, LCR arithmetic, filing grain, idempotent re-runs, plan-vs-row-stage
reconciliation — plus a full `airflow dags test` execution of the DAG itself.

```
land ─→ contracts ─→ dbt ─→ fetch_release ─→ apply_rules ─→ file_2052a ─→ reconcile
(3 feeds, mapped)   (build)  (pin manifest)      │                            ↑
                                                 └────────→ calculate_lcr ────┘
```

## Run it

```bash
cd pipelines/liquidity
uv sync                                  # Airflow 3 + dbt-duckdb + DuckDB
uv run pytest                            # the end-to-end proof, hermetic

# the same run, executed by Airflow:
export AIRFLOW_HOME=$PWD/.local/airflow \
       AIRFLOW__CORE__DAGS_FOLDER=$PWD/dags \
       AIRFLOW__CORE__LOAD_EXAMPLES=false
uv run airflow db migrate
uv run airflow dags test daily_liquidity_position 2026-06-30
```

No server is needed for either: the registry is consumed from the committed
snapshot by default (below). To run against the live registry instead:

```bash
npm run registry                         # repo root, port 8787
./scripts/refresh_registry_snapshot.sh   # cuts + promotes release 1 if fresh
KEEL_BASE_URL=http://localhost:8787 uv run pytest
```

Every stage runs on the engine `LIQ_TARGET` selects — `duckdb` (default) or
`spark` — through two seams that switch together: `backend.for_target()` for
landing, rules, LCR and the report write, and the dbt profile for
conformance. The Spark path lands external tables over the object-store
locations the contracts name, builds the conformed layer as Iceberg tables
(`dbt-spark`, `file_format: iceberg`, `insert_overwrite`), and files the
report with Iceberg's dynamic partition overwrite — the
`overwrite_partitions` contract the governed report document declares.
`uv sync --extra prod` pulls PySpark, dbt-spark and PyIceberg.

## The four stages

### 1 · Sourcing under Open Data Contracts (`contracts/`)

Each inbound feed has an [ODCS v3](https://bitol-io.github.io/open-data-contract-standard/)
document: the GL core positions extract (canonical vocabulary), the Murex EU
book (client shape: `COB_DATE`, Y/N flags, `RTL`/`SBB`/`WSL` codes), and the
Treasury HQLA inventory. `liquidity_pipeline/contracts.py` turns the contract
into executable SQL checks — required columns, castability, domain membership,
composite-key uniqueness, freshness, cross-field rules — and **enforces them on
the raw batch before anything reads it**. A violated contract fails that feed's
task with the producer's broken promise named; nothing downstream runs.

The raw layer is deliberately string-typed: what is validated is what the
producer sent, not what a cast layer made of it. In dev the extracts are
written by deterministic simulators (`simulate.py`) that play the producers;
in prod the landing task pulls from the locations the contracts' `servers`
blocks name.

### 2 · Conformance and normalization with dbt-core (`dbt/`)

Staging models conform each source system to the canonical vocabulary — the
Murex model decodes the same code maps the registry's governed `murex_eu`
source binding declares — and the conformed layer unions them into
`alm.fct_2052a_positions` and `alm.fct_liquidity_position`, the tables every
governed rule compiles against. Schema tests restate the classification
rules' reading assumptions (domains, nullability, key uniqueness, the
secured/collateral invariant), so a vocabulary drift fails the build rather
than silently matching no rule. `dbt build` runs models and tests together;
conformed models replace only the batch date's rows on re-run.

Classification, rates and reporting are deliberately **not** in dbt: a rule
change must never require a dbt PR.

### 3 · Business rules from the registry (`registry_client.py`, `rules.py`)

The pipeline dereferences a deployment **channel** (`production`), never a
release: authors editing in the surface change nothing here until someone
deliberately cuts and promotes. Per run it fetches

- the **manifest** — release version and pinned artifact revisions, logged
  into the run record, because "which rules computed this file" is the first
  question anyone asks;
- the **classification** `fr2052a_product_id` in evaluation order, applied as
  an ordered CASE chain (`O.D.1` before `O.D.3` is a 3% vs 10% run-off);
  `on_no_match: error` is honored — an unmapped position fails the run with
  the offending rows named;
- the **rate table** `lcr_outflow_rates` at the manifest's revision, inlined
  as a literal mapping exactly as the registry's own compiler does;
- the **compiled plan** for `fr2052a_submission`, which the report step
  executes byte-for-byte (one documented as-of rebind — see
  `rules.rebind_as_of`).

With `KEEL_BASE_URL` unset, the same responses come from
`registry_snapshot/` — captured HTTP bytes, refreshed by
`scripts/refresh_registry_snapshot.sh`. Releases are immutable, so a snapshot
of release N *is* release N; CI asserts the committed snapshot still matches
what a live channel serves.

### 4 · LCR and FR 2052a (`lcr.py`, `rules.run_submission`)

The rules stage materializes `reg.fr2052a_enriched` — every position with the
rule that fired, the rate it drew, and its weighted amount: the audit trail
behind both outputs. From it, `reg.lcr_daily` is computed per entity and
consolidated (weighted outflows and inflows in the 30-day window, inflows
capped at 75% of outflows, net floored at zero, HQLA from the unencumbered
Treasury inventory), the consolidated cut taken from positions rather than by
summing entities because the cap does not distribute. The submission itself,
`reg.fr2052a_daily`, is filed by the registry-compiled plan at the declared
grain (product × maturity bucket × currency × entity), partition-overwritten
per day so re-runs are idempotent.

`reconcile` then ties the run together before it is publishable: the plan's
filed outflows against the pipeline's own row-stage aggregation (two
executions of the same governed logic, agreeing within the plan's declared
per-row cent rounding), grain uniqueness, and balance conservation from
conformed to enriched. The run record under `.local/runs/<date>/` carries the
release, every check, and the headline LCRs.

## Layout

```
contracts/               ODCS v3 data contracts, one per inbound feed
dags/                    the Airflow DAG (thin: every body is in liquidity_pipeline/)
dbt/                     conformance project; profiles for duckdb + spark/iceberg
liquidity_pipeline/      contracts enforcement, backends, registry client,
                         rules application, LCR, task bodies
registry_snapshot/       captured runtime responses from the deployed channel
scripts/                 snapshot refresh
tests/                   contract refusal, DAG wiring, live registry, the e2e proof
```

## Known limits, stated on purpose

- The registry compiles plans against its pinned as-of date; `rebind_as_of`
  substitutes exactly one date literal and fails loudly on any other shape.
  The right fix is an `asOf` parameter on the plan endpoint.
- The Spark backend and dbt-spark profile are written to the same seams the
  DuckDB path proves, but are not exercised by this repo's CI — they assume a
  worker whose Spark session has an Iceberg catalog configured.
- Contract enforcement implements the ODCS subset it documents
  (`contracts.py` docstring); SLA and team blocks are carried, not enforced.
