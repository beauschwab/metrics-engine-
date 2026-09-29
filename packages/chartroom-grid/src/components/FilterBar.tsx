/**
 * The filter bar: what the view is filtered by, as chips a reader can
 * remove one at a time (ADR-73). One chip per column filter — the set's
 * values or the range's ends — and one per quick-filter token, so a query
 * typed as `desk:Credit notional>1bn` reads back as two chips and losing one
 * keeps the other. Nothing here is state of its own: every chip is a reading
 * of the view, and removing one writes the view the way the popover or the
 * search box would.
 */

import { FunnelX, X } from 'lucide-react';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import { formatValue, type ColumnMeta } from '../grid/meta';
import { describeSearchToken, parseSearch, withoutSearchToken, type SearchToken } from '../grid/search';
import type { ViewState } from '../grid/viewState';
import type { GridSchema } from '../grid/schema';
import { TREASURY_SCHEMA } from '../data/treasury';
import { useSchema } from './SchemaContext';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const SHOWN_VALUES = 3;

/** One line for a column filter: the set's values, or the range's ends. */
export function describeColumnFilter(id: string, value: unknown, known?: ColumnMeta, schema: GridSchema = TREASURY_SCHEMA): string {
  const meta = known ?? schema.columns[id];
  if (!meta) return String(value);
  if (meta.kind === 'dimension') {
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    if (values.length === 0) return 'none';
    const head = values.slice(0, SHOWN_VALUES).join(', ');
    return values.length > SHOWN_VALUES ? `${head} +${values.length - SHOWN_VALUES}` : head;
  }
  const [lo, hi] = Array.isArray(value) ? (value as [unknown, unknown]) : [value, value];
  const parts: string[] = [];
  if (typeof lo === 'number') parts.push(`≥ ${formatValue(lo, meta)}`);
  if (typeof hi === 'number') parts.push(`≤ ${formatValue(hi, meta)}`);
  return parts.join(' ');
}

export function FilterBar({ table, view }: { table: TreasuryTable; view: ViewState }) {
  const schema = useSchema();
  const search = parseSearch(view.globalFilter, schema);
  if (view.columnFilters.length === 0 && search.tokens.length === 0) return null;

  const removeToken = (token: SearchToken) => table.setGlobalFilter(withoutSearchToken(view.globalFilter, token.raw));

  return (
    <div data-slot="filter-bar" className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1 text-xs">
      <span className="text-faint">Filtered by</span>
      {view.columnFilters.map((f) => {
        const meta = table.getColumn(f.id)?.columnDef.meta ?? schema.columns[f.id];
        const label = meta?.label ?? f.id;
        return (
          <Chip
            key={`col:${f.id}`}
            slot="filter-chip"
            data-column={f.id}
            label={`${label}: ${describeColumnFilter(f.id, f.value, meta, schema)}`}
            removeLabel={`Remove ${label} filter`}
            onRemove={() => table.getColumn(f.id)?.setFilterValue(undefined)}
          />
        );
      })}
      {search.tokens.map((token) => (
        <Chip
          key={`tok:${token.raw}`}
          slot="search-chip"
          data-token={token.raw}
          data-kind={token.kind}
          label={describeSearchToken(token, schema)}
          title={token.kind === 'unknown' ? token.reason : undefined}
          className={token.kind === 'unknown' ? 'line-through decoration-destructive' : undefined}
          removeLabel={`Remove ${token.raw} from the search`}
          onRemove={() => removeToken(token)}
        />
      ))}
      <Button variant="ghost" size="xs" aria-label="Clear all filters" onClick={() => { table.resetColumnFilters(true); table.setGlobalFilter(''); }}>
        <FunnelX /> Clear all
      </Button>
    </div>
  );
}

function Chip({
  slot, label, removeLabel, onRemove, className, title, ...rest
}: {
  slot: string; label: string; removeLabel: string; onRemove: () => void; className?: string; title?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <Badge variant="secondary" data-slot={slot} title={title} className="gap-1 pr-1 pl-2 font-normal" {...rest}>
      <span className={cn('max-w-64 truncate', className)}>{label}</span>
      <button
        type="button"
        data-slot={`${slot}-remove`}
        aria-label={removeLabel}
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}
