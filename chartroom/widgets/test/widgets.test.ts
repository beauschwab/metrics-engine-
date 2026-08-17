/**
 * The widget package's checkable halves: the catalog validates, geometry is
 * correct arithmetic, formatting matches the engine, and every contract's
 * type ref has a component (and vice versa). Rendering itself is verified in
 * the studio's e2e against the real bundle — a jsdom snapshot of an SVG path
 * asserts nothing a human would recognise.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RULE_IDS } from 'chartroom-spec';
import { fmt } from '../../../src/engine/format';
import { CATALOG } from '../src/contracts';
import { COMPONENTS } from '../src/index';
import { formatDelta, formatValue } from '../src/format';
import { barOrder, linePath, ticks, yExtent, yPos } from '../src/scale';

describe('the catalog', () => {
  it('validates as data — a malformed entry fails CI, not a 6pm lint run', () => {
    const Contract = z.strictObject({
      widget: z.string().regex(/^[a-z][a-z0-9-]*$/),
      version: z.number().int().positive(),
      family: z.enum([
        'kpi', 'timeseries', 'bar', 'table', 'grid', 'part_to_whole',
        'waterfall', 'heatmap', 'annotation',
      ]),
      accepts: z.strictObject({
        requires_time_dim: z.boolean().optional(),
        max_series: z.number().int().positive().optional(),
        categorical_dims: z.strictObject({ min: z.number(), max: z.number() }).optional(),
        supports: z.array(z.enum(['bands', 'compare', 'window', 'sort', 'max_cells', 'filters'])),
      }),
      guide_rules: z.array(z.string().regex(/^[A-Z]+-\d\d$/)),
      description: z.string().min(20),
    });
    for (const c of CATALOG) expect(() => Contract.parse(c)).not.toThrow();
  });

  it('ships the Phase-1 five and the Phase-9 seven, each with a component, and no strays', () => {
    const refs = CATALOG.map((c) => `${c.widget}@${c.version}`).sort();
    expect(refs).toEqual([
      'annotation@1', 'bar@1', 'bullet@1', 'delta-table@1', 'distribution@1',
      'heatmap@1', 'kpi-tile@1', 'perspective-grid@1', 'small-multiples@1',
      'stacked-area@1', 'timeseries@1', 'waterfall@1',
    ]);
    expect(Object.keys(COMPONENTS).sort()).toEqual(refs);
  });

  it('cites only rules the linter can actually emit', () => {
    for (const c of CATALOG) {
      for (const r of c.guide_rules) {
        expect(RULE_IDS as readonly string[], `${c.widget}@${c.version}`).toContain(r);
      }
    }
  });
});

describe('formatting matches the engine', () => {
  it('same outputs as src/engine/format.ts for every shipped format', () => {
    const cases: Array<[number, string]> = [
      [284_120_000, 'currency_usd'], [-41_222_870, 'currency_usd'],
      [284_120_000, 'currency_usd_mm'], [98.34, 'percent_1dp'], [1.2345, 'percent_2dp'],
      [0.0123, 'bps'], [1234.6, 'number'], [NaN, 'currency_usd'],
    ];
    for (const [v, f] of cases) {
      expect(formatValue(v, f), `${v} as ${f}`).toBe(fmt(v, f));
    }
  });

  it('honours the constrained decimals override for percents only', () => {
    expect(formatValue(98.346, 'percent_1dp', 2)).toBe('98.35%');
    expect(formatValue(1_000_000, 'currency_usd', 2)).toBe('$1,000,000');
  });

  it('says deltas in points for percents, currency otherwise', () => {
    expect(formatDelta(98.3, 97.1, 'percent_1dp')).toBe('+1.2pp');
    expect(formatDelta(90, 100, 'currency_usd')).toBe('-$10');
  });
});

describe('geometry', () => {
  it('currency extents include zero; ratio extents do not', () => {
    expect(yExtent([100, 200], 'currency_usd').min).toBe(0);
    expect(yExtent([98, 103], 'percent_1dp').min).toBeGreaterThan(0);
  });

  it('maps values into pixel space with the axis inverted', () => {
    const e = { min: 0, max: 100 };
    expect(yPos(0, e, 200)).toBe(200);
    expect(yPos(100, e, 200)).toBe(0);
  });

  it('a NaN breaks the line rather than drawing through it', () => {
    const d = linePath([1, NaN, 3], { min: 0, max: 4 }, 100, 100);
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it('ticks sit strictly inside the extent', () => {
    for (const t of ticks({ min: 0, max: 100 })) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(100);
    }
  });

  it('barOrder sorts by value unless the dim is ordinal', () => {
    const rows = [{ value: 1 }, { value: 3 }, { value: 2 }];
    expect(barOrder(rows, 'value').map((r) => r.value)).toEqual([3, 2, 1]);
    expect(barOrder(rows, 'dim').map((r) => r.value)).toEqual([1, 3, 2]);
    expect(rows.map((r) => r.value), 'input untouched').toEqual([1, 3, 2]);
  });
});
