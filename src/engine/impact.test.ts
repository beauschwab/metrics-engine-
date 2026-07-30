/**
 * What an edit will do, before it is saved.
 *
 * The assertions here are about *execution*. A heuristic over YAML — "the number
 * went up, so this is a loosening" — would pass a test written the same way it
 * was implemented and be wrong in both directions: it would flag a widened band
 * that changes nothing and miss a narrowed window that silences a series. So
 * every case below is stated in terms of what stops happening to real data.
 */

import { describe, expect, it } from 'vitest';
import { assessChange, type Finding } from './impact';
import { INITIAL_DOCS } from './documents';

const docs = INITIAL_DOCS as unknown as Record<string, string>;

const assess = (file: string, after: string) =>
  assessChange(file, docs[file], after, docs);

const of = (fs: Finding[], consequence: string) =>
  fs.filter((f) => f.consequence === consequence);

// ---------------------------------------------------------------------------

describe('a control that stops firing', () => {
  it('reports a raised limit by what it silences, not by the number', () => {
    // `HARD-USD` at $1mm breaches three times on the shipped fixture. At $5mm it
    // breaches none — and that, rather than "5,000,000 > 1,000,000", is the
    // finding worth putting in front of somebody.
    const r = assess('fr2052a_variance', docs.fr2052a_variance.replace('limit: 1000000', 'limit: 5000000'));
    const control = of(r.findings, 'control');

    expect(r.needsReview).toBe(true);
    expect(control[0].direction).toBe('weakens');
    expect(control[0].summary).toMatch(/Silences 3 breaches/);
    expect(control[0].silenced).toHaveLength(3);
  });

  it('catches a widened sigma, which no diff makes obvious', () => {
    // `sigma: 3.0` → `6.0` is one character. It is also the band that judges
    // every rollup with enough history, and it doubles.
    const r = assess('fr2052a_variance', docs.fr2052a_variance.replace('sigma: 3.0', 'sigma: 6.0'));
    expect(r.needsReview).toBe(true);
    expect(of(r.findings, 'control')[0].summary).toMatch(/Silences \d+ breaches across \d+ series/);
  });

  it('distinguishes the threshold that was weakened from the rollup', () => {
    // The defect this test exists for: the first cut identified a breach by
    // rollup and date alone, so raising HARD-USD reported *nothing* — those
    // same three key-days were still breaching under SIGMA-30. The rollup
    // looked watched while the specific control had gone.
    const r = assess('fr2052a_variance', docs.fr2052a_variance.replace('limit: 1000000', 'limit: 5000000'));
    expect(of(r.findings, 'control')).not.toHaveLength(0);
  });

  it('names a threshold that was deleted, even if it never fired', () => {
    // A removed threshold raises no breaches by definition, so its absence is
    // invisible in any alert count.
    const cut = docs.fr2052a_variance.slice(0, docs.fr2052a_variance.indexOf('  - id: SIGMA-30'));
    const r = assess('fr2052a_variance', cut);
    expect(r.needsReview).toBe(true);
    expect(r.findings.some((f) => /Removes \d+ thresholds?: /.test(f.summary))).toBe(true);
  });

  it('reports a coarsened grain as rollups that stop being compared', () => {
    const r = assess(
      'fr2052a_variance',
      docs.fr2052a_variance.replace('grain: [product_id, entity_id]', 'grain: [product_id]'),
    );
    expect(r.findings.some((f) => /Watches \d+ fewer rollups/.test(f.summary))).toBe(true);
  });
});

describe('a control that fires more', () => {
  it('is reported, but does not ask for review', () => {
    // Tightening is a decision whose results are visible the next morning. It
    // is worth mentioning — alert volume is a real cost — and it is not the
    // thing a second pair of eyes exists for.
    const r = assess('fr2052a_variance', docs.fr2052a_variance.replace('limit: 1000000', 'limit: 100000'));
    const control = of(r.findings, 'control');
    expect(control[0].direction).toBe('strengthens');
    expect(control[0].summary).toMatch(/Raises \d+ new breaches/);
    expect(r.needsReview).toBe(false);
  });
});

describe('what is not a change', () => {
  it('says nothing about an identical document', () => {
    expect(assess('fr2052a_variance', docs.fr2052a_variance).findings).toEqual([]);
  });

  it('says nothing about a reworded description', () => {
    // Prose moving must not produce a governance finding, or the finding stops
    // being read — which is how a real one gets missed.
    const r = assess('fr2052a_variance', docs.fr2052a_variance.replace('is escalated.', 'is escalated today.'));
    expect(r.findings).toEqual([]);
    expect(r.needsReview).toBe(false);
  });

  it('says nothing it cannot compute, rather than guessing', () => {
    expect(assess('fr2052a_variance', 'this: is not: a monitor: at all').findings).toEqual([]);
  });
});

