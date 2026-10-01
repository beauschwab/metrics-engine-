/**
 * Cell renderers — one per kind of reading, all driven by column meta.
 *
 * A measure cell is a formatted number in tabular figures, right-aligned,
 * flagged `data-negative` and coloured with the breach text token when its
 * meta asks for it. Heatmap and threshold badges arrive in Phase 3 behind
 * the same meta flags — TODO(grid-phase-3).
 */

import type { ColumnMeta } from '../grid/meta';
import { alignOf, formatValue, matchRule, showsNegative } from '../grid/meta';
import { cn } from '../lib/utils';

export function ValueCell({ value, meta }: { value: unknown; meta: ColumnMeta }) {
  const negative = meta.negativeRed && showsNegative(value, meta);
  // A highlight rule earns emphasis, never a semantic colour (ADR-78).
  const rule = matchRule(meta.rules, value);
  return (
    <span
      data-slot="value"
      data-negative={negative || undefined}
      data-emphasis={rule?.emphasis}
      className={cn(
        alignOf(meta) === 'right' && 'tabular-nums',
        negative && 'text-breach-text',
        rule?.emphasis === 'accent' && '-mx-1 rounded-sm bg-selected px-1',
        rule?.emphasis === 'strong' && 'font-semibold',
        rule?.emphasis === 'muted' && 'text-faint',
      )}
    >
      {formatValue(value, meta)}
    </span>
  );
}
