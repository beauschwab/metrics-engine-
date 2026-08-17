"""The warehouse query executor (E8.2, ADR-40).

Serves the same request shapes the fixture path serves — scalar, groups,
series — by compiling **aggregate-only SQL** from the manifest the
chartroom-server publishes (`/api/warehouse/manifest`). The engine stays the
single source of measure SQL: this module never invents an expression, it
arranges the manifest's snippets into the same CTE chain the published
semantic views use, parameterized by dims and filters.

The aggregates boundary is structural here too: the only SELECT this module
can emit is a GROUP BY over the source with the manifest's aggregate
snippets — there is no code path that returns source rows.

`SqlWarehouse` is the engine-agnostic half (compiler + result shaping);
`Warehouse` runs it on DuckDB loaded from the manifest's fixture tables so
the parity harness can hold it against the Evaluator (ADR-39). Dremio rides
the same compiler with a Flight SQL connection (`dremio.py`), which is the
point of the seam.
"""

from __future__ import annotations

import re
import threading
from typing import Any

import duckdb

Filter = dict[str, Any]  # {dim, op: '='|'!='|'in', value}


class QueryError(Exception):
    def __init__(self, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.status = status


MAX_CELLS_DEFAULT = 50_000
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")


def _ident(name: str) -> str:
    if not _IDENT.match(name):
        raise QueryError(f"{name!r} is not a valid identifier")
    return name


def _num(v: Any) -> float | None:
    return None if v is None else float(v)


class SqlWarehouse:
    """The compiler and result shaping, agnostic of what executes the SQL."""

    def __init__(self, manifest: dict[str, Any]) -> None:
        self.workspace: str = manifest["workspace"]
        self.as_of: str = manifest["asOf"]
        self.dates: list[str] = manifest["dates"]
        self.docs: dict[str, dict[str, Any]] = {d["name"]: d for d in manifest["docs"]}
        self.columns: dict[str, set[str]] = {
            t["name"]: {c["name"] for c in t["columns"]} for t in manifest["tables"]
        }

    # -- the engine seam ----------------------------------------------------

    def _exec(self, sql: str, params: list[Any]) -> list[tuple[Any, ...]]:
        raise NotImplementedError

    def _window_predicate(self, days: int) -> tuple[str, list[Any]]:
        """WHERE fragment restricting `final` to a trailing day window."""
        raise NotImplementedError

    # -- compilation --------------------------------------------------------

    def _doc(self, name: str) -> dict[str, Any]:
        doc = self.docs.get(name)
        if doc is None:
            raise QueryError(f"{name} is not in the workspace manifest", status=404)
        return doc

    def _measure(self, doc: dict[str, Any], name: str) -> dict[str, Any]:
        for m in doc["measures"]:
            if m["name"] == name:
                return m
        for u in doc["unsupported"]:
            if u["name"] == name:
                raise QueryError(
                    f"{doc['name']}.{name} cannot be served from the warehouse: {u['reason']} — "
                    "run with CHARTROOM_BACKEND=fixtures for this measure"
                )
        raise QueryError(f"{doc['name']}.{name} does not exist", status=404)

    def _dim_columns(self, doc: dict[str, Any]) -> set[str]:
        """Source columns plus the row stage's derivation-emitted columns."""
        cols = set(self.columns.get(doc["source"], set()))
        cols.update(c["name"] for c in doc.get("row_stage") or [])
        return cols

    def _filter_sql(self, filters: list[Filter], dim_cols: set[str]) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        for f in filters:
            dim = f["dim"]
            if dim not in dim_cols:
                raise QueryError(
                    f"filter dim {dim!r} is not a source column or a derivation of this view — "
                    "check the doc's derivations, or run with CHARTROOM_BACKEND=fixtures"
                )
            op = f["op"]
            if op == "in":
                values = list(f["value"])
                clauses.append(f"{_ident(dim)} IN ({', '.join('?' for _ in values)})")
                params.extend(values)
            elif op in ("=", "!="):
                clauses.append(f"{_ident(dim)} {op} ?")
                params.append(f["value"])
            else:
                raise QueryError(f"unsupported filter op {op!r}")
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

    def _row_chain(self, doc: dict[str, Any]) -> tuple[list[str], str]:
        """One CTE per row-stage step — each may read the columns before it."""
        ctes: list[str] = []
        prev = _ident(doc["source"])
        for i, c in enumerate(doc.get("row_stage") or [], start=1):
            col = _ident(c["name"])
            ctes.append(f"r{i} AS (\n  SELECT *, {c['sql']} AS {col}\n  FROM {prev}\n)")
            prev = f"r{i}"
        return ctes, prev

    def _final_cte(self, doc: dict[str, Any], group_dims: list[str], where: str) -> str:
        """The same shape emitViewDdl publishes, with dims added to the grain
        and the row stage chained underneath so derivation-emitted columns
        exist by the time the aggregates read them."""
        simple = [m for m in doc["measures"] if m["kind"] == "simple"]
        derived = [m for m in doc["measures"] if m["kind"] == "derived"]
        rows, src = self._row_chain(doc)
        dim_cols = "".join(f", {_ident(d)}" for d in group_dims)
        agg_lines = ",\n    ".join(f"{m['sql']} AS {_ident(m['name'])}" for m in simple)
        ctes = [
            *rows,
            f"agg AS (\n  SELECT as_of_date{dim_cols},\n    {agg_lines}\n"
            f"  FROM {src}{where}\n  GROUP BY as_of_date{dim_cols}\n)",
        ]
        prev = "agg"
        for i, m in enumerate(derived, start=1):
            col = _ident(m["name"])
            ctes.append(f"d{i} AS (\n  SELECT *, {m['sql']} AS {col}\n  FROM {prev}\n)")
            prev = f"d{i}"
        return "WITH " + ",\n".join(ctes) + f"\nSELECT * FROM {prev}"

    # -- the three request shapes ------------------------------------------

    def run(self, req: dict[str, Any]) -> dict[str, Any]:
        doc = self._doc(req["doc"])
        measure = self._measure(doc, req["measure"])
        dims: list[str] = req.get("dims") or []
        filters: list[Filter] = req.get("filters") or []
        window_days = req.get("window_days")
        max_cells = req.get("max_cells") or MAX_CELLS_DEFAULT

        dim_cols = self._dim_columns(doc)
        cat_dims = [d for d in dims if d != "as_of_date"]
        wants_series = "as_of_date" in dims
        for d in cat_dims:
            if d not in dim_cols:
                raise QueryError(
                    f"dim {d!r} is not a source column or a derivation of {doc['name']} — "
                    "check the doc's derivations, or run with CHARTROOM_BACKEND=fixtures"
                )

        where, params = self._filter_sql(filters, dim_cols)
        cte = self._final_cte(doc, cat_dims, where)
        name = _ident(measure["name"])
        fmt = measure["format"]
        unit = (
            "percent" if fmt.startswith("percent")
            else "USD" if fmt.startswith("currency")
            else "number"
        )
        head = ", ".join(_ident(d) for d in cat_dims) + ", " if cat_dims else ""

        # The count runs over the row chain too — filters may read derived columns.
        row_ctes, src = self._row_chain(doc)
        prefix = "WITH " + ",\n".join(row_ctes) + "\n" if row_ctes else ""
        scanned_row = self._exec(f"{prefix}SELECT COUNT(*) FROM {src}{where}", params)
        scanned = int(scanned_row[0][0]) if scanned_row else 0

        if wants_series:
            frm = ""
            bind = list(params)
            if window_days is not None:
                frm, extra = self._window_predicate(int(window_days))
                bind = [*params, *extra]
            rows = self._exec(
                f"WITH final AS ({cte})\n"
                f"SELECT {head}as_of_date, {name} FROM final{frm} ORDER BY as_of_date",
                bind,
            )
            series: dict[tuple[str, ...], list[dict[str, Any]]] = {}
            latest_keys: set[tuple[str, ...]] = set()
            for row in rows:
                key = tuple(str(v) for v in row[: len(cat_dims)])
                date = str(row[len(cat_dims)])
                if date == self.as_of:
                    latest_keys.add(key)
                series.setdefault(key, []).append(
                    {"date": date, "value": _num(row[len(cat_dims) + 1])}
                )
            # Group membership is the latest date's — the oracle's semantics: a
            # bucket that drained before today is not a series on the chart.
            series = {k: v for k, v in series.items() if k in latest_keys}
            if len(series) > max_cells:
                raise QueryError(f"{len(series)} groups exceeds the {max_cells} cell guard")
            return {
                "kind": "series",
                "unit": unit,
                "format": fmt,
                "series": [
                    {"key": dict(zip(cat_dims, key, strict=True)), "points": pts}
                    for key, pts in sorted(series.items())
                ],
                "asOf": self.as_of,
                "cost": {"rowsScanned": scanned, "groups": len(series) or 1, "cache": "miss"},
            }

        two_dates = (
            "as_of_date IN ((SELECT max(as_of_date) FROM final), "
            "(SELECT max(as_of_date) FROM final WHERE as_of_date < "
            "(SELECT max(as_of_date) FROM final)))"
        )
        rows = self._exec(
            f"WITH final AS ({cte})\n"
            f"SELECT {head}as_of_date, {name} FROM final WHERE {two_dates}",
            params,
        )

        latest = max((str(r[len(cat_dims)]) for r in rows), default=self.as_of)
        if cat_dims:
            by_key: dict[tuple[str, ...], dict[str, Any]] = {}
            for row in rows:
                key = tuple(str(v) for v in row[: len(cat_dims)])
                slot = by_key.setdefault(
                    key,
                    {"key": dict(zip(cat_dims, key, strict=True)), "value": None, "prior": None},
                )
                field = "value" if str(row[len(cat_dims)]) == latest else "prior"
                slot[field] = _num(row[len(cat_dims) + 1])
            # Same membership rule as series: the latest date defines the groups.
            by_key = {k: v for k, v in by_key.items() if v["value"] is not None}
            if len(by_key) > max_cells:
                raise QueryError(f"{len(by_key)} groups exceeds the {max_cells} cell guard")
            return {
                "kind": "groups",
                "unit": unit,
                "format": fmt,
                "rows": sorted(by_key.values(), key=lambda r: tuple(r["key"].values())),
                "asOf": latest,
                "cost": {"rowsScanned": scanned, "groups": len(by_key), "cache": "miss"},
            }

        value = prior = None
        for row in rows:
            if str(row[0]) == latest:
                value = _num(row[1])
            else:
                prior = _num(row[1])
        return {
            "kind": "scalar",
            "unit": unit,
            "format": fmt,
            "value": value,
            "prior": prior,
            "asOf": latest,
            "cost": {"rowsScanned": scanned, "groups": 1, "cache": "miss"},
        }


class Warehouse(SqlWarehouse):
    """One loaded workspace on an in-memory DuckDB — the dev backend."""

    def __init__(self, manifest: dict[str, Any]) -> None:
        super().__init__(manifest)
        self.con = duckdb.connect(":memory:")
        self.lock = threading.Lock()
        self._load(manifest["tables"])

    def _load(self, tables: list[dict[str, Any]]) -> None:
        typemap = {"date": "DATE", "text": "VARCHAR", "number": "DOUBLE", "boolean": "BOOLEAN"}
        for t in tables:
            schema, _, bare = t["name"].rpartition(".")
            if schema:
                self.con.execute(f"CREATE SCHEMA IF NOT EXISTS {_ident(schema)}")
            cols = ", ".join(f"{_ident(c['name'])} {typemap[c['type']]}" for c in t["columns"])
            qualified = f"{_ident(schema)}.{_ident(bare)}" if schema else _ident(bare)
            self.con.execute(f"CREATE TABLE {qualified} ({cols})")
            placeholders = ", ".join("?" for _ in t["columns"])
            self.con.executemany(f"INSERT INTO {qualified} VALUES ({placeholders})", t["rows"])

    def _exec(self, sql: str, params: list[Any]) -> list[tuple[Any, ...]]:
        with self.lock:
            return self.con.execute(sql, params).fetchall()

    def _window_predicate(self, days: int) -> tuple[str, list[Any]]:
        return (
            " WHERE as_of_date > (SELECT max(as_of_date) FROM final) - INTERVAL (?) DAY",
            [days],
        )
