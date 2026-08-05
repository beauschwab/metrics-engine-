/**
 * Releases, channels, and the runtime read path.
 *
 * The claims worth pinning here are lifecycle claims: that editing after a
 * release changes nothing a client reads, that promotion is where the
 * governance gate bites, that rollback is a repoint rather than a revert, and
 * that a binding which cannot be faithful is refused rather than served.
 *
 * Everything runs through `handle()` — the same function the HTTP server
 * wires — against a real SQLite registry.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from './api';
import { migrate, openSqlite, type Db } from './db';
import { SQLITE } from './dialect';
import { Repository } from './repository';
import { shippedDocuments } from './index';

const dir = mkdtempSync(join(tmpdir(), 'keel-runtime-'));
let n = 0;
let db: Db;
let repo: Repository;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (db) await db.close();
  db = await openSqlite(join(dir, `t${++n}.db`), SQLITE);
  await migrate(db);
  repo = new Repository(db);
  await repo.seed(shippedDocuments());
});

const call = (method: string, path: string, body?: unknown, query?: Record<string, string>) =>
  handle(repo, {
    method, path,
    ...(body !== undefined ? { body } : {}),
    ...(query ? { query } : {}),
    identity: 'release-manager',
  });

const cut = async (message = 'cut') => {
  const res = await call('POST', '/api/releases', { message });
  expect(res.status).toBe(201);
  return (res.body as { version: number }).version;
};

const promote = (channel: string, version: number, extra: Record<string, unknown> = {}) =>
  call('PUT', `/api/channels/${channel}`, { version, message: 'deploy', ...extra });

const editThreshold = async (from: string, to: string) => {
  const doc = (await repo.latest('fr2052a_variance'))!;
  await repo.save({
    name: 'fr2052a_variance', kind: 'variance_monitor',
    body: doc.body.replace(from, to),
    author: 'author', message: 'edit',
  });
};

/**
 * A complete binding for the 2052a source — every column the outflows view,
 * its rules and the submission's grouping actually read, under client names,
 * with the segment vocabulary translated.
 */
const MUREX_BINDING = `version: 1
kind: source_binding
name: murex_eu
display_name: Murex — EU book
binds: alm.fct_2052a_positions
table: MUREX.V_LIQ_POSITIONS

columns:
  - canonical: as_of_date
    column: COB_DATE
  - canonical: balance_usd
    column: BAL_AMT_USD
  - canonical: maturity_date
    column: MAT_DATE
  - canonical: segment
    column: CUST_SEG
    map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}
  - canonical: direction
    column: FLOW_DIR
    map: {I: INFLOW, O: OUTFLOW}
  - canonical: insured_flag
    column: FDIC_INS
  - canonical: is_secured
    column: SECURED_FLG
  - canonical: counterparty_type
    column: CPTY_TYPE
  - canonical: account_type
    column: ACCT_TYPE
  - canonical: collateral_class
    column: COLL_CLASS
  - canonical: currency
    column: CCY
  - canonical: entity_id
    column: LEGAL_ENT
`;

const saveBinding = (body = MUREX_BINDING) =>
  repo.save({
    name: 'murex_eu', kind: 'source_binding', body,
    author: 'integration', message: 'bind murex',
  });

// ---------------------------------------------------------------------------

describe('cutting a release', () => {
  it('pins every artifact at its current revision', async () => {
    const version = await cut('first');
    const res = await call('GET', `/api/releases/${version}`);
    const release = res.body as { pins: Array<{ name: string; revision: number }>; author: string };
    expect(release.pins).toHaveLength(8);
    expect(release.pins.every((p) => p.revision === 1)).toBe(true);
    expect(release.author).toBe('release-manager');
  });

  it('records the workspace’s health rather than gating on it', async () => {
    // The shipped workspace carries two KEEL030s. A release gate that refuses
    // anything imperfect is a gate people learn to work around; what matters is
    // that the count is on the record when someone decides to deploy.
    const version = await cut();
    const res = await call('GET', `/api/releases/${version}`);
    expect((res.body as { errors: number }).errors).toBeGreaterThan(0);
  });

  it('refuses a message-less release — a release with no reason is not a record', async () => {
    expect((await call('POST', '/api/releases', {})).status).toBe(400);
  });

  it('numbers releases monotonically', async () => {
    expect(await cut()).toBe(1);
    expect(await cut()).toBe(2);
  });
});

