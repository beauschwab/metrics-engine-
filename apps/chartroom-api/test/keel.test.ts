/**
 * Contract derivation against the real shipped documents — the spec's own
 * instruction: test against true contract shapes, not synthetic ones.
 */

import { describe, expect, it } from 'vitest';
import { denominatorOf, deriveContracts, fetchRegistryState, unitOf } from '../src/keel';

describe('unitOf', () => {
  it('reads the engine format vocabulary', () => {
    expect(unitOf('currency_usd')).toEqual({ unit: 'USD', precision: 0 });
    expect(unitOf('currency_usd_mm')).toEqual({ unit: 'USD', precision: 0 });
    expect(unitOf('percent_1dp')).toEqual({ unit: 'percent', precision: 1 });
    expect(unitOf('percent_2dp')).toEqual({ unit: 'percent', precision: 2 });
    expect(unitOf('number')).toEqual({ unit: 'number', precision: 0 });
  });
});

describe('denominatorOf', () => {
  it('reads the shapes governed ratios actually take', () => {
    expect(denominatorOf('hqla_total / net_cash_outflows_30d')).toBe('net_cash_outflows_30d');
    expect(denominatorOf('100 * hqla_total / nullif(net_cash_outflows_30d, 0)'))
      .toBe('net_cash_outflows_30d');
    expect(denominatorOf('a + b')).toBeNull();
  });
});

describe('deriveContracts over the shipped workspace', () => {
  it('derives the LCR contract with unit, precision and denominator lineage', async () => {
    const state = await fetchRegistryState();
    const { byRef, contracts } = deriveContracts(state);

    const lcr = contracts.find((c) => c.measure === 'lcr_pct');
    expect(lcr).toBeTruthy();
    expect(lcr!.unit).toBe('percent');
    expect(lcr!.precision).toBe(1);
    expect(lcr!.denominator_of).toBe('net_cash_outflows_30d');
    expect(lcr!.allowed_aggregations).toEqual([]); // a ratio does not re-aggregate
    expect(byRef.get(lcr!.ref)).toBe(lcr);

    const hqla = contracts.find((c) => c.measure === 'hqla_total');
    expect(hqla!.unit).toBe('USD');
    expect(hqla!.allowed_aggregations).toEqual(['sum']);
  });

  it('derives dims from derived rows — a classification column is bindable', async () => {
    const state = await fetchRegistryState();
    const { contracts } = deriveContracts(state);

    const outflow = contracts.find((c) => c.doc === 'fr2052a_outflows');
    expect(outflow).toBeTruthy();
    const dimNames = outflow!.dims.map((d) => d.name);
    // Source columns…
    expect(dimNames).toContain('entity_id');
    // …and columns that only exist after the row stage ran.
    expect(dimNames).toContain('maturity_bucket');
    expect(dimNames).toContain('product_id');

    const bucket = outflow!.dims.find((d) => d.name === 'maturity_bucket');
    expect(bucket!.ordinal).toBe(true);

    const entity = outflow!.dims.find((d) => d.name === 'entity_id')!;
    expect(entity.type).toBe('categorical');
    expect(entity.values!.length).toBeGreaterThan(1);
  });

  it('without a production channel, everything is draft — governance is not assumed', async () => {
    const state = await fetchRegistryState();
    // Unit tests run with no registry (or one with no promotions): either way
    // nothing here may claim approval it cannot trace to a channel.
    if (state.production.size === 0) {
      const { contracts } = deriveContracts(state);
      expect(contracts.every((c) => c.status === 'draft')).toBe(true);
    }
  });
});
