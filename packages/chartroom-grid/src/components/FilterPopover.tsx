/**
 * The column filter, in two shapes the meta decides: a set filter for a
 * dimension — the column's faceted values with their counts, searchable,
 * writing `arrHas` — and a number filter for a measure — an inclusive range
 * with open ends, writing `inNumberRange`. Both were proven headlessly in
 * Phase 2 before this UI existed (ADR-67, ADR-68). The facet counts come
 * from `getFacetedUniqueValues()`, which honours every other filter and
 * ignores this column's own, so the list never hides the value a reader
 * just unticked. The set filter's All / None / Invert, and a value's Only /
 * Exclude, are Excel's hand on the list (ADR-73): each writes the same
 * `arrHas` list, and an empty list means none.
 */

import { useEffect, useMemo, useState } from 'react';
import { Funnel, FunnelX } from 'lucide-react';
import type { Column } from '@tanstack/react-table';
import type { GridRecord } from '../grid/schema';
import type { Features } from '../grid/features';
import { formatValue } from '../grid/meta';
import { compareByOrder } from '../grid/ordinal';
import { useFacets } from './FacetContext';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

type GridColumn = Column<Features, GridRecord, unknown>;

export function FilterPopover({ column, className }: { column: GridColumn; className?: string }) {
  const meta = column.columnDef.meta;
  if (!meta) return null;
  const active = column.getIsFiltered();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Filter ${meta.label}`}
          data-active={active || undefined}
          className={cn('text-faint', active && 'text-primary', className)}
        >
          <Funnel />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2 text-xs" data-slot="filter-popover" data-column={column.id}>
        {meta.kind === 'dimension' ? <SetFilter column={column} /> : <RangeFilter column={column} />}
      </PopoverContent>
    </Popover>
  );
}

function SetFilter({ column }: { column: GridColumn }) {
  const [search, setSearch] = useState('');
  const facets = column.getFacetedUniqueValues();
  // Over a served answer the rows the grid holds are a window or engine-made
  // groups, so the list comes from the source, under the other filters,
  // without counts; otherwise it is the client's facets, with them.
  const { values: served } = useFacets();
  const [remote, setRemote] = useState<string[] | null>(null);
  useEffect(() => {
    if (!served) return;
    let live = true;
    void served(column.id).then((v) => { if (live) setRemote(v); });
    return () => { live = false; };
  }, [served, column.id]);
  // The list reads in the dimension's own order where it has one (ADR-84), else alphabetically.
  const order = column.columnDef.meta?.order;
  const values = useMemo(() => {
    const cmp = order ? compareByOrder(order) : (a: string, b: string) => a.localeCompare(b);
    const listed: Array<{ value: string; count?: number }> = served
      ? (remote ?? []).map((v) => ({ value: v }))
      : [...facets.entries()].map(([v, n]) => ({ value: String(v), count: n as number }));
    return listed.sort((a, b) => cmp(a.value, b.value));
  }, [facets, order, served, remote]);
  const selected = column.getFilterValue() as string[] | undefined;
  const isOn = (v: string) => !selected || selected.includes(v);
  const shown = search ? values.filter((x) => x.value.toLowerCase().includes(search.toLowerCase())) : values;
  const all = values.map((x) => x.value);
  const current = selected ?? all;

  // Everything chosen is no filter at all: the view stays clean. Nothing
  // chosen is a filter that keeps no row, and stays as the empty list.
  const write = (next: string[]) => column.setFilterValue(next.length === all.length && all.every((v) => next.includes(v)) ? undefined : next);
  const toggle = (v: string) => write(current.includes(v) ? current.filter((x) => x !== v) : [...current, v]);
  const invert = () => write(all.filter((v) => !current.includes(v)));
  const only = (v: string) => write([v]);
  const exclude = (v: string) => write(current.filter((x) => x !== v));

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search values"
        aria-label={`Search ${column.columnDef.meta?.label} values`}
        className="h-7 text-xs"
      />
      <div className="flex items-center justify-between text-faint">
        <span>{current.length === all.length ? `${values.length.toLocaleString('en-US')} values` : `${current.length.toLocaleString('en-US')} of ${values.length.toLocaleString('en-US')}`}</span>
        <div className="flex gap-0.5" data-slot="set-filter-actions">
          {/* Never disabled: a button that disables under the pointer drops
              focus to the body, and the popover reads that as a dismissal. */}
          <Button variant="ghost" size="xs" onClick={() => column.setFilterValue(undefined)} aria-pressed={!selected}>
            <FunnelX /> All
          </Button>
          <Button variant="ghost" size="xs" onClick={() => write([])} aria-pressed={current.length === 0}>
            None
          </Button>
          <Button variant="ghost" size="xs" onClick={invert}>
            Invert
          </Button>
          <Button variant="ghost" size="xs" onClick={() => write(shown.map((x) => x.value))}>
            Only shown
          </Button>
        </div>
      </div>
      <ul className="max-h-56 overflow-auto" data-slot="set-filter-values">
        {shown.map(({ value, count }) => (
          <li key={value} className="group flex h-6 items-center gap-2 px-1" data-value={value}>
            <Checkbox id={`${column.id}-${value}`} checked={isOn(value)} onCheckedChange={() => toggle(value)} aria-label={value} />
            <label htmlFor={`${column.id}-${value}`} className="min-w-0 flex-1 truncate">{value}</label>
            <span className="hidden gap-0.5 group-focus-within:flex group-hover:flex">
              <button type="button" className="rounded-sm px-1 text-faint hover:bg-muted hover:text-foreground" aria-label={`Only ${value}`} onClick={() => only(value)}>only</button>
              <button type="button" className="rounded-sm px-1 text-faint hover:bg-muted hover:text-foreground" aria-label={`Exclude ${value}`} onClick={() => exclude(value)}>exclude</button>
            </span>
            {count !== undefined && <span className="tabular-nums text-faint">{count.toLocaleString('en-US')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RangeFilter({ column }: { column: GridColumn }) {
  const meta = column.columnDef.meta!;
  const current = (column.getFilterValue() as [number | null, number | null] | undefined) ?? [null, null];
  const [min, setMin] = useState(current[0] === null ? '' : String(current[0]));
  const [max, setMax] = useState(current[1] === null ? '' : String(current[1]));
  // The range hint is the rows the grid holds; over a served answer that is a window, not the answer, so it is not shown.
  const { served } = useFacets();
  const range = served ? undefined : column.getFacetedMinMaxValues();
  // An end that does not read as a finite number is an open end, never NaN in the view.
  const end = (text: string): number | null => {
    const n = text.trim() === '' ? Number.NaN : Number(text);
    return Number.isFinite(n) ? n : null;
  };
  const apply = () => {
    const lo = end(min);
    const hi = end(max);
    column.setFilterValue(lo === null && hi === null ? undefined : [lo, hi]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-faint">
        {range ? `${formatValue(range[0], meta)} to ${formatValue(range[1], meta)}` : served ? 'the source holds the range' : 'no range'}
      </div>
      <div className="flex items-center gap-1.5">
        <Input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" placeholder="min" aria-label={`${meta.label} minimum`} className="h-7 text-xs" />
        <span className="text-faint">to</span>
        <Input value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" placeholder="max" aria-label={`${meta.label} maximum`} className="h-7 text-xs" />
      </div>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={() => { setMin(''); setMax(''); column.setFilterValue(undefined); }} disabled={!column.getIsFiltered()}>
          <FunnelX /> Clear
        </Button>
        <Button size="xs" onClick={apply}>Apply</Button>
      </div>
    </div>
  );
}