describe('what a release makes true', () => {
  it('editing afterwards changes nothing a client reads', async () => {
    // The whole point. The surface autosaves drafts; a channel serves pins.
    const version = await cut();
    await promote('production', version);

    await editThreshold('limit: 1000000', 'limit: 999');

    const res = await call('GET', '/api/runtime/production');
    const manifest = res.body as { artifacts: Array<{ name: string; revision: number }> };
    const monitor = manifest.artifacts.find((a) => a.name === 'fr2052a_variance')!;
    expect(monitor.revision).toBe(1);

    const rules = await call('GET', '/api/runtime/production/rules/fr2052a_product_id');
    expect(rules.status).toBe(200);
  });

  it('serves the plan as the release pinned it, not as the workspace now says', async () => {
    const version = await cut();
    await promote('production', version);

    // Change the sink table in the draft workspace.
    const report = (await repo.latest('fr2052a_submission'))!;
    await repo.save({
      name: 'fr2052a_submission', kind: 'report',
      body: report.body.replace('reg.fr2052a_daily', 'reg.somewhere_else'),
      author: 'author', message: 'edit',
    });

    const res = await call('GET', '/api/runtime/production/plan/fr2052a_submission');
    const plan = res.body as { text: string; writes: string; release: number };
    expect(plan.release).toBe(version);
    expect(plan.writes).toBe('reg.fr2052a_daily');
    expect(plan.text).toContain('reg.fr2052a_daily');
    expect(plan.text).not.toContain('somewhere_else');
  });

  it('serves the whole plan, materialize step included', async () => {
    // Unlike live preview: the caller here IS the pipeline, and writing the
    // submission is precisely its job.
    await promote('production', await cut());
    const res = await call('GET', '/api/runtime/production/plan/fr2052a_submission');
    expect((res.body as { text: string }).text).toContain('INSERT OVERWRITE');
  });

  it('serves every compile target', async () => {
    await promote('production', await cut());
    for (const target of ['sql', 'polars', 'pyspark']) {
      const res = await call('GET', '/api/runtime/production/plan/fr2052a_submission', undefined, { target });
      expect(res.status, target).toBe(200);
    }
    expect((await call(
      'GET', '/api/runtime/production/plan/fr2052a_submission', undefined, { target: 'cobol' },
    )).status).toBe(400);
  });

  it('serves resolved rules in evaluation order, with citations', async () => {
    await promote('production', await cut());
    const res = await call('GET', '/api/runtime/production/rules/fr2052a_product_id');
    const rules = (res.body as { rules: Array<{ order: number; when: string; citation: string }> }).rules;
    expect(rules[0].order).toBe(1);
    expect(rules.every((r) => r.when && r.citation)).toBe(true);
  });
});

describe('promotion is where the gate bites', () => {
  it('lets a first promotion through — nothing to weaken relative to', async () => {
    const res = await promote('production', await cut());
    expect(res.status).toBe(200);
  });

  it('refuses promoting a release that weakens what the channel serves', async () => {
    await promote('production', await cut('baseline'));

    await editThreshold('limit: 1000000', 'limit: 5000000');
    const loosened = await cut('quieter alerts');

    const res = await promote('production', loosened);
    expect(res.status).toBe(400);
    const body = res.body as { error: string; issues: Array<{ summary: string }> };
    expect(body.error).toMatch(/Silences 3 breaches/);
    expect(body.issues.length).toBeGreaterThan(0);
    // And production still serves the old release.
    const channel = await call('GET', '/api/channels/production');
    expect((channel.body as { version: number }).version).toBe(1);
  });

  it('goes through once acknowledged, and records what was acknowledged', async () => {
    await promote('production', await cut());
    await editThreshold('limit: 1000000', 'limit: 5000000');
    const loosened = await cut();

    const res = await promote('production', loosened, { acknowledgeReview: true });
    expect(res.status).toBe(200);

    const channel = await call('GET', '/api/channels/production');
    const history = (channel.body as { history: Array<{ message: string; actor: string }> }).history;
    expect(history[0].message).toMatch(/review acknowledged/);
    expect(history[0].message).toMatch(/Silences 3 breaches/);
    expect(history[0].actor).toBe('release-manager');
  });

  it('compares against the channel, not the previous release number', async () => {
    // Releases can be cut and skipped; the governance question is what changes
    // for the people reading this channel.
    await promote('production', await cut('r1'));
    await editThreshold('limit: 1000000', 'limit: 5000000');
    await cut('r2 — never deployed');
    await editThreshold('limit: 5000000', 'limit: 1000000');
    const r3 = await cut('r3 — same thresholds as r1');

    // r3 vs what production serves (r1): no weakening, no gate.
    expect((await promote('production', r3)).status).toBe(200);
  });

  it('rolls back by repointing, and the gate judges that too', async () => {
    await promote('production', await cut());
    await editThreshold('limit: 1000000', 'limit: 100000');
    const tightened = await cut();
    await promote('production', tightened);

    // Rolling back to r1 loosens relative to what is now deployed — so the
    // gate fires on the rollback, which is exactly right: a rollback is a
    // deployment like any other.
    const back = await promote('production', 1);
    expect(back.status).toBe(400);
    expect((await promote('production', 1, { acknowledgeReview: true })).status).toBe(200);
    const channel = await call('GET', '/api/channels/production');
    expect((channel.body as { version: number }).version).toBe(1);
  });

  it('keeps channels independent', async () => {
    const v1 = await cut();
    await promote('production', v1);
    await editThreshold('limit: 1000000', 'limit: 100000');
    const v2 = await cut();
    await promote('staging', v2);

    expect(((await call('GET', '/api/channels/production')).body as { version: number }).version).toBe(v1);
    expect(((await call('GET', '/api/channels/staging')).body as { version: number }).version).toBe(v2);
  });

  it('404s an unknown channel and an unknown release', async () => {
    expect((await call('GET', '/api/runtime/production')).status).toBe(404);
    expect((await promote('production', 99)).status).toBe(404);
  });
});

