"""``POST /query/run`` — where chartroom-server's WarehouseExecutor lands (E8.2).

The manifest is the wire between the two halves: this endpoint fetches it
from the chartroom-server (`CHARTROOM_API`, same env the MCP subprocess
uses), builds a warehouse per workspace hash, and serves queries from it.
The fetch itself is the freshness check — the hash embeds every doc
revision, so a registry move shows up as a new key and the stale warehouse
is dropped. Loaded warehouses are cached; manifests are small.

Errors keep the TS refusal split: 404 maps to `QueryUnresolved` over there,
anything else to `QueryRefused` — and every message names a fix.
"""

from __future__ import annotations

import os
import threading
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .warehouse import QueryError, SqlWarehouse, Warehouse


def _api() -> str:
    return os.environ.get("CHARTROOM_API", "http://127.0.0.1:8788")


class QueryRun(BaseModel):
    backend: str = "duckdb"
    doc: str
    measure: str
    dims: list[str] = Field(default_factory=list)
    filters: list[dict[str, Any]] = Field(default_factory=list)
    window_days: int | None = None
    max_cells: int | None = None


class WarehousePool:
    """One loaded warehouse per (backend, workspace); old epochs are dropped."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pool: dict[tuple[str, str], SqlWarehouse] = {}

    def get(self, backend: str) -> SqlWarehouse:
        r = httpx.get(f"{_api()}/api/warehouse/manifest", timeout=30)
        r.raise_for_status()
        manifest = r.json()
        key = (backend, manifest["workspace"])
        with self._lock:
            wh = self._pool.get(key)
            if wh is None:
                if backend == "dremio":
                    from .dremio import Dremio

                    wh = Dremio(manifest)
                elif backend == "duckdb":
                    wh = Warehouse(manifest)
                else:
                    raise QueryError(
                        f"unknown backend {backend!r} — this service runs duckdb and dremio; "
                        "fixtures evaluate in the chartroom-server itself"
                    )
                self._pool = {k: v for k, v in self._pool.items() if k[0] != backend}
                self._pool[key] = wh
            return wh


def query_router() -> APIRouter:
    router = APIRouter()
    pool = WarehousePool()

    @router.post("/query/run")
    def query_run(body: QueryRun) -> JSONResponse:
        try:
            warehouse = pool.get(body.backend)
            return JSONResponse(warehouse.run(body.model_dump()))
        except QueryError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status)
        except httpx.HTTPError as exc:
            return JSONResponse(
                {
                    "error": "the workspace manifest is unreachable at "
                    f"{_api()}/api/warehouse/manifest ({exc}) — is the chartroom-server up?"
                },
                status_code=422,
            )

    return router
