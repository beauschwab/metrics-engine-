"""A minimal Arrow Flight SQL server, standing in for Dremio.

There is no Dremio in this environment and no way to start one, which would
normally leave the Flight SQL client in the same position as the PySpark emitter:
written, read, never run. A Flight SQL server is small enough to implement,
though — the protocol is Flight plus a handful of protobuf-wrapped commands — so
the client is exercised against the real thing: a real gRPC handshake, a real
`GetFlightInfo`, a real `DoGet`, real Arrow IPC batches over the wire.

What this does *not* stand in for is Dremio itself: its catalogue naming, its SQL
dialect quirks, its access controls, or the exact shape of its auth errors. Those
remain untested until it is pointed at a real instance. What is proved is that the
transport, the handshake, the Arrow decode, the row cap and the read-only guard
all work against something that speaks the protocol.

Backed by DuckDB so the SQL it answers is real SQL.

`CommandStatementQuery` is parsed by hand rather than with generated protobuf
classes. The only pip package that ships those (`flightsql-dbapi`) pins
`sqlalchemy<2`, which breaks the Iceberg conformance leg — a dependency conflict
is a worse trade than twenty lines of varint decoding for a message that is one
string field inside an `Any`.
"""

from __future__ import annotations

import sys

import duckdb
import pyarrow as pa
import pyarrow.flight as flight

PREFIX = b"type.googleapis.com/arrow.flight.protocol.sql."
STATEMENT_QUERY = PREFIX + b"CommandStatementQuery"
PREPARED_QUERY = PREFIX + b"CommandPreparedStatementQuery"
CREATE_PREPARED = PREFIX + b"ActionCreatePreparedStatementRequest"
CREATE_PREPARED_RESULT = PREFIX + b"ActionCreatePreparedStatementResult"
CLOSE_PREPARED = PREFIX + b"ActionClosePreparedStatementRequest"


def _read_varint(buf: bytes, i: int) -> tuple[int, int]:
    """A protobuf base-128 varint, and the offset after it."""
    value = 0
    shift = 0
    while True:
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, i
        shift += 7


def _fields(buf: bytes):
    """Yield (field_number, wire_type, payload) for a flat protobuf message."""
    i = 0
    while i < len(buf):
        key, i = _read_varint(buf, i)
        field, wire = key >> 3, key & 0x07
        if wire == 2:
            length, i = _read_varint(buf, i)
            yield field, wire, buf[i:i + length]
            i += length
        elif wire == 0:
            value, i = _read_varint(buf, i)
            yield field, wire, value
        else:
            raise ValueError(f"unsupported wire type {wire}")


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _bytes_field(field: int, payload: bytes) -> bytes:
    """One length-delimited protobuf field."""
    return _varint((field << 3) | 2) + _varint(len(payload)) + payload


def _any(type_url: bytes, payload: bytes) -> bytes:
    """A `google.protobuf.Any`: `{ type_url = 1, value = 2 }`."""
    return _bytes_field(1, type_url) + _bytes_field(2, payload)


def _unwrap(command: bytes) -> tuple[bytes | None, bytes | None]:
    """Split an `Any` into its type URL and payload."""
    type_url = None
    payload = None
    for field, _wire, value in _fields(command):
        if field == 1:
            type_url = bytes(value)
        elif field == 2:
            payload = bytes(value)
    return type_url, payload


def _first_string(payload: bytes) -> str:
    for field, _wire, value in _fields(payload):
        if field == 1:
            return bytes(value).decode("utf8")
    raise ValueError("message carried no field 1")


def extract_query(command: bytes) -> str:
    """Pull the SQL text out of an `Any`-wrapped `CommandStatementQuery`.

    `Any` is `{ type_url = 1, value = 2 }`; `CommandStatementQuery` is
    `{ query = 1 }`. Anything else is refused rather than guessed at — a server
    that silently ran the wrong bytes would be worse than one that says no.
    """
    type_url, payload = _unwrap(command)
    if payload is None:
        raise ValueError("command carried no statement")
    # A prepared statement's handle *is* the SQL here — the stub keeps no
    # server-side statement store, so there is nothing to leak between calls.
    if type_url in (STATEMENT_QUERY, PREPARED_QUERY):
        return _first_string(payload)
    raise ValueError(f"unsupported command: {type_url!r}")


class FlightSqlStub(flight.FlightServerBase):
    def __init__(self, location: str, seed: str | None = None):
        super().__init__(location)
        self.db = duckdb.connect(":memory:")
        if seed:
            self.db.execute(seed)
        self.location = location

    def _table(self, query: str) -> "pa.Table":
        """A materialised Arrow table.

        `.arrow()` hands back a `RecordBatchReader` on this DuckDB build, which
        has no `num_rows` — and `GetFlightInfo` has to report a row count.
        """
        return self.db.execute(query).to_arrow_table()

    def do_action(self, context, action):
        """The prepared-statement lifecycle.

        ADBC prepares every statement before executing it, so a Flight SQL server
        that only answers `GetFlightInfo` refuses every query with `EOF` — which
        is how this stub started out, and a good argument for testing the client
        against a server rather than a mock of one.
        """
        type_url, payload = _unwrap(action.body.to_pybytes())

        if type_url == CREATE_PREPARED:
            query = _first_string(payload)
            schema = self._table(query).schema
            result = (
                # The handle carries the SQL, so no state is held between calls.
                _bytes_field(1, query.encode("utf8"))
                + _bytes_field(2, schema.serialize().to_pybytes())
            )
            return iter([flight.Result(_any(CREATE_PREPARED_RESULT, result))])

        if type_url == CLOSE_PREPARED:
            return iter(())

        raise flight.FlightServerError(f"unsupported action: {type_url!r}")

    def get_flight_info(self, context, descriptor):
        query = extract_query(descriptor.command)
        table = self._table(query)
        ticket = flight.Ticket(query.encode("utf8"))
        endpoint = flight.FlightEndpoint(ticket, [flight.Location.for_grpc_tcp("127.0.0.1", self.port)])
        return flight.FlightInfo(table.schema, descriptor, [endpoint], table.num_rows, -1)

    def do_get(self, context, ticket):
        query = ticket.ticket.decode("utf8")
        table = self._table(query)
        return flight.RecordBatchStream(table)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    seed_file = sys.argv[2] if len(sys.argv) > 2 else None
    seed = open(seed_file, encoding="utf8").read() if seed_file else None

    server = FlightSqlStub(f"grpc://127.0.0.1:{port}", seed)
    # The port is printed so a caller that asked for 0 can find out which one it
    # got — fixed ports in tests collide with whatever a previous crashed run
    # left listening.
    print(server.port, flush=True)
    server.serve()


if __name__ == "__main__":
    main()
