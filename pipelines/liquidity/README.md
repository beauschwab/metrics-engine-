# Daily liquidity pipeline — reference implementation

An Airflow pipeline that sources daily liquidity positions from source systems
under **Open Data Contracts**, conforms and normalizes them with **dbt-core**,
then calls the **rules-engine registry** (this repo's `packages/registry`) for
business-rule application, the **LCR calculation**, and the **FR 2052a daily
submission**. Spark over Iceberg — reached through the Apache Kyuubi
gateway — is the product target for every compute step; development and CI
run the identical pipeline on DuckDB.

Proven end to end: 35 pytest checks — contract refusal, conformance, rule
coverage, sub-partition isolation, LCR arithmetic, filing grain, idempotent
re-runs, plan-vs-row-stage reconciliation — plus full `airflow dags test`
executions of both DAGs and inspection of the asset events they record.

Two DAGs, joined by **partitioned Airflow 3.3 assets** rather than by an
edge or a cron:

```
daily_liquidity_conformance · CronPartitionTimetable("45 5 * * 1-5")   ⬢ = Asset
  land_gl_core  ─→ enforce ─→ conform ──→ ⬢ …positions@gl_core   ┐
  land_murex_eu ─→ enforce ─→ conform ──→ ⬢ …positions@murex_eu  │ one slice
  land_treasury ─→ enforce ─→ conform ──→ ⬢ …hqla@treasury       ┘ per source

daily_liquidity_regulatory · PartitionedAssetTimetable(all three slices)
  resolve_partition ─→ fetch_release ─→ apply_rules ─→ file_2052a ──→ ⬢ reg.fr2052a_daily
                                            └────────→ calculate_lcr → ⬢ reg.lcr_daily
                                                       └──── reconcile ─┘
```

## Assets and partitioning (Airflow 3.3, AIP-76)

The conformed tables are partitioned by day and **sub-partitioned by
producing source system** — `(as_of_date, source_system)`. Each feed's chain
replaces exactly its own slice (dbt incremental on the composite key in dev;
Iceberg dynamic `insert_overwrite` over the two-level partition spec in
prod), so the feeds land, validate and conform independently: a late Murex
extract delays the Murex sub-partition, not the GL one.

Partitions here are **scheduler state, not a convention**. The conformance
DAG runs under a `CronPartitionTimetable` keyed `%Y-%m-%d`, so each run *is*
a batch date and every asset event it emits carries that key. Tasks read
`dag_run.partition_key` — there is no logical-date arithmetic and no
agreement to encode the slice into an event's `extra`.

Because Airflow aligns *assets* on a shared key, each `(table,
source_system)` slice is its own asset — `alm.fct_2052a_positions@murex_eu`
— and the regulatory DAG names all three in one condition:

```python
schedule=PartitionedAssetTimetable(
    assets=positions@gl_core & positions@murex_eu & hqla@treasury
)
```

The scheduler then starts that DAG for a date exactly once, when every
slice for that date has been conformed, and hands it the key. "Wait for all
feeds" is a property of the asset graph rather than a sensor or a
convention the consumer has to re-implement. The table-level assets are
still updated alongside each slice, for consumers that subscribe to the
table as a whole: **slices schedule, tables describe.**

(The alternative — one composite `feed|date` key rolled up with
`RollupMapper` — needs a categorical window that keeps the temporal
segment, and the built-in `SegmentWindow` deliberately ignores the anchor,
so it fits a pure-categorical rollup rather than this one.)

## Run it

```bash
cd pipelines/liquidity
uv sync                                  # Airflow 3.3 + dbt-duckdb + DuckDB
uv run pytest                            # the end-to-end proof, hermetic

# the same runs, executed by Airflow:
export AIRFLOW_HOME=$PWD/.local/airflow \
       AIRFLOW__CORE__DAGS_FOLDER=$PWD/dags \
       AIRFLOW__CORE__LOAD_EXAMPLES=false
uv run airflow db migrate
uv run airflow dags test daily_liquidity_conformance 2026-06-30
uv run airflow dags test daily_liquidity_regulatory 2026-06-30
```

Under a real scheduler the second command is unnecessary — the regulatory
DAG is started by the scheduler once all three slices for a date exist.
Note that `dags test` builds a *manual* run, which carries no partition key;
`batch_date()` falls back to the logical date so a test run still targets a
specific batch. Partition keys are assigned by the scheduler, and the
end-to-end scheduler proof is described under "What is proven" below.

## Deploying to a Kubernetes Airflow (non-prod)

One command, two delivery modes, matching how Kubernetes Airflow instances
actually consume DAGs:

```bash
# instance uses the Helm chart's git-sync sidecar (the common setup):
DAGS_GIT_URL=git@github.com:beauschwab/airflow-dags.git \
  ./scripts/deploy_dags.sh --mode git

# instance mounts a shared DAGs volume (PVC) — quick push, no git round trip:
AIRFLOW_NAMESPACE=airflow-nonprod ./scripts/deploy_dags.sh --mode kubectl
```

The script stages a self-contained bundle — the two DAG files plus
everything they resolve at run time (`liquidity_pipeline/`, `contracts/`,
`dbt/`, `registry_snapshot/`), a `.airflowignore` keeping the parser out of
the non-DAG directories, and a `BUILD_INFO` recording the source commit —
then either commits it to the branch/subdir git-sync watches (deploy is a
push, rollback is a revert, identical re-pushes are a no-op) or streams it
into the pods' DAGs path over `kubectl exec`. The bundle root becomes the
DAGs folder, which is what puts `liquidity_pipeline` on the scheduler's
`sys.path`; discovery from a pushed bundle is proven by cloning it back and
running `airflow dags reserialize` + `dags list` against it.

[`deploy/airflow-values.nonprod.yaml`](deploy/airflow-values.nonprod.yaml)
is the matching overlay for the official Airflow Helm chart: git-sync
pointed at the deploy branch, the pipeline's env (`LIQ_TARGET`,
`LIQ_DATA_DIR=/tmp/liquidity` — git-sync volumes are read-only, and dbt's
build output is already routed to the data dir for the same reason —
`KEEL_BASE_URL`, `KYUUBI_*`), and the worker dependencies via
`_PIP_ADDITIONAL_REQUIREMENTS` for a sandbox or a baked image for anything
more. Airflow 3.3+ is required — the DAGs use first-class asset partitions.

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
conformance.

