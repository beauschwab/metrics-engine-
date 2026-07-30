/**
 * What each document is for, and what feeds what.
 *
 * The assertions worth having here are about *derivation*: every stage and every
 * edge has to fall out of fields the documents already carry, so that adding a
 * report or deleting one moves things without anybody editing a list. A
 * hardcoded taxonomy would pass a snapshot test and go stale the first week.
 */

import { describe, expect, it } from 'vitest';
import {
  STAGE_ORDER, buildLineage, chainFor, groupByStage, type Stage,
} from './lineage';
import { INITIAL_DOCS, VIEW_FILES } from './documents';

const docs = INITIAL_DOCS as unknown as Record<string, string>;
const L = buildLineage(docs);
const stageOf = (file: string): Stage | undefined => L.byFile[file]?.stage;

// ---------------------------------------------------------------------------

describe('what a document is for', () => {
  it('separates a pipeline view from a dashboard view, which share a kind', () => {
    // The collision this whole module exists for. Both are `kind: metrics_view`,
    // both wore the same glyph, and they are opposite ends of the chain:
    // `fr2052a_outflows` classifies positions for a filing, `liquidity_pit`
    // holds the LCR ratio somebody reads.
    expect(L.byFile.fr2052a_outflows.kind).toBe('metrics_view');
    expect(L.byFile.liquidity_pit.kind).toBe('metrics_view');
    expect(stageOf('fr2052a_outflows')).toBe('prepare');
    expect(stageOf('liquidity_pit')).toBe('publish');
  });

  it('places every shipped document', () => {
    expect(stageOf('fr2052a_product_id')).toBe('prepare');
    expect(stageOf('lcr_outflow_rates')).toBe('prepare');
    expect(stageOf('fr2052a_submission')).toBe('file');
    expect(stageOf('irrbb_eve')).toBe('publish');
    expect(stageOf('fr2052a_variance')).toBe('watch');
    VIEW_FILES.forEach((f) => expect(STAGE_ORDER, f).toContain(stageOf(f)));
  });

  it('derives the view’s stage from whether anything files from it', () => {
    // Not a heuristic on the document's contents, and this is the proof: drop
    // the report and the same unedited view becomes something read directly.
    const { fr2052a_submission, ...rest } = docs;
    expect(fr2052a_submission).toBeTruthy();
    expect(buildLineage(rest).byFile.fr2052a_outflows.stage).toBe('publish');
  });

  it('moves a view to prepare as soon as a report files from it', () => {
    const report = [
      'version: 1', 'kind: report', 'name: pit_daily', 'view: liquidity_pit',
      'grouping: [entity_id]', 'measures: [hqla_total]',
    ].join('\n');
    expect(buildLineage({ ...docs, pit_daily: report }).byFile.liquidity_pit.stage)
      .toBe('prepare');
  });
});

describe('where it runs', () => {
  it('names the table a report writes, and how it is partitioned', () => {
    expect(L.byFile.fr2052a_submission.runtime).toContain('reg.fr2052a_daily');
    expect(L.byFile.fr2052a_submission.runtimeDetail).toContain('as_of_date');
    expect(L.byFile.fr2052a_submission.writes).toBe('reg.fr2052a_daily');
  });

  it('says a rule set writes nothing, because the compiler inlines it', () => {
    // "Runs nightly" would be a comfortable lie: `compileReport` folds the rule
    // set into the view into the report, and only the report writes.
    expect(L.byFile.fr2052a_product_id.runtime).toMatch(/writes nothing/);
    expect(L.byFile.fr2052a_product_id.writes).toBe('');
    expect(L.byFile.fr2052a_outflows.writes).toBe('');
  });

  it('distinguishes query time from pipeline time in words, not in tags', () => {
    expect(L.byFile.liquidity_pit.runtime).toMatch(/query time/i);
    expect(L.byFile.fr2052a_outflows.runtime).toMatch(/folded into the report/i);
  });

  it('keeps the short label short enough to sit beside the chain', () => {
    // It shares a 30px row with the chain, and the chain is the content. The
    // full sentence is still available — it moves to the tooltip rather than
    // being lost.
    L.nodes.forEach((n) => {
      expect(n.runtime.length, `${n.file}: ${n.runtime}`).toBeLessThanOrEqual(36);
      expect(n.runtimeDetail.length, n.file).toBeGreaterThan(n.runtime.length);
    });
  });

  it('carries the governance tier and owner it was given', () => {
    expect(L.byFile.fr2052a_submission.tier).toBe(1);
    expect(L.byFile.fr2052a_variance.tier).toBe(2);
    expect(L.byFile.fr2052a_submission.owner).toBe('Liquidity Regulatory Reporting');
  });
});

