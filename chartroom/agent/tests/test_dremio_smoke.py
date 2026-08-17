"""The Dremio smoke test — env-gated on DREMIO_URL + DREMIO_PAT (plan §E8.3).

CI never has a coordinator; this skips loudly there. With credentials it
round-trips one scalar and one grouped query through the same compiler the
parity harness proves against DuckDB — Dremio must hold the shapes (the
numbers depend on what the coordinator's tables contain, so the assertion
is shape + non-refusal, not parity).
"""

import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

REPO = Path(__file__).resolve().parents[3]
PORT = 8700 + (os.getpid() % 90)
API = f"http://127.0.0.1:{PORT}"

HAS_DREMIO = bool(os.environ.get("DREMIO_URL")) and bool(os.environ.get("DREMIO_PAT"))

pytestmark = pytest.mark.skipif(
    not HAS_DREMIO, reason="set DREMIO_URL and DREMIO_PAT to run the Dremio smoke test"
)


@pytest.fixture(scope="module")
def manifest() -> Any:
    db = tempfile.mktemp(suffix=".db", prefix="chartroom-dremio-test-")
    proc = subprocess.Popen(
        ["npx", "tsx", "src/index.ts"],
        cwd=REPO / "chartroom" / "server",
        env={
            **os.environ,
            "CHARTROOM_PORT": str(PORT),
            "CHARTROOM_SQLITE_FILE": db,
            "KEEL_API": "http://127.0.0.1:9",
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(120):
            try:
                if httpx.get(f"{API}/api/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
        yield httpx.get(f"{API}/api/warehouse/manifest", timeout=30).json()
    finally:
        proc.kill()


def test_dremio_round_trips_a_scalar_and_a_grouped_query(manifest):
    from chartroom_agent.dremio import Dremio

    dremio = Dremio(manifest)
    doc = next(d for d in manifest["docs"] if d["measures"])
    measure = doc["measures"][0]["name"]

    scalar = dremio.run({"doc": doc["name"], "measure": measure})
    assert scalar["kind"] == "scalar"
    assert scalar["value"] is not None

    table = next(t for t in manifest["tables"] if t["name"] == doc["source"])
    dims = [c["name"] for c in table["columns"] if c["type"] == "text"][:1]
    if dims:
        grouped = dremio.run({"doc": doc["name"], "measure": measure, "dims": dims})
        assert grouped["kind"] == "groups"
        assert grouped["rows"]