describe('bindings — the same rule over a differently-shaped table', () => {
  it('serves an adapter beside the untouched canonical plan', async () => {
    await saveBinding();
    await promote('production', await cut());

    const bare = await call('GET', '/api/runtime/production/plan/fr2052a_submission');
    const bound = await call(
      'GET', '/api/runtime/production/plan/fr2052a_submission', undefined, { binding: 'murex_eu' },
    );
    expect(bound.status).toBe(200);

    const a = bound.body as {
      text: string;
      adapter: { sql: string; model: { renames: Record<string, string>; maps: Record<string, Record<string, string>> } };
    };
    // The plan is byte-identical with and without the binding — one plan
    // everywhere is the conformance story. The adapter is what varies.
    expect(a.text).toBe((bare.body as { text: string }).text);
    expect(a.adapter.sql).toContain('CREATE OR REPLACE VIEW alm.fct_2052a_positions');
    expect(a.adapter.sql).toContain('BAL_AMT_USD AS balance_usd');
    expect(a.adapter.sql).toContain("WHEN 'RTL' THEN 'RETAIL'");
    // An unknown client code becomes NULL and lands in coverage as unmapped —
    // not the raw code failing every rule while looking like data.
    expect(a.adapter.sql).toContain('ELSE NULL');
    expect(a.adapter.model.renames.CUST_SEG).toBe('segment');
    expect(a.adapter.model.maps.segment.RTL).toBe('RETAIL');
  });

  it('refuses an adapter missing a column the rules read, and names it', async () => {
    await saveBinding(MUREX_BINDING.replace(
      /  - canonical: is_secured\n    column: SECURED_FLG\n/, '',
    ));
    await promote('production', await cut());

    const res = await call(
      'GET', '/api/runtime/production/plan/fr2052a_submission', undefined, { binding: 'murex_eu' },
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/is_secured/);
  });

  it('refuses a vocabulary that can never produce a value the rules test for', async () => {
    // The silent failure this whole check exists for: without SBB→SMALL_BUSINESS,
    // the small-business rule never fires on this system, forever, and nothing
    // downstream would ever say so.
    await saveBinding(MUREX_BINDING.replace(
      'map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}',
      'map: {RTL: RETAIL, WSL: WHOLESALE}',
    ));
    await promote('production', await cut());

    const res = await call(
      'GET', '/api/runtime/production/plan/fr2052a_submission', undefined, { binding: 'murex_eu' },
    );
    expect(res.status).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/SMALL_BUSINESS/);
    expect(body.error).toMatch(/can never fire/);
  });

  it('refuses a binding aimed at a different source than the report reads', async () => {
    await saveBinding(MUREX_BINDING.replace(
      'binds: alm.fct_2052a_positions', 'binds: alm.fct_liquidity_position',
    ));
    await promote('production', await cut());
    const res = await call(
      'GET', '/api/runtime/production/plan/fr2052a_submission', undefined, { binding: 'murex_eu' },
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/wrong binding/);
  });

  it('404s a binding the release does not carry', async () => {
    await promote('production', await cut());
    const res = await call(
      'GET', '/api/runtime/production/plan/fr2052a_submission', undefined, { binding: 'nope' },
    );
    expect(res.status).toBe(404);
  });
});
