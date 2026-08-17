"""The Dremio backend — the same compiler, a Flight SQL connection (E8.2).

Auth is a personal access token (pinned decision, plan §risk register): the
PAT rides as a bearer header on every Flight call. Configuration is env:

    DREMIO_URL   e.g. grpc+tls://coordinator.example.com:32010
    DREMIO_PAT   a Dremio personal access token

`pyarrow` is deliberately not a pinned dependency of this package — DuckDB
is the dev/CI backend and pyarrow is heavy — so the import is guarded and
the error names the fix. Nothing here runs in CI beyond construction-time
refusals; the env-gated smoke test (`test_dremio_smoke.py`) exercises the
round-trip against a real coordinator when DREMIO_PAT is set.

Dremio serves the real source tables, so the manifest's fixture rows are
ignored here — only its measure SQL, source names, and column types are
used. Filters are inlined as SQL literals (Flight's simple command path has
no parameter binding); values pass through `_literal`, which quotes and
escapes — and dims/idents still go through the same `_ident` guard.
"""

from __future__ import annotations

import os
from typing import Any

from .warehouse import QueryError, SqlWarehouse


def _literal(v: Any) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int | float):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def _inline(sql: str, params: list[Any]) -> str:
    parts = sql.split("?")
    if len(parts) != len(params) + 1:
        raise QueryError("internal: placeholder/parameter count mismatch")
    out = parts[0]
    for part, p in zip(parts[1:], params, strict=True):
        out += _literal(p) + part
    return out


class Dremio(SqlWarehouse):
    """The prod-shaped backend: compile here, execute on the coordinator."""

    def __init__(self, manifest: dict[str, Any]) -> None:
        super().__init__(manifest)
        self.url = os.environ.get("DREMIO_URL", "")
        self.pat = os.environ.get("DREMIO_PAT", "")
        if not self.url or not self.pat:
            raise QueryError(
                "the dremio backend needs DREMIO_URL and DREMIO_PAT in the agent service's "
                "environment — or run with CHARTROOM_BACKEND=duckdb or fixtures"
            )
        try:
            import pyarrow.flight  # noqa: F401
        except ImportError as exc:
            raise QueryError(
                "the dremio backend needs pyarrow (`pip install pyarrow`) in the agent "
                "service's environment — or run with CHARTROOM_BACKEND=duckdb or fixtures"
            ) from exc

    def _exec(self, sql: str, params: list[Any]) -> list[tuple[Any, ...]]:
        from pyarrow import flight

        options = flight.FlightCallOptions(
            headers=[(b"authorization", f"bearer {self.pat}".encode())]
        )
        client = flight.FlightClient(self.url)
        try:
            descriptor = flight.FlightDescriptor.for_command(_inline(sql, params))
            info = client.get_flight_info(descriptor, options)
            table = client.do_get(info.endpoints[0].ticket, options).read_all()
        except flight.FlightError as exc:
            raise QueryError(f"dremio refused the query: {exc}") from exc
        finally:
            client.close()
        if table.num_rows == 0:
            return []
        cols = [table.column(i).to_pylist() for i in range(table.num_columns)]
        return list(zip(*cols, strict=True))

    def _window_predicate(self, days: int) -> tuple[str, list[Any]]:
        # Dremio's SQL takes the quoted-literal INTERVAL form only.
        return (
            f" WHERE as_of_date > (SELECT max(as_of_date) FROM final)"
            f" - INTERVAL '{int(days)}' DAY",
            [],
        )
