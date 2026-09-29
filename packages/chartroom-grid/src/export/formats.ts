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

import type { ConditionalFormattingRule } from 'exceljs';
import type { ColumnMeta, HighlightRule } from '../grid/meta';

/** exceljs's names for a rule's comparison. */
const CELL_IS: Record<HighlightRule['op'], 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual' | 'equal' | 'notEqual'> = {
  '>': 'greaterThan', '>=': 'greaterThanOrEqual', '<': 'lessThan', '<=': 'lessThanOrEqual', '=': 'equal', '!=': 'notEqual',
};

/**
 * A highlight rule as an Excel conditional format (ADR-78): the same
 * comparison, the same emphasis — bold, a faint font, a tinted fill —
 * never a red or a green.
 */
export function excelRules(rules: readonly HighlightRule[] | undefined): ConditionalFormattingRule[] {
  // exceljs's declarations list four cellIs operators; the OOXML set it
  // writes verbatim has six, so the two "or equal" forms are cast through.
  return (rules ?? []).map((r, i) => ({
    type: 'cellIs' as const,
    operator: CELL_IS[r.op],
    formulae: [r.value],
    priority: i + 1,
    style:
      r.emphasis === 'strong' ? { font: { bold: true } }
      : r.emphasis === 'muted' ? { font: { color: { argb: 'FF8A8F98' } } }
      : { fill: { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb: 'FFDCE6F5' } } },
  })) as unknown as ConditionalFormattingRule[];
}

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