The Spark path goes through **Apache Kyuubi**: nothing in the pipeline owns
a SparkSession. Kyuubi is the multi-tenant gateway in front of the Spark
fleet — the pipeline's backend and dbt (`method: thrift`) both connect to
its HiveServer2-compatible front end (`KYUUBI_HOST` / `KYUUBI_PORT` /
`KYUUBI_USER`) as the same service identity, submit Spark SQL, and
disconnect; engine pooling, share level and the Iceberg catalog
(`spark.sql.catalog.*`) are Kyuubi engine configuration, never client
configuration. Landing declares external CSV tables over the object-store
locations the contracts name (string-typed — the contract casts, not the
loader), conformance builds Iceberg tables via `insert_overwrite` over the
`(as_of_date, source_system)` partition spec, and the report writer uses
Iceberg's dynamic `INSERT OVERWRITE` — the `overwrite_partitions` contract
the governed report document declares, with the dynamic mode riding the
connection's session-configuration overlay. `uv sync --extra prod` pulls the
Thrift clients (PyHive and dbt-spark's PyHive extra); the backend's emitted
SQL is pinned by unit tests against a stub connection.

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
than silently matching no rule. `dbt build` runs models and tests together.

A conformance run is per feed: `--select +fct_2052a_positions` with the
`source_system` var restricts the batch to one system, and the incremental
composite key `(as_of_date, source_system)` replaces exactly that
sub-partition of the day — `delete+insert` on DuckDB, Iceberg dynamic
`insert_overwrite` over `partition_by: [as_of_date, source_system]` on
Spark. Re-running one feed never touches a sibling's rows (pinned by the
sub-partition isolation test).

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

## Scenarios: the same rules over a different world

A scenario is an **input**, not a model. `liquidity_pipeline/scenarios.py`
runs the pipeline over a stressed book — deposits running harder than
contract, inflows that do not arrive, a monetisation haircut on the buffer —
while the rates, the FR 2052a classification, the LCR formula and the
compiled submission plan stay exactly what the registry's `production`
channel serves.

```python
from liquidity_pipeline import scenarios
scenarios.compare("2026-06-30")     # every scenario, side by side
```

Each scenario runs in **its own warehouse** (a separate DuckDB file in dev, a
separate catalog in prod), so two runs share nothing at all except the
registry release — no filtered table, no rewritten plan. `compare()` asserts
that: if the runs were computed against different releases it raises, because
a base-vs-stress comparison across two rule versions is not a comparison.

