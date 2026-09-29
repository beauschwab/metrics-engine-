/**
 * Excel number formats, one per unit — the export's reading of the same
 * meta the cell formats from (ADR-29, ADR-68). A `pct` value is stored in
 * percent units (3.46 means 3.46%), so the format is a literal "%" suffix,
 * never Excel's `%` type, which would multiply by a hundred. `mm` keeps the
 * raw dollars in the cell and scales by a million in the format (`,,`), so
 * a SUM in the sheet still adds dollars. Negatives go red only where the
 * meta says `negativeRed`.
 */

import type { ColumnMeta } from '../grid/meta';

const zeros = (dp: number) => (dp > 0 ? `.${'0'.repeat(dp)}` : '');

export function excelFormat(meta: ColumnMeta): string | undefined {
  if (meta.kind !== 'measure') return undefined;
  const neg = (positive: string) => `${positive};${meta.negativeRed ? '[Red]' : ''}-${positive}`;
  switch (meta.unit) {
    case 'ccy':
      return neg(`"$"#,##0${zeros(meta.dp ?? 0)}`);
    case 'mm':
      return neg(`"$"#,##0${zeros(meta.dp ?? 1)},,"M"`);
    case 'pct':
      return `0${zeros(meta.dp ?? 2)}"%"`;
    case 'bps':
      return `0${zeros(meta.dp ?? 1)}" bps"`;
    case 'years':
      return `0${zeros(meta.dp ?? 2)}"y"`;
    case 'date':
      return undefined;
    default:
      return `#,##0${zeros(meta.dp ?? 0)}`;
  }
}
