"""The parity harness (E8.3, ADR-39): the fixture path is the oracle.

A real chartroom-server is spawned (fixtures backend — the in-process
Evaluator). Its `/api/warehouse/manifest` builds the DuckDB warehouse, and
then every query shape runs against BOTH paths; values must agree within
1e-6 relative. Same rows, two engines — this is the MASS-01 discipline
turned cross-backend.
"""

import math
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from chartroom_agent.warehouse import QueryError, Warehouse

REPO = Path(__file__).resolve().parents[3]
PORT = 8600 + (os.getpid() % 90)
API = f"http://127.0.0.1:{PORT}"


@pytest.fixture(scope="module")
def server():
    db = tempfile.mktemp(suffix=".db", prefix="chartroom-parity-test-")
    proc = subprocess.Popen(
        ["npx", "tsx", "src/index.ts"],
        cwd=REPO / "chartroom" / "server",
        env={
            **os.environ,
            "CHARTROOM_PORT": str(PORT),
            "CHARTROOM_SQLITE_FILE": db,
            "KEEL_API": "http://127.0.0.1:9",  # shipped-docs fallback, hermetic
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(120):
        try:
            if httpx.get(f"{API}/api/health", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    yield proc
    proc.kill()


@pytest.fixture(scope="module")
def manifest(server) -> dict[str, Any]:
    return httpx.get(f"{API}/api/warehouse/manifest", timeout=30).json()


@pytest.fixture(scope="module")
def warehouse(manifest) -> Warehouse:
    return Warehouse(manifest)


def oracle(req: dict[str, Any]) -> httpx.Response:
    return httpx.post(f"{API}/api/query", json=req, timeout=60)


def close(a: float | None, b: float | None, label: str) -> None:
    assert a is not None and b is not None, f"{label}: {a!r} vs {b!r}"
    assert math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-9), f"{label}: {a!r} vs {b!r}"


def ref(doc: dict[str, Any], measure: str) -> str:
    return f"keel://{doc['name']}.{measure}@{doc['revision']}"


def text_dims(manifest: dict[str, Any], doc: dict[str, Any]) -> list[str]:
    table = next(t for t in manifest["tables"] if t["name"] == doc["source"])
    return [c["name"] for c in table["columns"] if c["type"] == "text"]


def dim_value(manifest: dict[str, Any], doc: dict[str, Any], dim: str) -> Any:
    table = next(t for t in manifest["tables"] if t["name"] == doc["source"])
    idx = next(i for i, c in enumerate(table["columns"]) if c["name"] == dim)
    return table["rows"][0][idx]


# ---------------------------------------------------------------------------


def test_every_supported_measure_agrees_on_the_headline(manifest, warehouse):
    checked = 0
    for doc in manifest["docs"]:
        for m in doc["measures"]:
            mine = warehouse.run({"doc": doc["name"], "measure": m["name"]})
            r = oracle({"metric": ref(doc, m["name"])})
            assert r.status_code == 200, f"{doc['name']}.{m['name']}: {r.text}"
            theirs = r.json()
            label = f"{doc['name']}.{m['name']}"
            close(mine["value"], theirs["value"], f"{label} value")
            close(mine["prior"], theirs["prior"], f"{label} prior")
            assert mine["asOf"] == theirs["asOf"], label
            assert mine["unit"] == theirs["unit"], label
            assert mine["format"] == theirs["format"], label
            checked += 1
    assert checked >= 3, "the sweep should cover a real corpus, not a stub"


def assert_groups_match(mine, theirs, label: str) -> None:
    key = lambda row: tuple(sorted(row["key"].items()))  # noqa: E731
    mine_rows = {key(row): row for row in mine["rows"]}
    their_rows = {key(row): row for row in theirs["rows"]}
    assert mine_rows.keys() == their_rows.keys(), f"{label} groups"
    for k, row in mine_rows.items():
        close(row["value"], their_rows[k]["value"], f"{label} {dict(k)} value")
        close(row["prior"], their_rows[k]["prior"], f"{label} {dict(k)} prior")


def test_grouped_queries_agree_group_by_group(manifest, warehouse):
    checked = 0
    for doc in manifest["docs"]:
        dims = text_dims(manifest, doc)[:1]
        if not dims or not doc["measures"]:
            continue
        for m in doc["measures"]:
            mine = warehouse.run({"doc": doc["name"], "measure": m["name"], "dims": dims})
            r = oracle({"metric": ref(doc, m["name"]), "dims": dims})
            assert r.status_code == 200, f"{doc['name']}.{m['name']}: {r.text}"
            assert_groups_match(mine, r.json(), f"{doc['name']}.{m['name']}")
            checked += 1
    assert checked >= 1


def test_derivation_emitted_dims_group_identically(manifest, warehouse):
    """Grouping by a classify/bucket column runs the engine's CASE chains in
    DuckDB against the Evaluator's row stage — the deepest parity there is."""
    checked = 0
    for doc in manifest["docs"]:
        stage_names = {c["name"] for c in doc.get("row_stage", [])}
        for dim in ("product_id", "maturity_bucket"):
            if dim not in stage_names or not doc["measures"]:
                continue
            m = doc["measures"][0]["name"]
            mine = warehouse.run({"doc": doc["name"], "measure": m, "dims": [dim]})
            r = oracle({"metric": ref(doc, m), "dims": [dim]})
            assert r.status_code == 200, f"{doc['name']}.{m} by {dim}: {r.text}"
            assert len(mine["rows"]) > 1, f"{dim} should split the data"
            assert_groups_match(mine, r.json(), f"{doc['name']}.{m} by {dim}")
            checked += 1
    if not checked:
        pytest.skip("no doc emits product_id/maturity_bucket in its row stage")


def test_series_agree_windowed_and_not(manifest, warehouse):
    doc = next(d for d in manifest["docs"] if d["measures"])
    m = doc["measures"][-1]["name"]  # last in chain order — derived when one exists
    for window_days in (None, 30):
        mine = warehouse.run(
            {"doc": doc["name"], "measure": m, "dims": ["as_of_date"], "window_days": window_days}
        )
        req: dict[str, Any] = {"metric": ref(doc, m), "dims": ["as_of_date"]}
        if window_days:
            req["window"] = {"trailing": f"{window_days}d"}
        r = oracle(req)
        assert r.status_code == 200, r.text
        theirs = r.json()
        mine_pts = mine["series"][0]["points"]
        their_pts = theirs["series"][0]["points"]
        assert [p["date"] for p in mine_pts] == [p["date"] for p in their_pts], (
            f"window={window_days}: date axes diverge "
            f"({len(mine_pts)} vs {len(their_pts)} points)"
        )
        for a, b in zip(mine_pts, their_pts, strict=True):
            close(a["value"], b["value"], f"window={window_days} @ {a['date']}")


def test_filters_and_params_take_the_same_slice(manifest, warehouse):
    doc = next(d for d in manifest["docs"] if text_dims(manifest, d) and d["measures"])
    dim = text_dims(manifest, doc)[0]
    value = dim_value(manifest, doc, dim)
    m = doc["measures"][0]["name"]

    mine = warehouse.run(
        {"doc": doc["name"], "measure": m, "filters": [{"dim": dim, "op": "=", "value": value}]}
    )
    # Literal filter and param-resolved filter must land on the same number —
    # the TS executor resolves params before the wire, so the warehouse only
    # ever sees literals; the oracle exercises its own param path here.
    for filters, params in (
        ([{"dim": dim, "op": "=", "value": value}], None),
        ([{"dim": dim, "op": "=", "param": "p"}], {"p": value}),
    ):
        req: dict[str, Any] = {"metric": ref(doc, m), "filters": filters}
        if params:
            req["params"] = params
        r = oracle(req)
        assert r.status_code == 200, r.text
        close(mine["value"], r.json()["value"], f"filtered {dim}={value}")

    unfiltered = warehouse.run({"doc": doc["name"], "measure": m})
    assert mine["value"] != unfiltered["value"], "the filter should actually bite"


def test_the_cell_guard_refuses_on_both_paths(manifest, warehouse):
    doc = next(d for d in manifest["docs"] if text_dims(manifest, d) and d["measures"])
    dims = text_dims(manifest, doc)[:1]
    m = doc["measures"][0]["name"]
    with pytest.raises(QueryError, match="cell guard"):
        warehouse.run({"doc": doc["name"], "measure": m, "dims": dims, "max_cells": 1})
    r = oracle({"metric": ref(doc, m), "dims": dims, "max_cells": 1})
    assert r.status_code == 422
    assert "cell guard" in r.json()["error"]


def test_unsupported_measures_are_refused_by_name(manifest, warehouse):
    pairs = [(d, u) for d in manifest["docs"] for u in d["unsupported"]]
    if not pairs:
        pytest.skip("this workspace has no warehouse-unsupported measures")
    doc, u = pairs[0]
    with pytest.raises(QueryError) as exc:
        warehouse.run({"doc": doc["name"], "measure": u["name"]})
    assert u["reason"] in str(exc.value)
    assert "CHARTROOM_BACKEND=fixtures" in str(exc.value)


def test_unknown_dims_name_the_fix(manifest, warehouse):
    doc = next(d for d in manifest["docs"] if d["measures"])
    m = doc["measures"][0]["name"]
    with pytest.raises(QueryError, match="derivation"):
        warehouse.run({"doc": doc["name"], "measure": m, "dims": ["not_a_real_column"]})


# ---------------------------------------------------------------------------
# The HTTP surface itself: the same wire the TS WarehouseExecutor calls.
# ---------------------------------------------------------------------------


def test_the_query_endpoint_speaks_the_executor_wire(server, monkeypatch):
    monkeypatch.setenv("CHARTROOM_API", API)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")  # queries must not need a model
    monkeypatch.delenv("DREMIO_URL", raising=False)
    monkeypatch.delenv("DREMIO_PAT", raising=False)
    from fastapi.testclient import TestClient

    from chartroom_agent.app import create_app

    with TestClient(create_app()) as client:
        good = next(
            (d["name"], d["measures"][0]["name"])
            for d in httpx.get(f"{API}/api/warehouse/manifest", timeout=30).json()["docs"]
            if d["measures"]
        )
        r = client.post(
            "/query/run", json={"backend": "duckdb", "doc": good[0], "measure": good[1]}
        )
        assert r.status_code == 200
        body = r.json()
        assert body["kind"] == "scalar"
        assert body["cost"]["cache"] == "miss"

        r = client.post("/query/run", json={"backend": "duckdb", "doc": "nope", "measure": "x"})
        assert r.status_code == 404
        assert "manifest" in r.json()["error"]

        r = client.post(
            "/query/run", json={"backend": "polars", "doc": good[0], "measure": good[1]}
        )
        assert r.status_code == 422
        assert "duckdb and dremio" in r.json()["error"]

        # Dremio without credentials refuses with the fix, at request time.
        r = client.post(
            "/query/run", json={"backend": "dremio", "doc": good[0], "measure": good[1]}
        )
        assert r.status_code == 422
        assert "DREMIO_PAT" in r.json()["error"]