Against release r2 (`O.W.2` at 50%), on the same book:

| | base | stress | |
| --- | --- | --- | --- |
| HQLA | $390,919,734.51 | $344,009,366.38 | ×0.88 haircut |
| filed weighted outflows | $47,972,038.05 | $59,965,047.53 | ×1.25 run |
| net outflows, 30d | $30,398,391.34 | $47,663,494.85 | |
| **consolidated LCR** | **1286.0%** | **721.7%** | −564.3pp |

The stress multipliers are illustrative of a Reg YY-style internal liquidity
stress (12 CFR 252.35), not a calibrated scenario; a real deployment would
source them from a governed scenario artifact rather than a constant in a
simulator.

**Not a forecast.** Nothing here projects a balance sheet forward — a
scenario re-prices *today's* book under different assumptions. Multi-period
projection is a genuine modelling capability this pipeline does not have. The
seam is the same shape (the registry computes a period's number given that
period's positions, so a forecast is a question of who supplies the
positions), but it is not built and is not claimed.

## What is proven

The DuckDB path is exercised end to end, and the partition machinery is
exercised where it actually lives — in the scheduler.

- **pytest** — contract refusal by named check, conformance across both
  source systems, sub-partition isolation (re-conforming `gl_core` leaves
  `murex_eu` byte-identical), rule coverage with zero unmapped positions,
  LCR arithmetic, filing grain, idempotent re-runs, the plan-vs-row-stage
  tie-out, the Kyuubi backend's emitted SQL against a stub connection, and
  the DAG/asset/partition wiring.
- **`airflow dags test`** — both DAGs run to `state=success`, and
  `scripts/check_asset_events.py` reads the metadata DB to confirm every
  slice and table asset received an event. A `dags test` run is *manual*, so
  it carries no partition key; this is the path `batch_date()`'s logical-date
  fallback covers.
- **A real scheduler** — the AIP-76 claim cannot be made by `dags test`,
  because partition keys are assigned when the *scheduler* creates a run
  from a partitioned timetable. Running `airflow standalone` against these
  DAGs (with the conformance cron narrowed so a slot falls immediately)
  produces exactly the designed behaviour:

  | run | type | partition key | state |
  | --- | --- | --- | --- |
  | `daily_liquidity_conformance` | `scheduled` | `2026-08-22` | success |
  | `daily_liquidity_regulatory` | `asset_triggered` | `2026-08-22` | success |

  All twelve asset events that run emitted carry the key — the three
  conformed slices, both table assets, and the three regulatory outputs.
  The regulatory run was created from slice alignment alone: no cron, no
  sensor, and nothing in the DAG that reads a logical date.

An earlier scheduler run also surfaced something `dags test` never could.
`dags test` executes tasks one at a time, so the three feed chains had never
actually run concurrently; under a real executor they did, and collided on
the DuckDB warehouse file — one file, one writer. The fix is in
`warehouse_lock.py`: an advisory lock the dev engine holds while a process
has the warehouse open, taken by both writers (the backend and dbt's
subprocess), and a no-op on Kyuubi, where each connection gets its own Spark
engine and Iceberg handles concurrent partition writes. Retries would have
hidden it; the constraint is deterministic, so it is enforced deterministically.

## Layout

```
contracts/               ODCS v3 data contracts, one per inbound feed
dags/                    the two Airflow DAGs (thin: every body is in liquidity_pipeline/)
dbt/                     conformance project; profiles for duckdb + spark/iceberg
liquidity_pipeline/      contracts enforcement, asset definitions, backends,
                         registry client, rules application, LCR, task bodies
registry_snapshot/       captured runtime responses from the deployed channel
scripts/                 snapshot refresh
tests/                   contract refusal, DAG + asset wiring, live registry, the e2e proof
```

## Known limits, stated on purpose

- The registry compiles plans against its pinned as-of date; `rebind_as_of`
  substitutes exactly one date literal and fails loudly on any other shape.
  The right fix is an `asOf` parameter on the plan endpoint.
- The Kyuubi backend and dbt-spark thrift profile are written to the same
  seams the DuckDB path proves, and their emitted SQL is unit-tested against
  a stub connection — but no gateway is stood up in this repo's CI. They
  assume a Kyuubi whose engines carry the Iceberg catalog config, and
  authentication (LDAP/Kerberos) is left to the deployment.
- Contract enforcement implements the ODCS subset it documents
  (`contracts.py` docstring); SLA and team blocks are carried, not enforced.
