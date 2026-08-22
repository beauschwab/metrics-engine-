"""Assert the conformance run recorded the asset events the design promises.

Run after `airflow dags test daily_liquidity_conformance <date>` with
AIRFLOW_HOME pointing at the same scratch home. The regulatory DAG's whole
scheduling contract is these events — one per conformed sub-partition slice,
plus the table-level event a downstream consumer subscribes to — so CI checks
the metadata database rather than trusting task logs.

On partition keys: under Airflow 3.3 the key is scheduler state
(``asset_event.partition_key``), set when the *scheduler* creates a run from
a partitioned timetable. ``airflow dags test`` builds a manual run with no
key, so this script requires the slice coverage and reports keys only when
the events actually carry them — a scheduler-created run then shows them
here without the check needing to change.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

home = Path(os.environ.get("AIRFLOW_HOME", ".local/airflow"))
con = sqlite3.connect(home / "airflow.db")
rows = con.execute(
    "SELECT a.name, e.partition_key FROM asset_event e JOIN asset a ON a.id = e.asset_id"
).fetchall()

seen: dict[str, set[str | None]] = {}
for name, key in rows:
    seen.setdefault(name, set()).add(key)

expected = {
    # the sub-partition slices the regulatory DAG's asset condition aligns on
    "alm.fct_2052a_positions@gl_core",
    "alm.fct_2052a_positions@murex_eu",
    "alm.fct_liquidity_position@treasury",
    # the table-level assets, for consumers that want the table as a whole
    "alm.fct_2052a_positions",
    "alm.fct_liquidity_position",
}
missing = sorted(expected - set(seen))
if missing:
    print(f"missing asset events: {missing}", file=sys.stderr)
    sys.exit(1)

keys = {k for name in expected for k in seen[name] if k}
print(f"asset events recorded for {len(expected)} assets", end="")
print(f"; partition keys: {sorted(keys)}" if keys else "; no partition keys (manual run)")
