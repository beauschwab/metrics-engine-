/**
 * The column header menu: sort, pin, group, hide — each item a feature API
 * writing the view (ADR-66). What appears is a reading of the column:
 * `getCanSort`, `getCanPin`, `getCanGroup`, `getCanHide`, all of which the
 * column def set from meta or, for the selection column, switched off.
 */

import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowDownUp, Columns3, EllipsisVertical, EyeOff, Hash, Highlighter, PanelLeft, PanelRight, PinOff, Rows3, Sigma, Trash2 } from 'lucide-react';
import type { Column } from '@tanstack/react-table';
import type { GridRecord } from '../grid/schema';
import { allowedAggs, allowedFormatKeysFor } from '../grid/columns';
import { useSchema } from './SchemaContext';
import type { Features } from '../grid/features';
import {
  AGG_LABELS, DECIMALS, NEGATIVES, NEGATIVE_LABELS, SCALES, SCALE_LABELS, type Agg, type ColumnFormat, type Negatives, type Scale,
} from '../grid/meta';
import { cn } from '../lib/utils';
import { HighlightRulesEditor } from './HighlightRulesEditor';
import { Button } from './ui/button';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from './ui/dropdown-menu';

export type GridColumn = Column<Features, GridRecord, unknown>;

export function HeaderMenu({
  column, className, onAggChange, onFormatChange, onRemoveComputed, onPivot,
}: {
  column: GridColumn;
  className?: string;
  /** Choose a measure's aggregation for the view (ADR-72); null restores the meta's. */
  onAggChange?: (columnId: string, agg: Agg | null) => void;
  /** Change how a measure reads (ADR-74): a patch of format keys, or null to restore the meta's. */
  onFormatChange?: (columnId: string, patch: ColumnFormat | null) => void;
  /** Drop a calculated column (ADR-79). */
  onRemoveComputed?: (columnId: string) => void;
  /** Pivot by this dimension, or stop (ADR-80). */
  onPivot?: (columnId: string | null) => void;
}) {
  const meta = column.columnDef.meta;
  const schema = useSchema();
  const label = meta?.label ?? column.id;
  const sorted = column.getIsSorted();
  const pinned = column.getIsPinned();
  // A calculated column's aggregation follows its operands (ADR-79): no choice to offer.
  const aggs = meta?.kind === 'measure' && !meta.computed ? allowedAggs(column.id, schema) : [];
  const currentAgg = typeof column.columnDef.aggregationFn === 'string' ? (column.columnDef.aggregationFn as Agg) : undefined;
  const formatKeys = allowedFormatKeysFor(meta);
  // The declared meta is the default; the column's meta is the view's reading.
  const declared = meta?.computed ? meta : schema.columns[column.id];
  const scale = meta?.scale ?? (meta?.unit === 'mm' ? 'm' : 'units');
  const dp = meta?.dp ?? (meta?.unit === 'pct' || meta?.unit === 'years' ? 2 : meta?.unit === 'bps' || scale !== 'units' ? 1 : 0);
  const formatted = !!declared && (['dp', 'scale', 'negatives', 'negativeRed', 'heatmap'] as const).some((k) => meta?.[k] !== declared[k]);
  const ruleCount = meta?.rules?.length ?? 0;
  const [rulesOpen, setRulesOpen] = useState(false);
  return (
    <Popover open={rulesOpen} onOpenChange={setRulesOpen}>
    <DropdownMenu>
      <PopoverAnchor asChild>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`${label} column menu`} className={cn('text-faint', className)} data-state={rulesOpen ? 'open' : undefined}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      </PopoverAnchor>
      <DropdownMenuContent align="end" className="w-48 text-xs" data-slot="header-menu" data-column={column.id}>
        <DropdownMenuLabel className="text-[10px] tracking-[0.06em] uppercase text-faint">{label}</DropdownMenuLabel>
        {column.getCanSort() && (
          <>
            <DropdownMenuItem onSelect={() => column.toggleSorting(false)} data-active={sorted === 'asc' || undefined}>
              <ArrowUp /> Sort ascending
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => column.toggleSorting(true)} data-active={sorted === 'desc' || undefined}>
              <ArrowDown /> Sort descending
            </DropdownMenuItem>
            {sorted && (
              <DropdownMenuItem onSelect={() => column.clearSorting()}>
                <ArrowDownUp /> Clear sort
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {column.getCanPin() && (
          <>
            {pinned !== 'start' && (
              <DropdownMenuItem onSelect={() => column.pin('start')}>
                <PanelLeft /> Pin to start
              </DropdownMenuItem>
            )}
            {pinned !== 'end' && (
              <DropdownMenuItem onSelect={() => column.pin('end')}>
                <PanelRight /> Pin to end
              </DropdownMenuItem>
            )}
            {pinned && (
              <DropdownMenuItem onSelect={() => column.pin(false)}>
                <PinOff /> Unpin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {aggs.length > 0 && onAggChange && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-slot="agg-menu">
                <Sigma className="mr-2 size-4" /> Aggregate as {currentAgg ? `· ${AGG_LABELS[currentAgg]}` : ''}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="text-xs" data-slot="agg-choices" data-column={column.id}>
                <DropdownMenuRadioGroup value={currentAgg ?? ''} onValueChange={(v) => onAggChange(column.id, v as Agg)}>
                  {aggs.map((a) => (
                    <DropdownMenuRadioItem key={a} value={a}>
                      {AGG_LABELS[a]}{a === meta?.agg ? ' (default)' : ''}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {currentAgg !== meta?.agg && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onAggChange(column.id, null)}>Restore default</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        {formatKeys.length > 0 && onFormatChange && meta && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-slot="format-menu">
                <Hash className="mr-2 size-4" /> Format{formatted ? ' · custom' : ''}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="text-xs" data-slot="format-choices" data-column={column.id}>
                <DropdownMenuLabel className="text-[10px] tracking-[0.06em] uppercase text-faint">Decimals</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(dp)} onValueChange={(v) => onFormatChange(column.id, { dp: Number(v) })}>
                  <div className="flex px-1" data-slot="format-decimals">
                    {DECIMALS.map((n) => (
                      <DropdownMenuRadioItem key={n} value={String(n)} className="flex-1 justify-center pl-2 [&>span:first-child]:hidden" aria-label={`${n} decimals`}>
                        {n}
                      </DropdownMenuRadioItem>
                    ))}
                  </div>
                </DropdownMenuRadioGroup>
                {formatKeys.includes('scale') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] tracking-[0.06em] uppercase text-faint">Read in</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={scale} onValueChange={(v) => onFormatChange(column.id, { scale: v as Scale })}>
                      {SCALES.map((s) => (
                        <DropdownMenuRadioItem key={s} value={s}>{SCALE_LABELS[s]}</DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] tracking-[0.06em] uppercase text-faint">Negatives</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={meta.negatives ?? 'minus'} onValueChange={(v) => onFormatChange(column.id, { negatives: v as Negatives })}>
                  {NEGATIVES.map((n) => (
                    <DropdownMenuRadioItem key={n} value={n} className="tabular-nums">{NEGATIVE_LABELS[n]}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuCheckboxItem checked={!!meta.negativeRed} onCheckedChange={(c) => onFormatChange(column.id, { negativeRed: !!c })}>
                  Red negatives
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={!!meta.heatmap} onCheckedChange={(c) => onFormatChange(column.id, { heatmap: !!c })}>
                  Heatmap
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {/* Opened after the menu has closed: a popover raised while
                    the menu's dismiss is still settling is dismissed with it. */}
                <DropdownMenuItem onSelect={() => { setTimeout(() => setRulesOpen(true), 0); }} data-slot="highlight-rules">
                  <Highlighter className="mr-2 size-4" /> Highlight rules{ruleCount ? ` · ${ruleCount}` : '…'}
                </DropdownMenuItem>
                {formatted && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onFormatChange(column.id, null)}>Restore default</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        {column.getCanGroup() && (
          <>
            {onPivot && (
              <DropdownMenuItem onSelect={() => onPivot(column.id)} data-slot="pivot-by">
                <Columns3 /> Pivot by {label}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => column.toggleGrouping()}>
              <Rows3 /> {column.getIsGrouped() ? 'Ungroup' : `Group by ${label}`}
            </DropdownMenuItem>
          </>
        )}
        {meta?.computed && onRemoveComputed && (
          <DropdownMenuItem onSelect={() => onRemoveComputed(column.id)} data-slot="remove-computed">
            <Trash2 /> Remove calculated column
          </DropdownMenuItem>
        )}
        {column.getCanHide() && (
          <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
            <EyeOff /> Hide column
          </DropdownMenuItem>
        )}
        {column.getCanResize() && (
          <DropdownMenuItem onSelect={() => column.resetSize()}>Reset width</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    {meta && onFormatChange && (
      <PopoverContent align="end" className="w-72 p-2 text-xs" data-slot="highlight-rules-editor" data-column={column.id} onOpenAutoFocus={(e) => e.preventDefault()}>
        <HighlightRulesEditor
          label={label}
          meta={meta}
          rules={meta.rules ?? []}
          onChange={(rules) => onFormatChange(column.id, { rules: rules.length ? rules : undefined })}
          onClose={() => setRulesOpen(false)}
        />
      </PopoverContent>
    )}
    </Popover>
  );
}
