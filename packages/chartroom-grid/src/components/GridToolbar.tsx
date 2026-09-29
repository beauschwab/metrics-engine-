/**
 * The bar above the table: the row-groups drop zone, the quick filter, the
 * density switch, the export, and the sidebar toggle. The quick filter is
 * the table's global filter — the view's `globalFilter`, proven headlessly
 * in Phase 2 — debounced so fifty thousand rows are not re-filtered per
 * keystroke (ADR-68).
 */

import { useEffect, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Download, FunnelX, PanelRight, Rows2, Rows4, Search } from 'lucide-react';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import type { ViewState } from '../grid/viewState';
import type { Density } from './GridTable';
import { GroupByDropZone } from './GroupByDropZone';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function GridToolbar({
  table, view, sidebarOpen, onToggleSidebar, density, onToggleDensity, onExport, exporting,
}: {
  table: TreasuryTable;
  view: ViewState;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  density: Density;
  onToggleDensity: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const [quick, setQuick] = useState(view.globalFilter);
  useEffect(() => {
    if (quick === view.globalFilter) return;
    const t = setTimeout(() => table.setGlobalFilter(quick), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view's value is the target, not a trigger
  }, [quick, table]);
  useEffect(() => { setQuick(view.globalFilter); }, [view.globalFilter]);

  const filtering = view.columnFilters.length > 0 || view.globalFilter !== '';
  const grouping = view.grouping.length > 0;

  return (
    <div data-slot="grid-toolbar" className="flex items-center gap-2 border-b border-border bg-card px-2 py-1.5">
      <GroupByDropZone table={table} grouping={view.grouping} />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Quick filter"
          aria-label="Quick filter"
          data-slot="quick-filter"
          className="h-7 w-44 pl-7 text-xs"
        />
      </div>
      {filtering && (
        <Button variant="ghost" size="xs" aria-label="Clear all filters" onClick={() => { table.resetColumnFilters(true); table.setGlobalFilter(''); }}>
          <FunnelX /> Clear
        </Button>
      )}
      {grouping && (
        <>
          <Button variant="ghost" size="icon-xs" aria-label="Expand all groups" onClick={() => table.toggleAllRowsExpanded(true)}><ChevronsUpDown /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="Collapse all groups" onClick={() => table.toggleAllRowsExpanded(false)}><ChevronsDownUp /></Button>
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
