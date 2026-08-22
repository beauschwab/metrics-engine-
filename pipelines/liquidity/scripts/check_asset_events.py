"""Assert the conformance run recorded the asset events the design promises.

Run after `airflow dags test daily_liquidity_conformance <date>` with
AIRFLOW_HOME pointing at the same scratch home. The regulatory DAG's whole
scheduling contract is these events — one per conformed sub-partition, each
carrying its partition key in the extras — so CI checks the metadata database
rather than trusting the task logs.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

home = Path(os.environ.get("AIRFLOW_HOME", ".local/airflow"))
con = sqlite3.connect(home / "airflow.db")
rows = con.execute(
    "SELECT a.name, e.extra FROM asset_event e JOIN asset a ON a.id = e.asset_id"
).fetchall()

seen: dict[str, set[str]] = {}
for name, extra in rows:
    payload = json.loads(extra) if extra else {}
    if "source_system" in payload and payload.get("as_of_date"):
        seen.setdefault(name, set()).add(payload["source_system"])

expected = {
    "alm.fct_2052a_positions": {"gl_core", "murex_eu"},
    "alm.fct_liquidity_position": {"treasury"},
}
missing = {
    table: sorted(subs - seen.get(table, set()))
    for table, subs in expected.items()
    if subs - seen.get(table, set())
}
if missing:
    print(f"missing sub-partition asset events: {missing}", file=sys.stderr)
    sys.exit(1)

print("asset events recorded:", {t: sorted(s) for t, s in seen.items() if t in expected})