describe('the chain', () => {
  const labels = (name: string) => chainFor(L, name).steps.map((s) => s.label);

  it('runs source table → view → report → sink → monitor', () => {
    expect(labels('fr2052a_submission')).toEqual([
      'alm.fct_2052a_positions',
      'fr2052a_outflows',
      'fr2052a_submission',
      'reg.fr2052a_daily',
      'fr2052a_variance',
    ]);
  });

  it('is the same chain whichever document you open it from', () => {
    const from = ['fr2052a_outflows', 'fr2052a_submission', 'fr2052a_variance', 'lcr_outflow_rates'];
    from.forEach((d) => expect(labels(d), d).toEqual(labels('fr2052a_submission')));
  });

  it('marks where the open document sits', () => {
    expect(chainFor(L, 'fr2052a_outflows').at).toBe(1);
    expect(chainFor(L, 'fr2052a_submission').at).toBe(2);
    expect(chainFor(L, 'fr2052a_variance').at).toBe(4);
  });

  it('treats a rule set as an input to a step, not as a step', () => {
    // `positions → product_id → outflows` is not what runs. The rule set is
    // something a link is made of, and drawing it as a link would misdescribe
    // the pipeline to the person deciding whether an edit is safe.
    const c = chainFor(L, 'fr2052a_product_id');
    expect(c.via).toBe('input');
    expect(c.at).toBe(1);
    expect(c.steps[1].uses).toContain('fr2052a_product_id');
    expect(c.steps[1].uses).toContain('lcr_outflow_rates');
    expect(c.steps.map((s) => s.docs).flat()).not.toContain('fr2052a_product_id');
  });

  it('ends a published view where it actually ends', () => {
    // Two steps, and that is the finding rather than a thin result: nothing
    // files from `liquidity_pit`, so the LCR ratio is read straight off a
    // source table with no governed table between.
    const c = chainFor(L, 'liquidity_pit');
    expect(labels('liquidity_pit')).toEqual(['alm.fct_liquidity_position', 'liquidity_pit']);
    expect(c.via).toBe('spine');
    expect(c.at).toBe(1);
  });

  it('keeps parallel monitors in one position rather than making a longer line', () => {
    const second = [
      'version: 1', 'kind: variance_monitor', 'name: fr2052a_gross_variance',
      'report: fr2052a_submission', 'measure: gross_outflow_balance',
      'watch:', '  grain: [product_id]',
    ].join('\n');
    const c = chainFor(buildLineage({ ...docs, fr2052a_gross_variance: second }), 'fr2052a_submission');
    expect(c.steps).toHaveLength(5);
    expect(c.steps[4].label).toBe('2 monitors');
    expect(c.steps[4].docs).toHaveLength(2);
  });

  it('returns nothing rather than half a picture for an unknown document', () => {
    expect(chainFor(L, 'nope').steps).toEqual([]);
    expect(chainFor(L, 'nope').via).toBe('none');
  });
});

describe('grouping for the tree', () => {
  it('groups in reading order and drops what is empty', () => {
    const groups = groupByStage(L, VIEW_FILES);
    expect(groups.map((g) => g.stage)).toEqual(['prepare', 'file', 'publish', 'watch']);
    expect(groups.flatMap((g) => g.files).sort()).toEqual([...VIEW_FILES].sort());
  });

  it('keeps workspace order inside a group, so the tree does not reshuffle', () => {
    const prepare = groupByStage(L, VIEW_FILES).find((g) => g.stage === 'prepare')!;
    // Rules, then the rates they key, then the view that folds both in.
    expect(prepare.files).toEqual(['fr2052a_product_id', 'lcr_outflow_rates', 'fr2052a_outflows']);
  });

  it('omits a stage nobody has documents in', () => {
    const only = { liquidity_pit: docs.liquidity_pit };
    expect(groupByStage(buildLineage(only), ['liquidity_pit']).map((g) => g.stage))
      .toEqual(['publish']);
  });
});

describe('robustness', () => {
  it('ignores a document that will not parse rather than failing the panel', () => {
    // The diagnostics layer says far more about a broken document than a
    // half-drawn arrow could, and a tree that throws is a tree nobody can use
    // to navigate back to the thing they broke.
    const broken = buildLineage({ ...docs, junk: ':::not yaml:::' });
    expect(broken.byFile.fr2052a_submission.stage).toBe('file');
  });

  it('does not invent a step for a reference nothing defines', () => {
    const orphan = [
      'version: 1', 'kind: metrics_view', 'view: orphan', 'source: alm.x',
      'derivations:', '  - name: p', '    op: classify', '    using: nonexistent_rules',
    ].join('\n');
    const c = chainFor(buildLineage({ orphan }), 'orphan');
    expect(c.steps[1].uses).toEqual([]);
  });
});
