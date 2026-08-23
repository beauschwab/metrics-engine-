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
# the repo root first (see the command below). If the channel has no release yet
# (a fresh SQLite file), this cuts one from the seeded workspace and promotes
# it — the same two deliberate acts a human would do in the surface.
#
# The seeded workspace carries tier-1 artifacts, so ADR-57 applies: whoever
# cuts a release cannot be the only name on deploying it. The two acts are
# therefore asserted under two identities, through the identity header the
# registry's front door reads. Start the registry with that header named:
#
#   KEEL_IDENTITY_HEADER=x-keel-identity npm run registry
#
# Without it the registry asserts nothing, both acts land as `unknown`, and
# the promotion is refused — correctly. This branch only ever runs against a
# fresh local registry; a real deployment has two people, not two variables.
set -euo pipefail

BASE="${1:-http://localhost:8787}"
CHANNEL="${2:-production}"
IDENTITY_HEADER="${KEEL_IDENTITY_HEADER:-x-keel-identity}"
CUTTER="${KEEL_SNAPSHOT_CUTTER:-${USER:-pipeline}}"
PROMOTER="${KEEL_SNAPSHOT_PROMOTER:-${USER:-pipeline}-deploy}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/registry_snapshot"

say() { echo "[snapshot] $*" >&2; }

# --- make sure the channel serves something --------------------------------
if ! curl -sf "$BASE/api/runtime/$CHANNEL" >/dev/null 2>&1; then
  say "channel $CHANNEL serves nothing yet — cutting and promoting a release"
  if [ "$CUTTER" = "$PROMOTER" ]; then
    say "KEEL_SNAPSHOT_CUTTER and KEEL_SNAPSHOT_PROMOTER are both '$CUTTER' —"
    say "the promotion will be refused (ADR-57: the cutter is not the only name)"
    exit 1
  fi
  release=$(curl -sf -X POST "$BASE/api/releases" \
    -H 'content-type: application/json' \
    -H "$IDENTITY_HEADER: $CUTTER" \
    -d "{\"message\": \"Initial release for the liquidity pipeline snapshot\"}")
  version=$(echo "$release" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
  say "cut release r$version as $CUTTER"
  if ! curl -sf -X PUT "$BASE/api/channels/$CHANNEL" \
    -H 'content-type: application/json' \
    -H "$IDENTITY_HEADER: $PROMOTER" \
    -d "{\"version\": $version, \"message\": \"Promoted for the liquidity pipeline\"}" >/dev/null; then
    say "promotion of r$version was refused — if the registry was started without"
    say "KEEL_IDENTITY_HEADER it read no identity from either act, and ADR-57"
    say "will not let one name both cut and deploy a tier-1 release"
    exit 1
  fi
  say "promoted r$version to $CHANNEL as $PROMOTER"
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
