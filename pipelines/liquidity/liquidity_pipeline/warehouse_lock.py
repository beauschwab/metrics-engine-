"""Serialize writers against the development warehouse.

The per-feed chains are meant to run in parallel — that is the point of
modelling each source system as its own sub-partition. Under Kyuubi that is
free: the gateway hands each connection its own Spark engine, and Iceberg
handles concurrent partition writes.

DuckDB does not. One file, one writer: two tasks opening the warehouse at
the same moment produce an IO error, and the first real scheduler run of
this pipeline failed exactly that way — `land_gl_core` and `land_treasury`
colliding while `airflow dags test` (which runs tasks one at a time) had
never shown it.

So the *dev engine* serializes, at the only place that knows it has to: an
advisory lock beside the warehouse file, held for as long as a process has
it open. Retries were the alternative and are worse — they turn a
deterministic constraint into a race that usually converges, and leave red
task instances in the history of a run that was never actually broken.

Both writers go through here: the backend (which opens a connection) and
dbt (which opens its own, in a subprocess).
"""

from __future__ import annotations

import fcntl
from contextlib import contextmanager
from pathlib import Path

from . import config


@contextmanager
def warehouse_write_lock(target: str | None = None):
    """Hold the dev warehouse exclusively; a no-op on every other engine."""
    if (target or config.target()) != "duckdb":
        yield
        return

    lock_path = Path(str(config.warehouse_path()) + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w") as handle:
        # Blocking: a task that has to wait its turn is correct behaviour,
        # and the waits are seconds — a dbt build, a CSV load.
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
