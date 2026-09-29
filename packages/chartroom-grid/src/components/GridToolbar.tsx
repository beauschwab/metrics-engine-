/**
 * The bar above the table: the row-groups drop zone, the quick filter, the
 * density switch, the export, and the sidebar toggle. The quick filter is
 * the table's global filter — the view's `globalFilter`, proven headlessly
 * in Phase 2 — debounced so fifty thousand rows are not re-filtered per
 * keystroke (ADR-68).
 */

import { useEffect, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Download, PanelRight, Redo2, Rows2, Rows4, Search, Undo2 } from 'lucide-react';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import type { ViewState } from '../grid/viewState';
import type { ViewStore } from '../views/store';
import type { Density } from './GridTable';
import { GroupByDropZone, PivotDropZone } from './GroupByDropZone';
import { ViewsMenu } from './ViewsMenu';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function GridToolbar({
  table, view, viewStore, onLoadView, sidebarOpen, onToggleSidebar, density, onToggleDensity, onExport, exporting, history, onPivot,
}: {
  table: TreasuryTable;
  view: ViewState;
  viewStore: ViewStore | null;
  onLoadView: (view: ViewState) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  density: Density;
  onToggleDensity: () => void;
  onExport: () => void;
  exporting: boolean;
  /** Undo and redo over the view (ADR-76): whether each is possible, and the actions. */
  history?: { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void };
  /** The pivot dimension (ADR-80) and the write that sets or clears it. */
  onPivot?: (column: string | null) => void;
}) {
  const [quick, setQuick] = useState(view.globalFilter);
  useEffect(() => {
    if (quick === view.globalFilter) return;
    const t = setTimeout(() => table.setGlobalFilter(quick), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view's value is the target, not a trigger
  }, [quick, table]);
  useEffect(() => { setQuick(view.globalFilter); }, [view.globalFilter]);

  const grouping = view.grouping.length > 0;

  return (
    <div data-slot="grid-toolbar" className="flex items-center gap-2 border-b border-border bg-card px-2 py-1.5">
      <GroupByDropZone table={table} grouping={view.grouping} />
      {onPivot && <PivotDropZone table={table} pivot={view.pivot.column} onPivot={onPivot} />}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Search · desk:Credit notional>1bn"
          aria-label="Quick filter"
          title="Words match any column. desk:Credit, ccy=EUR, entity!=WF-US on a dimension; notional>1bn, yield<=3.5 on a measure; quotes keep spaces."
          data-slot="quick-filter"
          className="h-7 w-60 pl-7 text-xs"
        />
      </div>
      {grouping && (
        <>
          <Button variant="ghost" size="icon-xs" aria-label="Expand all groups" onClick={() => table.toggleAllRowsExpanded(true)}><ChevronsUpDown /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="Collapse all groups" onClick={() => table.toggleAllRowsExpanded(false)}><ChevronsDownUp /></Button>
        </>
      )}
      {history && (
        <>
          <Button variant="ghost" size="icon-xs" aria-label="Undo view change" data-slot="undo" disabled={!history.canUndo} onClick={() => history.undo()}><Undo2 /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="Redo view change" data-slot="redo" disabled={!history.canRedo} onClick={() => history.redo()}><Redo2 /></Button>
        </>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
        aria-pressed={density === 'comfortable'}
        data-density={density}
        onClick={onToggleDensity}
      >
        {density === 'compact' ? <Rows2 /> : <Rows4 />}
      </Button>
      <ViewsMenu store={viewStore} view={view} onLoad={onLoadView} />
      <Button variant="ghost" size="xs" aria-label="Export to Excel" onClick={onExport} disabled={exporting}>
        <Download /> {exporting ? 'Exporting…' : 'Excel'}
      </Button>
      <Button
        variant={sidebarOpen ? 'secondary' : 'ghost'}
        size="xs"
        aria-pressed={sidebarOpen}
        aria-label={sidebarOpen ? 'Hide columns panel' : 'Show columns panel'}
        onClick={onToggleSidebar}
      >
        <PanelRight />
        Columns
      </Button>
    </div>
  );
}
