"""The live half of the registry contract.

Snapshot mode is the hermetic default, so this file is what proves the HTTP
path: same client, a real server, and the invariant that makes the snapshot
safe — a channel's release N serves the same bytes the snapshot captured.

Skipped unless a registry is reachable (start one with `npm run registry`
from the repo root and export KEEL_LIVE_BASE=http://localhost:8787).
"""

from __future__ import annotations

import os
import urllib.request

import pytest

from liquidity_pipeline.registry_client import LiveRegistry, SnapshotRegistry
from liquidity_pipeline import config

BASE = os.environ.get("KEEL_LIVE_BASE", "http://localhost:8787")


def _reachable() -> bool:
    try:
        urllib.request.urlopen(f"{BASE}/api/health", timeout=2)
        return True
    except OSError:
        return False


pytestmark = [
    pytest.mark.live_registry,
    pytest.mark.skipif(not _reachable(), reason=f"no registry at {BASE}"),
]


def test_live_channel_serves_what_the_snapshot_captured():
    live = LiveRegistry(BASE, "production")
    snap = SnapshotRegistry(config.SNAPSHOT_DIR, "production")

    live_manifest = live.manifest()
    snap_manifest = snap.manifest()

    if live_manifest["release"]["version"] != snap_manifest["release"]["version"]:
        pytest.skip("channel has moved past the snapshot — refresh it to compare")

    assert live.rules("fr2052a_product_id")["rules"] == snap.rules("fr2052a_product_id")["rules"]
    assert (
        live.plan("fr2052a_submission", "sql")["text"]
        == snap.plan("fr2052a_submission", "sql")["text"]
    )


def test_live_refuses_unknown_classification():
    from liquidity_pipeline.registry_client import RegistryError

    live = LiveRegistry(BASE, "production")
    with pytest.raises(RegistryError, match="no classification"):
        live.rules("no_such_ruleset")
