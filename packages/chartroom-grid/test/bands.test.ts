/**
 * Header bands (ADR-75): a band is a contiguous run of visible columns that
 * share a family name and a pinning side, sized to their widths.
 */

import { describe, expect, it } from 'vitest';
import { headerBands, hasBands, type BandColumn } from '../src/grid/bands';
import { COLUMN_META, COLUMN_ORDER } from '../src/grid/columns';

const col = (id: string, band: string | undefined, size = 10, pinned: BandColumn['pinned'] = false): BandColumn => ({ id, band, size, pinned });

describe('headerBands', () => {
  it('runs contiguous columns of one family together and sums their widths', () => {
    const bands = headerBands([col('select', undefined, 24), col('desk', 'Book', 92), col('book', 'Book', 68), col('ccy', 'Instrument', 60), col('dv01', 'Risk', 104), col('cs01', 'Risk', 104)]);
    expect(bands.map((b) => [b.band, b.columns, b.size])).toEqual([
      [null, ['select'], 24],
      ['Book', ['desk', 'book'], 160],
      ['Instrument', ['ccy'], 60],
      ['Risk', ['dv01', 'cs01'], 208],
    ]);
  });

  it('splits a family at a pinning boundary and never merges the bandless', () => {
    const bands = headerBands([col('dv01', 'Risk', 104, 'start'), col('desk', 'Book', 92), col('cs01', 'Risk', 104), col('a', undefined), col('b', undefined)]);
    expect(bands.map((b) => [b.band, b.columns, b.pinned])).toEqual([
      ['Risk', ['dv01'], 'start'],
      ['Book', ['desk'], false],
      ['Risk', ['cs01'], false],
      [null, ['a'], false],
      [null, ['b'], false],
    ]);
    expect(hasBands([col('a', undefined)])).toBe(false);
  });

  it('every declared column names a family, so the row is always worth drawing', () => {
    expect(COLUMN_ORDER.every((id) => !!COLUMN_META[id].band)).toBe(true);
    const families = new Set(COLUMN_ORDER.map((id) => COLUMN_META[id].band));
    expect([...families]).toEqual(['Book', 'Instrument', 'Trade', 'Exposure', 'Risk', 'Return']);
  });
});
