#!/usr/bin/env bash
# Push the liquidity DAGs to a Kubernetes-hosted Airflow instance.
#
# The scheduler needs more than the two DAG files: the task bodies
# (liquidity_pipeline/), the contracts, the dbt project and the registry
# snapshot all resolve relative to the bundle, so this script stages exactly
# that set — nothing else — and delivers it one of two ways, matching how
# Kubernetes Airflow instances actually consume DAGs:
#
#   --mode git       For instances using the official Helm chart's git-sync
#                    sidecar (the common setup): commit the bundle to the
#                    branch/subdir the instance watches and push. git-sync
#                    pulls it onto every scheduler/worker within its poll
#                    interval — deployment is a git push, rollback is a
#                    revert. See deploy/airflow-values.nonprod.yaml for the
#                    matching chart values.
#
#   --mode kubectl   For instances mounting a shared DAGs volume (PVC):
#                    stream the bundle into the pods' DAGs path over
#                    `kubectl exec … tar`. Handy for a quick non-prod push
#                    without a git round trip; not a deployment record.
#
# Configuration (env, all with defaults):
#   git mode:      DAGS_GIT_URL      (required) repo git-sync watches
#                  DAGS_GIT_BRANCH   default: nonprod-dags
#                  DAGS_GIT_SUBDIR   default: liquidity
#   kubectl mode:  AIRFLOW_NAMESPACE     default: airflow-nonprod
#                  AIRFLOW_POD_SELECTOR  default: component=scheduler
#                  AIRFLOW_DAGS_PATH     default: /opt/airflow/dags
#                  (with a shared PVC one pod is enough — every pod mounts it)
#
# Either way the bundle root is the DAGs folder (or a subdir of it), which is
# what makes `import liquidity_pipeline` work on the scheduler: Airflow puts
# the DAGs folder on sys.path, the package sits at the bundle root, and the
# .airflowignore staged alongside keeps the parser out of dbt/, contracts/
# and the snapshot.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
MODE=""
DRY_RUN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$MODE" ] || { echo "usage: deploy_dags.sh --mode git|kubectl [--dry-run]" >&2; exit 2; }

say() { echo "[deploy] $*" >&2; }

# --- stage the bundle -------------------------------------------------------

BUNDLE="$HERE/.local/deploy/bundle"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"

# tar rather than rsync/cp: present everywhere, and excludes stay readable.
tar -cf - -C "$HERE" \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='dbt/target' --exclude='dbt/logs' --exclude='dbt/.user.yml' \
  dags liquidity_pipeline contracts registry_snapshot dbt \
  | tar -xf - -C "$BUNDLE"

# Only dags/ holds DAG definitions; keep the parser out of everything else.
cat > "$BUNDLE/.airflowignore" <<'EOF'
liquidity_pipeline/
contracts/
dbt/
registry_snapshot/
EOF

# Which code is this? The first question when a non-prod run misbehaves.
{
  echo "source_commit: $(git -C "$HERE" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "source_branch: $(git -C "$HERE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "bundled_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$BUNDLE/BUILD_INFO"

say "bundle staged: $(du -sh "$BUNDLE" | cut -f1) at $BUNDLE"
[ -n "$DRY_RUN" ] && { say "dry run — stopping after staging"; exit 0; }

# --- deliver ----------------------------------------------------------------

if [ "$MODE" = "git" ]; then
  : "${DAGS_GIT_URL:?set DAGS_GIT_URL to the repo that git-sync watches}"
  BRANCH="${DAGS_GIT_BRANCH:-nonprod-dags}"
  SUBDIR="${DAGS_GIT_SUBDIR:-liquidity}"

  CHECKOUT="$HERE/.local/deploy/checkout"
  rm -rf "$CHECKOUT"
  if git clone --depth 1 --branch "$BRANCH" "$DAGS_GIT_URL" "$CHECKOUT" 2>/dev/null; then
    say "checked out $BRANCH"
  else
    say "branch $BRANCH does not exist yet — creating it empty"
    git clone --depth 1 "$DAGS_GIT_URL" "$CHECKOUT"
    git -C "$CHECKOUT" checkout --orphan "$BRANCH"
    git -C "$CHECKOUT" rm -rf --quiet . 2>/dev/null || true
  fi

  rm -rf "$CHECKOUT/$SUBDIR"
  mkdir -p "$CHECKOUT/$SUBDIR"
  tar -cf - -C "$BUNDLE" . | tar -xf - -C "$CHECKOUT/$SUBDIR"
  # BUILD_INFO carries a timestamp, so it alone never justifies a deploy —
  # a re-push of identical code should be a no-op, not a git-sync churn.
  if git -C "$CHECKOUT" status --porcelain | grep -v 'BUILD_INFO' | grep -q .; then
    git -C "$CHECKOUT" add -A
    git -C "$CHECKOUT" commit -q -m "liquidity dags @ $(sed -n 's/^source_commit: //p' "$BUNDLE/BUILD_INFO" | cut -c1-12)"
    git -C "$CHECKOUT" push origin "$BRANCH"
    say "pushed to $DAGS_GIT_URL $BRANCH/$SUBDIR — git-sync picks it up on its next poll"
  else
    say "nothing changed — instance is already on this bundle"
  fi

elif [ "$MODE" = "kubectl" ]; then
  NS="${AIRFLOW_NAMESPACE:-airflow-nonprod}"
  SELECTOR="${AIRFLOW_POD_SELECTOR:-component=scheduler}"
  DAGS_PATH="${AIRFLOW_DAGS_PATH:-/opt/airflow/dags}"

  PODS=$(kubectl -n "$NS" get pods -l "$SELECTOR" -o jsonpath='{.items[*].metadata.name}')
  [ -n "$PODS" ] || { echo "no pods match -l $SELECTOR in $NS" >&2; exit 1; }

  for pod in $PODS; do
    say "streaming bundle to $pod:$DAGS_PATH/liquidity"
    kubectl -n "$NS" exec "$pod" -- mkdir -p "$DAGS_PATH/liquidity"
    tar -czf - -C "$BUNDLE" . \
      | kubectl -n "$NS" exec -i "$pod" -- tar -xzf - -C "$DAGS_PATH/liquidity"
  done
  say "done — the dag processor rescans on its own; 'airflow dags list' in the pod to confirm"

else
  echo "unknown mode: $MODE (git or kubectl)" >&2
  exit 2
fi
