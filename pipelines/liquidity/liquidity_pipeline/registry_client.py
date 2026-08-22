"""The rules-engine registry, as the pipeline consumes it.

The registry (packages/registry in this repo) is where the governed logic
lives: the FR 2052a classification, the LCR rate table, the prepared row
stage, and the submission report they compose into. This client speaks the
registry's runtime contract — dereference a *channel*, never a release:

  manifest   what the channel serves right now: release version + artifact
             revisions and hashes. Logged with every run, because "which
             rules computed this file" is the first question anyone asks.
  rules      a classification resolved to evaluation order, with citations.
  plan       the whole report compiled for a backend (sql / pyspark), the
             materialize step included.
  artifact   one governed document body at the exact revision the manifest
             pins — how the pipeline reads the rate table.

Two modes, chosen by configuration and never silently:

  KEEL_BASE_URL set    → live HTTP against a running registry; an unreachable
                         registry fails the run rather than degrading.
  KEEL_BASE_URL unset  → the committed snapshot under registry_snapshot/,
                         which is a captured set of the same HTTP responses
                         (scripts/refresh_registry_snapshot.sh regenerates
                         it). Releases are immutable, so a snapshot of
                         release N *is* release N — this is a cache, not a
                         fork. It is what makes dev and CI hermetic.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from . import config


class RegistryError(RuntimeError):
    """The registry refused or could not answer; the message says why."""


class LiveRegistry:
    def __init__(self, base: str, channel: str, timeout: float = 30.0):
        self.base = base.rstrip("/")
        self.channel = channel
        self.timeout = timeout

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
            raise RegistryError(f"{err.code} from {path}: {message}") from None
        except urllib.error.URLError as err:
            raise RegistryError(
                f"registry at {self.base} unreachable ({err.reason}) — "
                "unset KEEL_BASE_URL to run from the committed snapshot"
            ) from None

    def manifest(self) -> dict:
        return self._get(f"/api/runtime/{self.channel}")

    def rules(self, classification: str, as_of: Optional[str] = None) -> dict:
        return self._get(
            f"/api/runtime/{self.channel}/rules/{classification}", {"asOf": as_of}
        )

    def plan(self, report: str, target: str = "sql", binding: Optional[str] = None) -> dict:
        return self._get(
            f"/api/runtime/{self.channel}/plan/{report}",
            {"target": target, "binding": binding},
        )

    def artifact(self, name: str, revision: Optional[int] = None) -> dict:
        return self._get(
            f"/api/artifacts/{name}",
            {"revision": str(revision)} if revision is not None else None,
        )


class SnapshotRegistry:
    """The same responses, read from disk. See the module docstring."""

    def __init__(self, root: Path, channel: str):
        self.root = root
        self.channel = channel
        if not (root / "manifest.json").exists():
            raise RegistryError(
                f"no registry snapshot at {root} — run "
                "scripts/refresh_registry_snapshot.sh against a live registry, "
                "or set KEEL_BASE_URL"
            )

    def _read(self, *parts: str) -> dict:
        path = self.root.joinpath(*parts)
        if not path.exists():
            raise RegistryError(f"snapshot has no {'/'.join(parts)} — refresh it")
        return json.loads(path.read_text())

    def manifest(self) -> dict:
        return self._read("manifest.json")

    def rules(self, classification: str, as_of: Optional[str] = None) -> dict:
        return self._read("rules", f"{classification}.json")

    def plan(self, report: str, target: str = "sql", binding: Optional[str] = None) -> dict:
        if binding:
            raise RegistryError("the snapshot captures unbound plans only")
        return self._read("plans", f"{report}.{target}.json")

    def artifact(self, name: str, revision: Optional[int] = None) -> dict:
        found = self._read("artifacts", f"{name}.json")
        if revision is not None and found.get("revision") != revision:
            raise RegistryError(
                f"snapshot holds {name} at revision {found.get('revision')}, "
                f"the manifest wants {revision} — refresh the snapshot"
            )
        return found


Registry = LiveRegistry | SnapshotRegistry


def get_registry() -> Registry:
    base = config.registry_base()
    channel = config.registry_channel()
    if base:
        return LiveRegistry(base, channel)
    return SnapshotRegistry(config.SNAPSHOT_DIR, channel)
