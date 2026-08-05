"""A runtime client for the Keel registry.

This is the documented way for a pipeline or an application to consume
transformation logic at run time. The contract is small on purpose:

  manifest  what the channel currently serves — release version, artifacts,
            content hashes. Poll this; everything else is cacheable against
            ``release.version``, because releases are immutable: the same
            version is always the same bytes.
  plan      the compiled plan for a report (sql / polars / pyspark), optionally
            with the adapter for a named source binding when your table is not
            shaped like the canonical source.
  rules     a classification resolved to evaluation order, with citations —
            for clients that apply rules themselves rather than running SQL.

A client never names a release. It dereferences a *channel* (``production``,
``staging``) and gets whatever was last deliberately promoted there. Authors
editing in the surface change nothing you read until someone cuts a release
and promotes it — so there is no torn state to defend against and no need to
re-fetch on a schedule faster than your own runs.

Zero dependencies beyond the standard library, so this file can be copied into
an environment that cannot pip-install. If you have ``requests``, feel free to
translate; the contract is four GETs.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any, Optional


class KeelError(RuntimeError):
    """The registry refused or could not answer; the message says why.

    A refusal (HTTP 400) is something to read, not retry: an unfaithful
    binding, an unknown compile target. It carries the registry's own words —
    including, for a refused adapter, the list of columns or vocabulary values
    that made it unfaithful.
    """


class KeelClient:
    def __init__(self, base: str, channel: str, timeout: float = 30.0):
        self.base = base.rstrip("/")
        self.channel = channel
        self.timeout = timeout

    # -- transport ----------------------------------------------------------

    def _get(self, path: str, params: Optional[dict] = None) -> Any:
        url = f"{self.base}{path}"
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v})
        try:
            with urllib.request.urlopen(url, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")
            try:
                message = json.loads(body).get("error", body)
            except (ValueError, AttributeError):
                message = body
            raise KeelError(f"{err.code} from {path}: {message}") from None

    # -- the contract -------------------------------------------------------

    def manifest(self) -> dict:
        """What this channel serves right now. Cache key: release.version."""
        return self._get(f"/api/runtime/{self.channel}")

    def plan(self, report: str, target: str = "sql", binding: Optional[str] = None) -> dict:
        """The compiled plan for a report, as the deployed release defines it.

        The returned ``text`` is the whole plan, materialize step included —
        the caller is the pipeline, and writing the sink is its job. Split on
        the ``-- materialize`` marker if you only want the read half.

        With ``binding``, the response adds ``adapter``:

          ``adapter["statements"]``  execute these, in order — already split
          ``adapter["sql"]``         the same thing whole, for humans
          ``adapter["model"]``       renames and value maps, for DataFrame clients

        Use ``statements``. Splitting ``sql`` on ``;`` yourself makes you a
        small, wrong SQL parser. The plan itself is byte-identical with or
        without a binding — that is the point.
        """
        return self._get(
            f"/api/runtime/{self.channel}/plan/{report}",
            {"target": target, "binding": binding},
        )

    def rules(self, classification: str, as_of: Optional[str] = None) -> dict:
        """The rule set resolved to evaluation order. Position is semantics:
        the first matching rule wins, so apply them in the order given."""
        return self._get(
            f"/api/runtime/{self.channel}/rules/{classification}",
            {"asOf": as_of},
        )


def split_plan(text: str) -> tuple[str, str]:
    """A compiled SQL plan is a query plus an optional materialize step.

    Returns ``(query, materialize)``. Use the query half when previewing or
    when the write is handled by other machinery (an Iceberg committer, a
    warehouse-native scheduler) rather than by this SQL.
    """
    marker = "-- materialize"
    at = text.find(marker)
    if at < 0:
        return text.strip(), ""
    return text[:at].strip(), text[at:].strip()
