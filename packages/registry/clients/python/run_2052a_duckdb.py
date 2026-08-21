"""Worked example: run the deployed FR 2052a plan on a client-shaped table.

The situation this demonstrates is the common one: your positions table is not
shaped like the canonical source. Murex calls the balance ``BAL_AMT_USD``, the
segment codes are ``RTL``/``WSL``/``SBB``, and none of the canonical names
exist. The registry holds a *source binding* for your system, and this script
shows the whole runtime loop against it:

  1. fetch the deployed plan for the submission, naming your binding
  2. apply the adapter view — your table, presented under canonical names
  3. run the canonical plan, unchanged, on top
  4. file the rows

The plan you run is byte-identical to the one every other system runs; only
the adapter differs. If your binding is missing a column the rules read, or
maps a vocabulary that can never produce a value some rule tests for, step 1
fails with the list — the registry refuses to serve an unfaithful adapter
rather than letting it fail silently in your pipeline.

Usage:
  python run_2052a_duckdb.py --base http://localhost:8787 --channel production \
      --report fr2052a_submission --binding murex_eu --db positions.duckdb

Requires: duckdb (`pip install duckdb`). The registry client itself has no
dependencies.
"""

from __future__ import annotations

import argparse
import json
import sys

import duckdb

from keel_runtime import KeelClient, split_plan


def main() -> int:
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--base", required=True, help="registry base URL")
    args.add_argument("--channel", default="production")
    args.add_argument("--report", default="fr2052a_submission")
    args.add_argument("--binding", default=None, help="source binding for this system")
    args.add_argument("--db", required=True, help="DuckDB database holding the client table")
    opts = args.parse_args()

    client = KeelClient(opts.base, opts.channel)

    # The manifest names the release; log it with every run, because "which
    # rules computed this file" is the first question anyone asks about it.
    manifest = client.manifest()
    release = manifest["release"]["version"]
    print(f"channel={opts.channel} release=r{release}", file=sys.stderr)

    plan = client.plan(opts.report, target="sql", binding=opts.binding)

    connection = duckdb.connect(opts.db)

    # The adapter first: after this, the canonical source name exists as a view
    # over the client table, and the plan below needs no edits at all.
    if plan.get("adapter"):
        # `statements` is already split for you, in order. Do not split
        # `adapter["sql"]` on ";" yourself — that is a small, wrong SQL parser,
        # and a semicolon inside a comment or a literal breaks it.
        for statement in plan["adapter"]["statements"]:
            connection.execute(statement)
        print(f"adapter applied: {plan['adapter']['binding']}", file=sys.stderr)

    # The plan's materialize step targets the governed sink (Iceberg, in this
    # workspace). This example lets the warehouse own the write, so it runs the
    # query half and files the rows itself.
    query, _materialize = split_plan(plan["text"])
    rows = connection.execute(query).fetchall()
    columns = [d[0] for d in connection.description]

    filed = [dict(zip(columns, row)) for row in rows]
    json.dump({"release": release, "rows": filed}, sys.stdout, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
