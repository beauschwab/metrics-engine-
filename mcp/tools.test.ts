/**
 * The registry as tools an agent can call.
 *
 * Tested at the level they are written — plain functions over a real SQLite
 * registry, no subprocess, no stdio pipe. `server.ts` is a schema binding with
 * no decisions in it, so everything worth asserting is here.
 *
 * The read tests are about *resolution*: an agent asking for a rule set must get
 * the ordered semantics rather than a YAML blob it has to re-derive first-match
 * precedence from. The write tests are about the three gates, each of which
 * exists because of a different way an agent with a registry connection can do
 * damage without meaning to.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openSqlite, type Db } from '../server/db';
import { SQLITE } from '../server/dialect';
import { Repository } from '../server/repository';
import { shippedDocuments } from '../server/index';
import {
  ToolError, assessProposed, compile, getArtifact, getHistory, getLineage,
  getLineageGraph, getParameters, getRules, listArtifacts, policyFromEnv, previewReport,
  saveArtifact, testRules, validate, type McpPolicy,
} from './tools';

const dir = mkdtempSync(join(tmpdir(), 'keel-mcp-'));
let n = 0;
let db: Db;
let repo: Repository;

const READ_ONLY: McpPolicy = { canWrite: false, identity: 'agent-x', fixture: 'nominal' };
const WRITER: McpPolicy = { canWrite: true, identity: 'agent-x', fixture: 'nominal' };

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

const bodyOf = async (name: string) => (await getArtifact(repo, name)).body;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('finding the right document', () => {
  it('lists everything with the stage that tells two views apart', async () => {
    // Without the stage an agent sees several `metrics_view`s and cannot tell a
    // dashboard ratio from a pipeline enrichment stage — the same collision the
    // surface had before the tree was grouped.
    const all = await listArtifacts(repo);
    const by = (name: string) => all.find((a) => a.name === name)!;

    expect(all).toHaveLength(8);
    expect(by('liquidity_pit').kind).toBe(by('fr2052a_outflows').kind);
    expect(by('liquidity_pit').stage).toBe('publish');
    expect(by('fr2052a_outflows').stage).toBe('prepare');
  });

  it('says where each one runs and what it writes', async () => {
    const all = await listArtifacts(repo);
    const submission = all.find((a) => a.name === 'fr2052a_submission')!;
    expect(submission.writes).toBe('reg.fr2052a_daily');
    expect(submission.runtime).toMatch(/pipeline/i);
    expect(submission.tier).toBe(1);
    expect(submission.owner).toBe('Liquidity Regulatory Reporting');
  });

  it('reads a historical revision, which is what append-only is for', async () => {
    await saveArtifact(repo, WRITER, {
      name: 'liquidity_pit',
      body: `${await bodyOf('liquidity_pit')}\n# a note`,
      message: 'note',
    });
    expect((await getArtifact(repo, 'liquidity_pit', 1)).body).not.toContain('# a note');
    expect((await getArtifact(repo, 'liquidity_pit')).body).toContain('# a note');
  });

  it('names what it cannot find rather than returning nothing', async () => {
    await expect(getArtifact(repo, 'nope')).rejects.toThrow(ToolError);
    await expect(getHistory(repo, 'nope')).rejects.toThrow(/no artifact called nope/);
  });
});

describe('the rules themselves', () => {
  it('returns evaluation order, not document text', async () => {
    // First-match precedence means a rule's position is part of its meaning.
    // Handing back YAML would make every caller re-derive that.
    const set = await getRules(repo, 'fr2052a_product_id', READ_ONLY);
    expect(set.rules[0].order).toBe(1);
    expect(set.rules.map((r) => r.order)).toEqual(set.rules.map((_, i) => i + 1));
    expect(set.column).toBe('product_id');
    expect(set.rules.length).toBeGreaterThan(10);
  });

  it('carries the condition, the emitted value and the citation', async () => {
    const set = await getRules(repo, 'fr2052a_product_id', READ_ONLY);
    const rule = set.rules.find((r) => r.emit === 'O.D.1')!;
    expect(rule.when).toBeTruthy();
    expect(rule.citation).toBeTruthy();
    expect(rule.id).toBeTruthy();
  });

  it('says how much of the book each rule claims, and calls it fixture data', async () => {
    const set = await getRules(repo, 'fr2052a_product_id', READ_ONLY);
    expect(set.coverage!.fixture).toBe('nominal');
    expect(set.coverage!.total).toBeGreaterThan(100);
    expect(set.rules.some((r) => (r.fixtureRecords ?? 0) > 0)).toBe(true);
  });

  it('resolves the version in force on a date', async () => {
    // Rule sets are effective-dated, and "what were the rules then" is the
    // question the whole bitemporal design exists to answer.
    const set = await getRules(repo, 'fr2052a_product_id', READ_ONLY);
    expect(set.effective.from).toBeTruthy();
    await expect(getRules(repo, 'fr2052a_product_id', READ_ONLY, '1999-01-01'))
      .rejects.toThrow(/in force/);
  });

  it('resolves a rate table with its citations', async () => {
    const set = await getParameters(repo, 'lcr_outflow_rates');
    expect(set.valueField).toBe('outflow_rate');
    expect(set.entries.length).toBeGreaterThan(10);
    expect(set.entries[0].citation).toBeTruthy();
  });
});

describe('what depends on what', () => {
  it('answers the question behind most edits: what breaks', async () => {
    const l = await getLineage(repo, 'fr2052a_product_id');
    expect(l.usedBy).toContain('fr2052a_outflows');
    expect(l.stage).toBe('prepare');
  });

  it('returns the whole chain, source table to monitor', async () => {
    const l = await getLineage(repo, 'fr2052a_submission');
    expect(l.chain.map((s) => s.label)).toEqual([
      'alm.fct_2052a_positions',
      'fr2052a_outflows',
      'fr2052a_submission',
      'reg.fr2052a_daily',
      'fr2052a_variance',
    ]);
    expect(l.writes).toBe('reg.fr2052a_daily');
  });

  it('returns every edge when asked for no document in particular', async () => {
    expect((await getLineageGraph(repo)).nodes).toHaveLength(8);
  });
});

describe('compiling', () => {
  it('emits every pipeline target', async () => {
    for (const target of ['sql', 'polars', 'pyspark'] as const) {
      const plan = await compile(repo, 'fr2052a_submission', target);
      expect(plan.text.length, target).toBeGreaterThan(200);
    }
  });

  it('emits a governed view, so a dashboard need not retype the definition', async () => {
    const plan = await compile(repo, 'liquidity_pit', 'view');
    expect(plan.text).toContain('CREATE OR REPLACE VIEW');
    expect(plan.published).toContain('lcr_pct');
  });

  it('emits a dbt semantic model', async () => {
    const plan = await compile(repo, 'liquidity_pit', 'dbt');
    expect(plan.text).toContain('semantic_models:');
  });

  it('reports what it refused rather than dropping it silently', async () => {
    const plan = await compile(repo, 'liquidity_pit', 'view');
    expect(plan.issues.map((i) => i.measure)).toContain('lcr_vol_30d');
  });

  it('refuses a semantic target for something that is not a view', async () => {
    await expect(compile(repo, 'fr2052a_submission', 'view')).rejects.toThrow(/metrics_view/);
  });

  it('compiles a proposed body without saving it', async () => {
    const body = (await bodyOf('fr2052a_submission'))
      .replace('measures: [gross_outflow_balance, weighted_outflows_30d]',
        'measures: [gross_outflow_balance]');
    const plan = await compile(repo, 'fr2052a_submission', 'sql', body);
    expect(plan.published).toEqual(['gross_outflow_balance']);
    expect((await getArtifact(repo, 'fr2052a_submission')).revision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

describe('testing a rule set before writing it', () => {
  it('reports records, notional and what matched nothing', async () => {
    const r = await testRules(repo, 'fr2052a_product_id', READ_ONLY);
    expect(r.total).toBeGreaterThan(100);
    expect(r.matched + r.unmatched).toBe(r.total);
    expect(r.rules.length).toBeGreaterThan(10);
  });

  it('shows the effect of a proposed edit without saving it', async () => {
    const before = await testRules(repo, 'fr2052a_product_id', READ_ONLY);
    const proposed = (await bodyOf('fr2052a_product_id'))
      .replace("segment = 'RETAIL'", "segment = 'NOBODY'");
    const after = await testRules(repo, 'fr2052a_product_id', READ_ONLY, proposed);

    expect(after.rules.find((x) => x.records === 0)).toBeTruthy();
    expect(after.dead.length).toBeGreaterThan(before.dead.length);
    // And the registry is untouched.
    expect((await getArtifact(repo, 'fr2052a_product_id')).revision).toBe(1);
  });

  it('separates a dead rule from a pre-empted one, which need different fixes', async () => {
    const r = await testRules(repo, 'fr2052a_product_id', READ_ONLY);
    expect(r).toHaveProperty('dead');
    expect(r).toHaveProperty('preemptedBy');
  });

  it('previews what a report would file, and says when it truncated', async () => {
    const p = await previewReport(repo, 'fr2052a_submission', READ_ONLY);
    expect(p.rowCount).toBeGreaterThan(20);
    expect(p.rows.length).toBeLessThanOrEqual(200);
    expect(p.truncated).toBe(p.rowCount > 200);
    expect(p.measures).toContain('weighted_outflows_30d');
  });

  it('previews a report under unsaved edits to the chain', async () => {
    // The loop that makes this useful: change a rule, see the filed rows move,
    // without anything being written.
    const edited = (await bodyOf('fr2052a_product_id'))
      .replace("segment = 'RETAIL'", "segment = 'NOBODY'");
    const base = await previewReport(repo, 'fr2052a_submission', READ_ONLY);
    const after = await previewReport(repo, 'fr2052a_submission', READ_ONLY, {
      fr2052a_product_id: edited,
    });
    expect(after.rowCount).not.toBe(base.rowCount);
  });

  it('validates against the same catalogue a person is held to', async () => {
    const v = await validate(repo, 'liquidity_pit', await bodyOf('liquidity_pit'), READ_ONLY);
    expect(v.kind).toBe('metrics_view');
    expect(v.diagnostics.every((d) => d.line >= 1)).toBe(true);
  });

  it('reports a diagnostic line an agent can count to', async () => {
    // The catalogue is 0-based internally. An agent reading a file counts from
    // one, and an off-by-one in a governance tool is a bad look.
    const v = await validate(repo, 'liquidity_pit', await bodyOf('liquidity_pit'), READ_ONLY);
    if (v.diagnostics.length) expect(v.diagnostics[0].line).toBeGreaterThanOrEqual(1);
  });
});

describe('assessing a change before making it', () => {
  it('reports what a loosened threshold would silence', async () => {
    const body = (await bodyOf('fr2052a_variance')).replace('limit: 1000000', 'limit: 5000000');
    const r = await assessProposed(repo, 'fr2052a_variance', body, READ_ONLY);
    expect(r.needsReview).toBe(true);
    expect(r.findings[0].summary).toMatch(/Silences/);
  });

  it('says nothing about a change with no consequence', async () => {
    const body = `${await bodyOf('fr2052a_variance')}\n`;
    const r = await assessProposed(repo, 'fr2052a_variance', body, READ_ONLY);
    expect(r.findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Writing — the three gates
// ---------------------------------------------------------------------------

describe('the read-only default', () => {
  it('refuses to save at all, and says how to enable it', async () => {
    // An agent that can silently rewrite a governed rule set is not a feature
    // anybody should get by forgetting to turn it off.
    await expect(saveArtifact(repo, READ_ONLY, {
      name: 'liquidity_pit', body: await bodyOf('liquidity_pit'), message: 'x',
    })).rejects.toThrow(/read-only/);
  });

  it('is what the environment gives you unless asked otherwise', () => {
    expect(policyFromEnv({}).canWrite).toBe(false);
    expect(policyFromEnv({ KEEL_MCP_WRITE: 'true' }).canWrite).toBe(false);
    expect(policyFromEnv({ KEEL_MCP_WRITE: '1' }).canWrite).toBe(true);
  });

  it('takes the agent’s identity from the environment, never from an argument', () => {
    // An author field the caller can set to any string is not an attribution.
    expect(policyFromEnv({}).identity).toBe('mcp-agent');
    expect(policyFromEnv({ KEEL_MCP_IDENTITY: 'claude-ops' }).identity).toBe('claude-ops');
  });

  it('falls back to a real fixture rather than trusting the name given', () => {
    expect(policyFromEnv({ KEEL_MCP_FIXTURE: 'not-a-fixture' }).fixture).toBe('nominal');
    expect(policyFromEnv({ KEEL_MCP_FIXTURE: 'stress' }).fixture).toBe('stress');
  });
});

describe('errors block a save', () => {
  it('refuses a document a human would have been stopped from saving', async () => {
    // One standard. A looser set of checks for machine authors would be a way of
    // letting an agent commit what a person could not.
    const broken = (await bodyOf('liquidity_pit'))
      .replace('field: hqla_eligible_amount', 'field: no_such_column');
    await expect(saveArtifact(repo, WRITER, {
      name: 'liquidity_pit', body: broken, message: 'break it',
    })).rejects.toThrow(/refusing to save/);
  });

  it('names the first error, so the agent has somewhere to start', async () => {
    const broken = (await bodyOf('liquidity_pit'))
      .replace('field: hqla_eligible_amount', 'field: no_such_column');
    await expect(saveArtifact(repo, WRITER, {
      name: 'liquidity_pit', body: broken, message: 'break it',
    })).rejects.toThrow(/KEEL\d+/);
  });
});

describe('a weakening must be acknowledged', () => {
  const loosened = async () =>
    (await bodyOf('fr2052a_variance')).replace('limit: 1000000', 'limit: 5000000');

  it('refuses, and says what would be silenced', async () => {
    // The maker-checker seam in miniature: not a veto, but a step that cannot
    // happen by accident.
    await expect(saveArtifact(repo, WRITER, {
      name: 'fr2052a_variance', body: await loosened(), message: 'reduce noise',
    })).rejects.toThrow(/weakens something/);
    await expect(saveArtifact(repo, WRITER, {
      name: 'fr2052a_variance', body: await loosened(), message: 'reduce noise',
    })).rejects.toThrow(/Silences 3 breaches/);
    expect((await getArtifact(repo, 'fr2052a_variance')).revision).toBe(1);
  });

  it('goes through once acknowledged', async () => {
    const out = await saveArtifact(repo, WRITER, {
      name: 'fr2052a_variance',
      body: await loosened(),
      message: 'reduce noise',
      acknowledgeReview: true,
    });
    expect(out.revision).toBe(2);
    expect(out.impact.needsReview).toBe(true);
  });

  it('records the acknowledgement against the revision', async () => {
    // The whole point. Six months later, the question is not "was this allowed"
    // but "who decided, and did they know what it did" — so the finding lands in
    // the history rather than only in the agent's transcript.
    await saveArtifact(repo, WRITER, {
      name: 'fr2052a_variance',
      body: await loosened(),
      message: 'reduce noise',
      acknowledgeReview: true,
    });
    const [latest] = await getHistory(repo, 'fr2052a_variance');
    expect(latest.message).toMatch(/review acknowledged/);
    expect(latest.message).toMatch(/Silences 3 breaches/);
    expect(latest.author).toBe('agent-x');
  });

  it('does not ask for acknowledgement when a change only tightens', async () => {
    const tightened = (await bodyOf('fr2052a_variance')).replace('limit: 1000000', 'limit: 100000');
    const out = await saveArtifact(repo, WRITER, {
      name: 'fr2052a_variance', body: tightened, message: 'tighten',
    });
    expect(out.revision).toBe(2);
    expect(out.impact.needsReview).toBe(false);
  });
});

describe('concurrency', () => {
  it('reports a stale write as a conflict rather than a failure', async () => {
    // "Someone else saved first" is something an agent can act on by re-reading.
    const body = `${await bodyOf('liquidity_pit')}\n# one`;
    await saveArtifact(repo, WRITER, { name: 'liquidity_pit', body, message: 'first' });

    await expect(saveArtifact(repo, WRITER, {
      name: 'liquidity_pit',
      body: `${await bodyOf('liquidity_pit')}\n# two`,
      message: 'second',
      expectedRevision: 1,
    })).rejects.toThrow(/conflict/);
  });

  it('accepts a save that knows the current revision', async () => {
    const current = await getArtifact(repo, 'liquidity_pit');
    const out = await saveArtifact(repo, WRITER, {
      name: 'liquidity_pit',
      body: `${current.body}\n# ok`,
      message: 'informed',
      expectedRevision: current.revision,
    });
    expect(out.revision).toBe(2);
  });
});
