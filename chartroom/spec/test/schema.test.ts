import { describe, expect, it } from 'vitest';
import { DashboardSpecSchema, parseMetricRef, parseSpec } from '../src/index';
import { baseSpec } from './fixtures';

describe('the schema is the strongest enforcement layer', () => {
  it('accepts the baseline dashboard', () => {
    const r = parseSpec(baseSpec());
    expect(r.ok).toBe(true);
  });

  it('rejects unknown keys everywhere — nothing is smuggled past review', () => {
    const s = baseSpec() as unknown as Record<string, unknown>;
    s.custom_html = '<script>alert(1)</script>';
    expect(parseSpec(s).ok).toBe(false);

    const s2 = baseSpec();
    (s2.widgets[0] as unknown as Record<string, unknown>).sql = 'select * from positions';
    expect(parseSpec(s2).ok).toBe(false);
  });

  it('has no color, palette or unit field to abuse', () => {
    const s = baseSpec();
    (s.widgets[0] as unknown as { format: unknown }).format = { color: '#ff0000' };
    expect(parseSpec(s).ok).toBe(false);
    (s.widgets[0] as unknown as { format: unknown }).format = { unit: 'bps' };
    expect(parseSpec(s).ok).toBe(false);
  });

  it('rejects duplicate widget ids', () => {
    const s = baseSpec();
    s.widgets[1] = { ...s.widgets[1], id: s.widgets[0].id };
    const r = parseSpec(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(' ')).toContain('duplicate widget id');
  });

  it('rejects an interaction naming a widget that does not exist', () => {
    const s = baseSpec();
    s.interactions = [{ cross_filter: { source: 'lcr-tile', dim: 'entity_id', targets: ['ghost'] } }];
    expect(parseSpec(s).ok).toBe(false);
  });

  it('rejects malformed metric refs and parses good ones', () => {
    const s = baseSpec();
    s.widgets[0].bind.metric = 'liquidity_pit.lcr_pct';
    expect(parseSpec(s).ok).toBe(false);

    expect(parseMetricRef('keel://liquidity_pit.lcr_pct@4')).toEqual({
      doc: 'liquidity_pit', measure: 'lcr_pct', version: 4,
    });
    expect(parseMetricRef('keel://nope')).toBeNull();
  });

  it('defaults context and interactions so consumers never null-check them', () => {
    const s = baseSpec() as unknown as Record<string, unknown>;
    delete s.context;
    delete s.interactions;
    const r = DashboardSpecSchema.parse(s);
    expect(r.context).toEqual({});
    expect(r.interactions).toEqual([]);
  });

  it('bounds the canvas: 12 columns is a literal, not a suggestion', () => {
    const s = baseSpec();
    (s.layout.grid as unknown as { cols: number }).cols = 16;
    expect(parseSpec(s).ok).toBe(false);
  });
});
