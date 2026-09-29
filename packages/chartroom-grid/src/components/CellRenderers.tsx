/**
 * Cell renderers — one per kind of reading, all driven by column meta.
 *
 * A measure cell is a formatted number in tabular figures, right-aligned,
 * flagged `data-negative` when its meta asks for the breach colour. The
 * stylesheet decides what negative looks like; the renderer only says that it
 * is. Heatmap and threshold badges arrive in Phase 3 behind the same meta
 * flags — TODO(grid-phase-3).
 */

import type { ColumnMeta } from '../grid/meta';
import { alignOf, formatValue } from '../grid/meta';

export function ValueCell({ value, meta }: { value: unknown; meta: ColumnMeta }) {
  const negative = meta.negativeRed && typeof value === 'number' && value < 0;
  return (
    <span
      className={alignOf(meta) === 'right' ? 'cr-grid-value tnum' : 'cr-grid-value'}
      data-negative={negative || undefined}
    >
      {formatValue(value, meta)}
    </span>
  );
}
