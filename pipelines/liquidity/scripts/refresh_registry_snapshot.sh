#!/usr/bin/env bash
# Capture the registry's runtime responses into registry_snapshot/.
#
# The snapshot is how dev and CI run hermetically: releases are immutable, so
# a captured release *is* that release, byte for byte. Refresh it whenever the
# production channel moves — the pipeline logs the release version with every
# run, so a stale snapshot is visible, not silent.
#
# Usage:
#   ./scripts/refresh_registry_snapshot.sh [base-url] [channel]
#
# Defaults to http://localhost:8787 and production. Start the registry from
# the repo root first (`npm run registry`). If the channel has no release yet
# (a fresh SQLite file), this cuts one from the seeded workspace and promotes
# it, attributing both to $USER — the same two deliberate acts a human would
# do in the surface.
set -euo pipefail

BASE="${1:-http://localhost:8787}"
CHANNEL="${2:-production}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/registry_snapshot"

say() { echo "[snapshot] $*" >&2; }

# --- make sure the channel serves something --------------------------------
if ! curl -sf "$BASE/api/runtime/$CHANNEL" >/dev/null 2>&1; then
  say "channel $CHANNEL serves nothing yet — cutting and promoting a release"
  release=$(curl -sf -X POST "$BASE/api/releases" \
    -H 'content-type: application/json' \
    -d "{\"message\": \"Initial release for the liquidity pipeline snapshot\", \"author\": \"${USER:-pipeline}\"}")
  version=$(echo "$release" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
  say "cut release r$version"
  curl -sf -X PUT "$BASE/api/channels/$CHANNEL" \
    -H 'content-type: application/json' \
    -d "{\"version\": $version, \"message\": \"Promoted for the liquidity pipeline\"}" >/dev/null
  say "promoted r$version to $CHANNEL"
fi

mkdir -p "$OUT/rules" "$OUT/plans" "$OUT/artifacts"

fetch() { # fetch <url> <dest>
  curl -sf "$1" | python3 -m json.tool > "$2"
  say "wrote ${2#"$OUT/"}"
}

fetch "$BASE/api/runtime/$CHANNEL" "$OUT/manifest.json"
fetch "$BASE/api/runtime/$CHANNEL/rules/fr2052a_product_id" "$OUT/rules/fr2052a_product_id.json"
fetch "$BASE/api/runtime/$CHANNEL/plan/fr2052a_submission?target=sql" "$OUT/plans/fr2052a_submission.sql.json"
fetch "$BASE/api/runtime/$CHANNEL/plan/fr2052a_submission?target=pyspark" "$OUT/plans/fr2052a_submission.pyspark.json"

# Parameter sets ride along as artifact bodies, pinned at the revision the
# manifest names — the same read a live client does.
rev=$(python3 -c "
import json
m = json.load(open('$OUT/manifest.json'))
print(next(a['revision'] for a in m['artifacts'] if a['name'] == 'lcr_outflow_rates'))
")
fetch "$BASE/api/artifacts/lcr_outflow_rates?revision=$rev" "$OUT/artifacts/lcr_outflow_rates.json"

say "done — snapshot of $CHANNEL at $(python3 -c "
import json
m = json.load(open('$OUT/manifest.json'))
print('release r%s' % m['release']['version'])
")"
