# Walkthrough screenshots

[`executive-brief.html`](executive-brief.html) is the executive-facing read of this
material — the product vision and value statement, with these screenshots as its
evidence. Open it in a browser; it is a self-contained page next to the images it
references, so regenerating the shots below updates the brief with them.

The images in [`product.md` §7](../../product.md) are of the running system,
not mockups. This is how to regenerate them.

Everything below is local and hermetic apart from the npm/uv installs. The
demo registry is a scratch SQLite file, so the sequence can be run repeatedly
from a clean state.

## The processes

```bash
# 1. the registry, with identity asserted the way a proxy would
KEEL_SQLITE_FILE=/tmp/demo-keel.db KEEL_IDENTITY_HEADER=x-identity \
  npx tsx packages/registry/index.ts                                    # :8787

# 2. the authoring surface
(cd apps/registry-web && npm run build \
  && npx vite preview --port 4173 --strictPort --host 127.0.0.1)        # :4173

# 3. the chartroom API, pointed at that registry
(cd apps/chartroom-api && CHARTROOM_SQLITE_FILE=/tmp/demo-chartroom.db \
  KEEL_API=http://127.0.0.1:8787 ANTHROPIC_API_KEY= npx tsx src/index.ts) # :8788

# 4. the studio
(cd apps/chartroom-studio && npm run build \
  && npx vite preview --port 4174 --strictPort --host 127.0.0.1)        # :4174
```

`ANTHROPIC_API_KEY=` is blanked deliberately: the shots should show the
no-model degrade path rather than depend on a key.

## The sequence

The walkthrough is three acts against those processes. It takes three names
— an author, a reviewer, a deployer — because the workspace is tier-1 and one
person cannot carry a weakened rule to production alone (ADR-57). Each is
asserted with an `x-identity` header, exactly as the proxy would.

1. **Baseline.** Cut release r1 as `author` and promote it to `production` as
   `deployer`, so the workspace and the channel agree. Capture with `node
   docs/vision/capture.mjs baseline`, then run the pipeline against the
   channel to record what it files.
2. **The change.** As `author`, edit `lcr_outflow_rates` so `O.W.2` moves
   `0.40 → 0.50` (a `PUT /api/artifacts/lcr_outflow_rates` with
   `expectedRevision` and `acknowledgeReview: true`, the same write the
   surface makes). Capture with `… capture.mjs proposed`. Re-run the pipeline
   and confirm it files the *same* numbers — it still reads r1.
3. **Promotion.** Three refusals to walk through, each naming its control:
   - Cutting r2 as `author` is refused — the acknowledged weakening has no
     second name yet. As `reviewer`, `POST
     /api/artifacts/lcr_outflow_rates/review {"revision": 2}`, then the cut
     goes through.
   - Promoting r2 as `author` is refused — whoever cut a tier-1 release
     cannot be the only name deploying it. Promote as `deployer`.
   - That promotion is refused once more, for the change itself: re-send with
     `acknowledgeReview: true` and a reason.

   Re-run the pipeline and record the new filed numbers.

The pipeline runs are `pipelines/liquidity` driven against the live registry:

```bash
cd pipelines/liquidity
KEEL_BASE_URL=http://localhost:8787 LIQ_DATA_DIR=$PWD/.local uv run python - <<'PY'
from liquidity_pipeline import config, tasks
AS_OF = "2026-06-30"
tasks.land_extracts(AS_OF)
for feed in config.FEEDS:
    tasks.enforce_feed_contract(feed, AS_OF); tasks.conform_feed(feed, AS_OF)
release = tasks.fetch_release(AS_OF)
tasks.apply_rules(AS_OF); tasks.file_submission(AS_OF)
print(release, tasks.compute_lcr(AS_OF)["lcr"]["CONSOLIDATED"])
PY
```

## The Airflow shots

`pipeline-dags.png` and `pipeline-assets.png` come from a real Airflow 3.3
instance over the pipeline's own DAGs:

```bash
cd pipelines/liquidity
export AIRFLOW_HOME=/tmp/afui AIRFLOW__CORE__DAGS_FOLDER=$PWD/dags \
       AIRFLOW__CORE__LOAD_EXAMPLES=false LIQ_DATA_DIR=$PWD/.local \
       AIRFLOW__API_AUTH__JWT_SECRET=liquidity-demo-secret \
       AIRFLOW__CORE__SIMPLE_AUTH_MANAGER_ALL_ADMINS=True
uv run airflow db migrate
uv run airflow dags test daily_liquidity_conformance 2026-06-30
uv run airflow dags test daily_liquidity_regulatory  2026-06-30
uv run airflow api-server --port 8080
```

## Notes

- `capture.mjs` drives the studio's **read-only view** route (`#/view/<id>`)
  rather than the studio shell, so every phase is framed identically and the
  before/after pairs are comparable.
- Set `CHROMIUM_PATH` if the image's Chromium build differs from the one this
  repo's Playwright pins — the same escape hatch the e2e configs carry.
- The `proposed` and `promoted` dashboard captures are byte-identical, which
  is the point of §7.3: the studio binds at save, the pipeline binds at
  promotion. Only the pipeline's filed numbers move at step 3.
