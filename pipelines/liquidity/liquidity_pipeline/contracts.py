"""Enforcing an Open Data Contract against a landed batch.

The contract YAML (ODCS v3) is the producer's promise; this module turns it
into executable checks and refuses the batch when any fail. Enforcement runs
against the *raw* table — landed as strings, exactly as the file arrived — so
what is validated is what the producer actually sent, not what a cast layer
made of it. dbt casts afterwards, and by then castability has been proven.

The checks are generated as SQL and executed by whichever engine holds the raw
table, so the same contract governs DuckDB in dev and Spark in prod. The SQL
kept deliberately inside the dialect both engines share; the one construct
that differs (regex matching) goes through the small ``dialect`` switch.

Supported ODCS subset — enough to be real, small enough to read:

  property.required            → null count must be 0
  property.primaryKey          → composite key must be unique
  property.logicalType         → strings must TRY_CAST to date / number / boolean
  property.quality validValues → domain membership
  property.quality pattern     → regex match
  dataset.quality (sql rules)  → arbitrary SQL with mustBe / mustBeGreaterThan,
                                 with {table}, {as_of_date}, {as_of_date_compact}
                                 placeholders

Anything else in the document is carried but not enforced here (SLAs and
team blocks are for humans and platform tooling).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import yaml


class ContractViolation(Exception):
    """The batch broke its contract; the message lists every failed check."""

    def __init__(self, contract_id: str, failures: list["CheckResult"]):
        self.contract_id = contract_id
        self.failures = failures
        lines = "\n".join(f"  · {f.name}: {f.detail}" for f in failures)
        super().__init__(f"contract {contract_id} violated by this batch:\n{lines}")


@dataclass(frozen=True)
class Property:
    name: str
    logical_type: str
    required: bool
    primary_key_position: int | None
    valid_values: list[str] | None
    pattern: str | None


@dataclass(frozen=True)
class DatasetQuality:
    rule: str
    sql: str
    must_be: float | None
    must_be_greater_than: float | None


@dataclass(frozen=True)
class Contract:
    id: str
    name: str
    version: str
    dataset: str
    physical_name: str
    properties: list[Property]
    dataset_quality: list[DatasetQuality]

    @property
    def primary_key(self) -> list[str]:
        keyed = [p for p in self.properties if p.primary_key_position is not None]
        return [p.name for p in sorted(keyed, key=lambda p: p.primary_key_position or 0)]

    @property
    def column_names(self) -> list[str]:
        return [p.name for p in self.properties]


def load_contract(path: Path) -> Contract:
    doc = yaml.safe_load(path.read_text())
    if doc.get("kind") != "DataContract":
        raise ValueError(f"{path} is not an ODCS DataContract")
    dataset = doc["schema"][0]

    props: list[Property] = []
    for p in dataset.get("properties", []):
        valid_values = None
        pattern = None
        for q in p.get("quality", []) or []:
            if q.get("rule") == "validValues":
                valid_values = [str(v) for v in q["validValues"]]
            if q.get("rule") == "pattern":
                pattern = q["pattern"]
        props.append(
            Property(
                name=p["name"],
                logical_type=p.get("logicalType", "string"),
                required=bool(p.get("required", False)),
                primary_key_position=p.get("primaryKeyPosition") if p.get("primaryKey") else None,
                valid_values=valid_values,
                pattern=pattern,
            )
        )

    quality: list[DatasetQuality] = []
    for q in dataset.get("quality", []) or []:
        if "sql" not in q:
            continue
        quality.append(
            DatasetQuality(
                rule=q.get("rule", "custom"),
                sql=q["sql"].strip(),
                must_be=q.get("mustBe"),
                must_be_greater_than=q.get("mustBeGreaterThan"),
            )
        )

    return Contract(
        id=doc["id"],
        name=doc["name"],
        version=str(doc["version"]),
        dataset=dataset["name"],
        physical_name=dataset.get("physicalName", dataset["name"]),
        properties=props,
        dataset_quality=quality,
    )


# ---------------------------------------------------------------------------
# Check generation
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Check:
    name: str
    sql: str
    #: 'eq' with value, or 'gt' with value — applied to the single number the
    #: SQL returns.
    op: str
    value: float


@dataclass
class CheckResult:
    name: str
    passed: bool
    observed: float
    detail: str


_CAST_TARGETS = {"date": "DATE", "number": "DOUBLE", "integer": "BIGINT", "boolean": "BOOLEAN"}


def _regex_predicate(column: str, pattern: str, dialect: str) -> str:
    if dialect == "spark":
        return f"{column} NOT RLIKE '{pattern}'"
    return f"NOT regexp_full_match({column}, '{pattern}')"


def build_checks(
    contract: Contract,
    table: str,
    as_of_date: str,
    dialect: str = "duckdb",
) -> list[Check]:
    """Every enforceable promise in the contract, as one-number SQL checks.

    ``table`` is the landed raw table; ``as_of_date`` is the batch date in ISO
    form, available to dataset-level rules along with its compact (YYYYMMDD)
    spelling for feeds that carry dates that way.
    """
    checks: list[Check] = []

    for p in contract.properties:
        col = f'"{p.name}"' if dialect == "duckdb" else f"`{p.name}`"

        if p.required:
            checks.append(Check(
                name=f"{p.name}.not_null",
                sql=f"SELECT count(*) FROM {table} WHERE {col} IS NULL OR trim({col}) = ''",
                op="eq", value=0,
            ))

        cast = _CAST_TARGETS.get(p.logical_type)
        if cast:
            checks.append(Check(
                name=f"{p.name}.castable_{p.logical_type}",
                sql=(
                    f"SELECT count(*) FROM {table} "
                    f"WHERE {col} IS NOT NULL AND trim({col}) <> '' "
                    f"AND TRY_CAST({col} AS {cast}) IS NULL"
                ),
                op="eq", value=0,
            ))

        if p.valid_values is not None:
            domain = ", ".join(f"'{v}'" for v in p.valid_values)
            checks.append(Check(
                name=f"{p.name}.valid_values",
                sql=(
                    f"SELECT count(*) FROM {table} "
                    f"WHERE {col} IS NOT NULL AND {col} NOT IN ({domain})"
                ),
                op="eq", value=0,
            ))

        if p.pattern is not None:
            checks.append(Check(
                name=f"{p.name}.pattern",
                sql=(
                    f"SELECT count(*) FROM {table} "
                    f"WHERE {col} IS NOT NULL AND {_regex_predicate(col, p.pattern, dialect)}"
                ),
                op="eq", value=0,
            ))

    if contract.primary_key:
        key = ", ".join(contract.primary_key)
        checks.append(Check(
            name="primary_key.unique",
            sql=(
                f"SELECT count(*) - count(DISTINCT ({key})) "
                f"FROM (SELECT {key} FROM {table})"
            ),
            op="eq", value=0,
        ))

    compact = as_of_date.replace("-", "")
    for q in contract.dataset_quality:
        sql = (
            q.sql.replace("{table}", table)
            .replace("{as_of_date_compact}", compact)
            .replace("{as_of_date}", as_of_date)
        )
        if q.must_be is not None:
            checks.append(Check(name=f"dataset.{q.rule}", sql=sql, op="eq", value=float(q.must_be)))
        elif q.must_be_greater_than is not None:
            checks.append(Check(name=f"dataset.{q.rule}", sql=sql, op="gt", value=float(q.must_be_greater_than)))

    return checks


def enforce(
    run_scalar: Callable[[str], Any],
    contract: Contract,
    table: str,
    as_of_date: str,
    columns: list[str],
    dialect: str = "duckdb",
) -> list[CheckResult]:
    """Run every check; return the full report, raise on any failure.

    ``run_scalar`` executes SQL and returns the single value it yields —
    the engine seam, so this module never imports duckdb or pyspark.
    ``columns`` is the landed table's actual column list; a column the
    contract promises but the file lacks fails here, before any SQL runs.
    """
    missing = [c for c in contract.column_names if c not in columns]
    results: list[CheckResult] = [
        CheckResult(
            name=f"{c}.present", passed=False, observed=0,
            detail="column promised by the contract is absent from the batch",
        )
        for c in missing
    ]

    if not missing:
        for check in build_checks(contract, table, as_of_date, dialect):
            observed = float(run_scalar(check.sql))
            passed = observed == check.value if check.op == "eq" else observed > check.value
            expected = (
                f"= {check.value:g}" if check.op == "eq" else f"> {check.value:g}"
            )
            results.append(CheckResult(
                name=check.name,
                passed=passed,
                observed=observed,
                detail=f"observed {observed:g}, expected {expected}",
            ))

    failures = [r for r in results if not r.passed]
    if failures:
        raise ContractViolation(contract.id, failures)
    return results