describe('restating history', () => {
  it('measures a rule change in records and money', () => {
    const r = assess(
      'fr2052a_product_id',
      docs.fr2052a_product_id.replace("segment = 'RETAIL'", "segment = 'NOPE'"),
    );
    const restatement = of(r.findings, 'restatement')[0];
    expect(restatement.summary).toMatch(/Reclassifies \d+ records/);
    expect(restatement.movedRecords).toBeGreaterThan(0);
    expect(restatement.movedNotional).toBeGreaterThan(0);
  });

  it('prompts the decision the effective dating exists to record', () => {
    // The mechanism was already there. What was missing was anything asking the
    // author whether they meant to restate.
    const r = assess(
      'fr2052a_product_id',
      docs.fr2052a_product_id.replace("segment = 'RETAIL'", "segment = 'NOPE'"),
    );
    expect(of(r.findings, 'restatement')[0].detail.join(' ')).toMatch(/effective\.from/);
  });

  it('treats records falling out of every rule as a weakening', () => {
    // Moving between buckets is a change. Matching nothing at all is a hole,
    // and the compiler emits no `ELSE`, so it stays visible rather than being
    // swept into a bucket nobody chose.
    const broken = docs.fr2052a_product_id.replace(/emit: O\.D\.1/, 'emit: O.D.1\n    x: 1');
    expect(assess('fr2052a_product_id', broken)).toBeTruthy();
  });
});

describe('what gets filed', () => {
  it('flags a grain that loses a dimension', () => {
    const r = assess(
      'fr2052a_submission',
      docs.fr2052a_submission.replace(
        'grouping: [product_id, maturity_bucket, currency, entity_id]',
        'grouping: [product_id, maturity_bucket, entity_id]',
      ),
    );
    const filed = of(r.findings, 'filed')[0];
    expect(filed.direction).toBe('weakens');
    expect(filed.detail.join(' ')).toMatch(/No longer split by: currency/);
    // The knock-on nobody thinks of: a monitor at the old grain is now watching
    // series that do not exist.
    expect(filed.detail.join(' ')).toMatch(/monitor/);
  });

  it('flags a measure that stops being filed', () => {
    const r = assess(
      'fr2052a_submission',
      docs.fr2052a_submission.replace(
        'measures: [gross_outflow_balance, weighted_outflows_30d]',
        'measures: [gross_outflow_balance]',
      ),
    );
    expect(of(r.findings, 'filed').some((f) => /weighted_outflows_30d/.test(f.summary))).toBe(true);
  });

  it('flags a redirected sink, which fails quietly rather than loudly', () => {
    const r = assess(
      'fr2052a_submission',
      docs.fr2052a_submission.replace('table: reg.fr2052a_daily', 'table: reg.fr2052a_daily_v2'),
    );
    expect(of(r.findings, 'filed')[0].detail.join(' ')).toMatch(/go stale rather than fail/);
  });
});

describe('governed assumptions', () => {
  it('reports a rate that moved, and what it moved from', () => {
    const r = assess('lcr_outflow_rates', docs.lcr_outflow_rates.replace('outflow_rate: 0.03', 'outflow_rate: 0.25'));
    const a = of(r.findings, 'assumption')[0];
    expect(a.summary).toMatch(/Changes 1 governed rate/);
    expect(a.detail[0]).toBe('O.D.1: 0.03 → 0.25');
  });

  it('singles out a rate that moved while its citation did not', () => {
    // A governed assumption changing under an unchanged authority is the case a
    // reviewer is actually looking for.
    const drift = assess('lcr_outflow_rates', docs.lcr_outflow_rates.replace('outflow_rate: 0.03', 'outflow_rate: 0.25'));
    expect(drift.needsReview).toBe(true);
    expect(of(drift.findings, 'assumption')[0].direction).toBe('weakens');

    const cited = assess(
      'lcr_outflow_rates',
      docs.lcr_outflow_rates.replace(
        'outflow_rate: 0.03\n    citation: 12 CFR 249.32(a)(1)',
        'outflow_rate: 0.25\n    citation: 12 CFR 249.32(a)(2)',
      ),
    );
    expect(cited.needsReview).toBe(false);
    expect(of(cited.findings, 'assumption')[0].direction).toBe('changes');
  });
});

describe('ordering', () => {
  it('puts the control finding first, because silence outranks size', () => {
    const r = assess(
      'fr2052a_variance',
      docs.fr2052a_variance
        .replace('limit: 1000000', 'limit: 5000000')
        .replace('limit: 12.0', 'limit: 1.0'),
    );
    expect(r.findings.length).toBeGreaterThan(1);
    expect(r.findings[0].consequence).toBe('control');
    expect(r.findings[0].direction).toBe('weakens');
  });
});
