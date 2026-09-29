/**
 * Master-detail: the whole position under its row, every field through the
 * same formatter as its cell. A fixed height, because the body is windowed
 * and never measures (ADR-66).
 */

import { useSchema } from './SchemaContext';
import { formatValue } from '../grid/meta';
import type { GridRecord } from '../grid/schema';

export function DetailPanel({ position }: { position: GridRecord }) {
  const schema = useSchema();
  return (
    <dl data-slot="detail-panel" className="grid w-full grid-cols-5 gap-x-4 gap-y-1.5 px-8 py-2 text-[11px] leading-tight">
      {schema.order.map((id) => {
        const meta = schema.columns[id]!;
        return (
          <div key={id} className="flex min-w-0 flex-col">
            <dt className="text-[9.5px] font-semibold tracking-[0.06em] uppercase text-faint">{meta.label}</dt>
            <dd className={meta.kind === 'measure' ? 'tabular-nums' : 'truncate'}>{formatValue(position[id], meta)}</dd>
          </div>
        );
      })}
    </dl>
  );
}
