"""Where everything lives, resolved once.

Every path is anchored on the pipeline root (the directory holding
``pyproject.toml``) so the DAG, the tests and a shell all agree regardless of
their working directory. The environment variables are the whole configuration
surface:

  LIQ_TARGET     duckdb (default) or spark — which execution backend runs the
                 rules, the LCR and the report. dbt reads the same value to
                 pick its profile target.
  LIQ_DATA_DIR   where landed extracts and the dev warehouse live; defaults to
                 ``.local/`` under the pipeline root, which is gitignored.
  KEEL_BASE_URL  the rules registry. Unset means the committed snapshot under
                 ``registry_snapshot/`` — same bytes, no server; see
                 registry_client.py for why that is safe.
  KEEL_CHANNEL   the deployment channel to dereference (default: production).
"""

from __future__ import annotations

import os
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent

CONTRACTS_DIR = PIPELINE_ROOT / "contracts"
DBT_DIR = PIPELINE_ROOT / "dbt"
SNAPSHOT_DIR = PIPELINE_ROOT / "registry_snapshot"

#: The three inbound feeds, keyed by the name tasks and tests use. Each entry
#: is (contract file, raw table the contract's physicalName declares).
FEEDS = {
    "gl_core": "gl_core.positions_daily.odcs.yaml",
    "murex_eu": "murex_eu.positions_daily.odcs.yaml",
    "treasury": "treasury.hqla_daily.odcs.yaml",
}


def target() -> str:
    return os.environ.get("LIQ_TARGET", "duckdb")


def data_dir() -> Path:
    d = Path(os.environ.get("LIQ_DATA_DIR", PIPELINE_ROOT / ".local"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def landing_dir(as_of_date: str) -> Path:
    d = data_dir() / "landing" / as_of_date
    d.mkdir(parents=True, exist_ok=True)
    return d


def warehouse_path() -> Path:
    """The dev warehouse: one DuckDB file playing the part of the lakehouse."""
    return data_dir() / "warehouse.duckdb"


def registry_base() -> str | None:
    return os.environ.get("KEEL_BASE_URL") or None


def registry_channel() -> str:
    return os.environ.get("KEEL_CHANNEL", "production")
