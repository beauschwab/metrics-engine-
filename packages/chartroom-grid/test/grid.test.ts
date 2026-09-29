/**
 * Phase 0's checkable claims: the format registry says what a number is, the
 * mock is deterministic on its seed, and meta travels through the table so a
 * cell renders from its own column's declaration and nothing else; and the
 * theme names no colour of its own (ADR-65). Rendering itself is verified in
 * the studio's e2e against the real bundle.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { constructTable, tableFeatures, type ColumnDef } from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import { formatValue as catalogFormat } from 'chartroom-widgets/format';
import { COLUMN_META, COLUMN_ORDER, columns } from '../src/grid/columns';
import { features } from '../src/grid/features';
import { MISSING, formatValue, type ColumnMeta } from '../src/grid/meta';
import { generatePositions, type Position } from '../src/data/mock';

const measure = (unit: ColumnMeta['unit'], dp?: number): ColumnMeta =>
  ({ label: 'x', kind: 'measure', unit, dp });

describe('the format registry', () => {
  it('renders each unit the way its readers say it', () => {
    expect(formatValue(1234567, measure('ccy'))).toBe('$1,234,567');
    expect(formatValue(-1234567, measure('ccy'))).toBe('-$1,234,567');
    expect(formatValue(1234.5, measure('ccy', 2))).toBe('$1,234.50');
    expect(formatValue(4.123e6, measure('mm'))).toBe('$4.1M');
    expect(formatValue(4.123e6, measure('mm', 2))).toBe('$4.12M');
    expect(formatValue(-2.5e6, measure('mm'))).toBe('-$2.5M');
    expect(formatValue(3.456, measure('pct'))).toBe('3.46%');
    expect(formatValue(3.456, measure('pct', 1))).toBe('3.5%');
    expect(formatValue(12.34, measure('bps'))).toBe('12.3 bps');
    expect(formatValue(3.25, measure('years'))).toBe('3.25y');
    expect(formatValue('2026-09-28', measure('date'))).toBe('2026-09-28');
    expect(formatValue(1234.5678, measure(undefined, 1))).toBe('1,234.6');
  });

  it('says the catalog’s number for the units the catalog has', () => {
    // ADR-29: the deck formats through the catalog's formatValue; the grid
    // must not disagree with either for a currency or a percent.
    for (const v of [0, 17, -3.5e5, 8.25e8, 1.134e9]) {
      expect(formatValue(v, measure('ccy'))).toBe(catalogFormat(v, 'currency_usd'));
      expect(formatValue(v, measure('mm'))).toBe(catalogFormat(v, 'currency_usd_mm'));
      expect(formatValue(v, measure('pct', 1))).toBe(catalogFormat(v, 'percent_1dp'));
    }
  });

  it('renders the missing dash, never NaN or an empty cell', () => {
    for (const v of [null, undefined, Number.NaN]) {
      expect(formatValue(v, measure('ccy'))).toBe(MISSING);
      expect(formatValue(v, measure('pct'))).toBe(MISSING);
      expect(formatValue(v, { label: 'x', kind: 'dimension' })).toBe(MISSING);
    }
  });
});

describe('the mock book', () => {
  it('is deterministic on its seed', () => {
    const a = generatePositions(50, 7);
    const b = generatePositions(50, 7);
    expect(a).toEqual(b);
    expect(generatePositions(50, 8)).not.toEqual(a);
  });

  it('keeps its measures related the way a book’s are', () => {
    const rows = generatePositions(2000);
    expect(new Set(rows.map((r) => r.tradeId)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.notional).toBeGreaterThanOrEqual(1e6);
      expect(r.notional).toBeLessThanOrEqual(5e9);
      expect(Math.abs(r.mtm)).toBeLessThanOrEqual(r.notional * 0.02);
      // CS01 only where there is credit to be sensitive to.
      if (!['Bond', 'CDS'].includes(r.product)) expect(r.cs01).toBe(0);
    }
  });
});

describe('column meta drives the table', () => {
  // `constructTable` has no reactivity default, and the shared registry cannot
  // carry one — `useTable` injects React's render-phase bindings only when the
  // slot is empty. So the headless registry differs from `features` by exactly
  // that slot, which no column definition references; `ColumnDef` is invariant
  // in its registry type, hence the cast.
  const headless = tableFeatures({ ...features, coreReactivityFeature: storeReactivityBindings() });
  type Headless = typeof headless;
  const data = generatePositions(25);
  const table = constructTable<Headless, Position>({
    features: headless,
    columns: columns as unknown as ColumnDef<Headless, Position, unknown>[],
    data,
    getRowId: (r) => r.tradeId,
  });

  it('declares every field once, in display order', () => {
    expect(table.getAllLeafColumns().map((c) => c.id)).toEqual(COLUMN_ORDER);
    expect(new Set(COLUMN_ORDER)).toEqual(new Set(Object.keys(COLUMN_META)));
  });

  it('every cell carries the meta its column declared', () => {
    for (const row of table.getRowModel().rows) {
      for (const cell of row.getAllCells()) {
        const meta = cell.column.columnDef.meta;
        expect(meta).toBe(COLUMN_META[cell.column.id as keyof Position]);
        // The renderer formats from this meta and this value; assert the pair
        // agrees with the registry rather than snapshotting strings.
        expect(formatValue(cell.getValue(), meta!)).toBe(
          formatValue(data.find((p) => p.tradeId === row.id)![cell.column.id as keyof Position], meta!),
        );
      }
    }
  });

  it('only groupable dimensions can group; only measures aggregate', () => {
    for (const col of table.getAllLeafColumns()) {
      const meta = COLUMN_META[col.id as keyof Position];
      expect(col.getCanGroup()).toBe(meta.kind === 'dimension' && !!meta.groupable);
      if (meta.kind === 'dimension') expect(meta.agg).toBeUndefined();
      if (meta.agg === 'wavg') expect(meta.weightBy).toBe('notional');
    }
  });
});

describe('the theme is Aperture Risk by reference (ADR-48, ADR-65)', () => {
  const SRC = join(__dirname, '..', 'src');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
    });

  it('declares no colour of its own — every chromatic is a token by reference', () => {
    const css = readFileSync(join(SRC, 'theme.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgb|hsl|oklch|oklab)a?\(/i);
  });

  it('declares no bare variable — shadcn’s names are Aperture’s, and a `--accent` here turns the brand grey', () => {
    const css = readFileSync(join(SRC, 'theme.css'), 'utf8');
    const declared = [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((v) => !/^--(color|radius)-/.test(v))).toEqual([]);
    expect(css).not.toMatch(/:root\s*\{/);
  });

  it('withdraws Tailwind’s default palette so a component cannot name a colour beside the system', () => {
    const css = readFileSync(join(SRC, 'theme.css'), 'utf8');
    expect(css).toMatch(/--color-\*:\s*initial/);
    // With the palette withdrawn such a class compiles to nothing, so the
    // cell would silently lose its colour; catch it at the source instead.
    const palette = /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?\b/;
    const hits = walk(SRC).filter((f) => palette.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
