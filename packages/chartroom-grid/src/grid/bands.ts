/**
 * Header bands (ADR-75): a row above the column headers that names the
 * family each run of columns belongs to — Book, Instrument, Risk — read
 * from `meta.band`. A band is a reading of the visible columns, never a
 * node in the column tree: the leaf columns keep their ids, their order,
 * their pinning and their drag handles, and a band is whatever contiguous
 * run of them shares a name. Hide a column and its band narrows; pin one
 * away from its family and the band splits, because a sticky cell cannot
 * span into the scrolling middle.
 */

export interface BandColumn {
  id: string;
  band?: string;
  size: number;
  /** v9's logical pinning; a run never crosses a pinning boundary. */
  pinned: false | 'start' | 'end';
}

export interface HeaderBand {
  /** The band's name, or null for columns that belong to none. */
  band: string | null;
  /** The ids of the columns the band spans, in order. */
  columns: string[];
  /** The summed width of those columns. */
  size: number;
  pinned: false | 'start' | 'end';
}

/** Group visible leaf columns into contiguous runs sharing a band and a pinning side. */
export function headerBands(columns: readonly BandColumn[]): HeaderBand[] {
  const out: HeaderBand[] = [];
  for (const c of columns) {
    const band = c.band ?? null;
    const last = out[out.length - 1];
    if (last && last.band === band && last.pinned === c.pinned && band !== null) {
      last.columns.push(c.id);
      last.size += c.size;
    } else {
      out.push({ band, columns: [c.id], size: c.size, pinned: c.pinned });
    }
  }
  return out;
}

/** Whether a band row is worth drawing: at least one visible column names a band. */
export const hasBands = (columns: readonly BandColumn[]): boolean => columns.some((c) => !!c.band);
