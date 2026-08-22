"""Test scaffolding: every test runs against a throwaway warehouse.

LIQ_DATA_DIR is pointed at a per-session tmp dir, so landed files, the DuckDB
warehouse and run records never touch the developer's .local. KEEL_BASE_URL
is cleared so the default path under test is the committed snapshot — the
hermetic mode CI uses; the live-registry test opts back in explicitly.
"""

from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def isolated_data_dir(tmp_path_factory):
    data = tmp_path_factory.mktemp("liq-data")
    os.environ["LIQ_DATA_DIR"] = str(data)
    os.environ.pop("KEEL_BASE_URL", None)
    os.environ.setdefault("LIQ_TARGET", "duckdb")
    yield data
