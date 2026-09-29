/**
 * Excel number formats, one per unit — the export's reading of the same
 * meta the cell formats from (ADR-29, ADR-68). A `pct` value is stored in
 * percent units (3.46 means 3.46%), so the format is a literal "%" suffix,
 * never Excel's `%` type, which would multiply by a hundred. `mm` keeps the
 * raw dollars in the cell and scales by a million in the format (`,,`), so
 * a SUM in the sheet still adds dollars; a reader's scale (ADR-74) is the
 * same trick with one, two or three commas. Negatives go red only where
 * the meta says `negativeRed`, and in parentheses where it says so.
 */

import type { ColumnMeta } from '../grid/meta';

const zeros = (dp: number) => (dp > 0 ? `.${'0'.repeat(dp)}` : '');

const SCALE_FMT = { units: '', k: ',"K"', m: ',,"M"', bn: ',,,"B"' } as const;

export function excelFormat(meta: ColumnMeta): string | undefined {
  if (meta.kind !== 'measure') return undefined;
  const neg = (positive: string) => {
    const red = meta.negativeRed ? '[Red]' : '';
    return `${positive};${red}${meta.negatives === 'parens' ? `(${positive})` : `-${positive}`}`;
  };
  switch (meta.unit) {
    case 'ccy':
    case 'mm': {
      const scale = meta.scale ?? (meta.unit === 'mm' ? 'm' : 'units');
      return neg(`"$"#,##0${zeros(meta.dp ?? (scale === 'units' ? 0 : 1))}${SCALE_FMT[scale]}`);
    }
    case 'pct':
      return meta.negatives === 'parens' ? neg(`0${zeros(meta.dp ?? 2)}"%"`) : `0${zeros(meta.dp ?? 2)}"%"`;
    case 'bps':
      return meta.negatives === 'parens' ? neg(`0${zeros(meta.dp ?? 1)}" bps"`) : `0${zeros(meta.dp ?? 1)}" bps"`;
    case 'years':
      return `0${zeros(meta.dp ?? 2)}"y"`;
    case 'date':
      return undefined;
    default:
      return neg(`#,##0${zeros(meta.dp ?? 0)}`);
  }
}
