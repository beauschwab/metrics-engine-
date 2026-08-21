"""Run one read against Dremio over Arrow Flight SQL.

Reads a JSON request on stdin, writes a JSON response on stdout, exits non-zero
on failure. Deliberately one query per process: the registry issues a handful of
on-demand reads, not a stream of them, and a short-lived process cannot leak a
session, a cursor or a token between requests.

Python rather than Node because there is no mature Arrow Flight client for
JavaScript — Flight is gRPC plus Arrow IPC, and ADBC, which is what Dremio's own
documentation reaches for, has no Node binding. The Node side owns the contract
and the safety rules; this owns the transport and nothing else.

**It does not decide what is safe to run.** The read-only guard lives in
`server/readonly.ts` and has already run by the time anything gets here. Putting
the check in both places would mean two rules to keep identical; putting it only
here would mean the Node API could be bypassed by anything that could spawn a
script. One rule, one place, upstream of the transport.
"""

from __future__ import annotations

import decimal
import json
import math
import sys
import warnings

warnings.filterwarnings("ignore")


def jsonable(value):
    """Arrow types the JSON encoder does not know about.

    Decimals become floats rather than strings because every consumer of this
    treats a measure as a number — but the conversion is explicit here so that
    the one place precision is lost is visible, rather than being an accident
    somewhere in the client.
    """
    if value is None:
        return None
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, float):
        # JSON has no NaN or Infinity. `null` is the honest mapping: the value
        # is absent, which is what a NaN out of an aggregate means.
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf8", "replace")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def main() -> int:
    request = json.load(sys.stdin)

    uri = request["uri"]
    sql = request["sql"]
    token = request.get("token") or ""
    timeout_s = float(request.get("timeoutSeconds") or 30)
    tls_skip_verify = bool(request.get("insecure"))

    import adbc_driver_flightsql.dbapi as flight_sql
    from adbc_driver_flightsql import DatabaseOptions

    options = {}
    if token:
        # Dremio takes a personal access token as a bearer on the handshake.
        options[DatabaseOptions.AUTHORIZATION_HEADER.value] = f"Bearer {token}"
    options[DatabaseOptions.TIMEOUT_QUERY.value] = str(timeout_s)
    options[DatabaseOptions.TIMEOUT_FETCH.value] = str(timeout_s)
    if tls_skip_verify:
        # Only for a development instance with a self-signed certificate. The
        # Node side refuses to pass this unless it was asked for explicitly.
        options[DatabaseOptions.TLS_SKIP_VERIFY.value] = "true"

    conn = flight_sql.connect(uri, db_kwargs=options)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        table = cursor.fetch_arrow_table()
        payload = {
            "columns": [
                {"name": f.name, "type": str(f.type)} for f in table.schema
            ],
            "rows": [
                {k: jsonable(v) for k, v in row.items()} for row in table.to_pylist()
            ],
        }
    finally:
        conn.close()

    json.dump(payload, sys.stdout)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:  # noqa: BLE001 - the message is the product here
        # One line of JSON on stderr, so the Node side can surface the warehouse's
        # own words instead of "the query failed".
        json.dump({"error": str(err), "kind": type(err).__name__}, sys.stderr)
        sys.exit(1)
