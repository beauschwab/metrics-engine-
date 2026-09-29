/**
 * The grid — the shell around the table: the toolbar, the columns sidebar,
 * the status bar, the context menu, the drag-and-drop context that joins
 * them, and the seam to the data.
 *
 * The component owns nothing the contract does not: rows come from the
 * source, the view is the state, and the table is the hook's. A drop on the
 * group zone is `column.toggleGrouping()`; a chip reordered is
 * `table.setGrouping()`; a sidebar item moved is `table.setColumnOrder()` —
 * every gesture is a feature API writing the view (ADR-66, ADR-67). What
 * the shell does keep is transient: which detail panels are open, the row
 * density, the cell under the pointer (ADR-68).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Position } from '../data/mock';
import type { DataSource, SourceDescription } from '../data/source';
import { useTreasuryTable, type ViewUpdate } from '../grid/useTreasuryTable';
import { defaultView, type ViewState } from '../grid/viewState';
import type { ViewStore } from '../views/store';
import { ColumnsSidebar, SIDE_PREFIX, orderedLeafColumns } from './ColumnsSidebar';
import { GridTable, COLUMN_PREFIX, type ContextTarget, type Density } from './GridTable';
import { GridToolbar } from './GridToolbar';
import { GROUP_PREFIX, GROUP_ZONE_ID } from './GroupByDropZone';
import { RowContextMenu } from './RowContextMenu';
import { StatusBar } from './StatusBar';
import { Badge } from './ui/badge';

export { ROW_HEIGHT, ROW_HEIGHTS, DETAIL_HEIGHT, type Density } from './GridTable';

export interface TreasuryGridProps {
  source: DataSource<Position>;
  /** Control the view from outside (a saved view, the URL, an agent); omit and the grid keeps its own. */
  view?: ViewState;
  onViewChange?: (update: ViewUpdate) => void;
  defaultSidebarOpen?: boolean;
  defaultDensity?: Density;
  /** Where saved views live; null hides saving but keeps reset and the link. */
  viewStore?: ViewStore | null;
}

const idOf = (dnd: string) => dnd.slice(dnd.indexOf(':') + 1);

// A header dragged over the zone lands where the pointer is; chips and
// sidebar items sort by the nearest centre.
const collision: CollisionDetection = (args) =>
  String(args.active.id).startsWith(COLUMN_PREFIX) ? pointerWithin(args) : closestCenter(args);

export function TreasuryGrid({
  source, view: controlled, onViewChange, defaultSidebarOpen = false, defaultDensity = 'compact', viewStore = null,
}: TreasuryGridProps) {
  const [ownView, setOwnView] = useState<ViewState>(defaultView);
  const view = controlled ?? ownView;
  const change = onViewChange ?? setOwnView;

  // The rows are asked for once per source. The in-memory source serves no
  // stage of the view, so a sort or a filter is the client's and needs no
  // second answer; when a source reports it serves one, the query must key
  // on that slice of the view too — TODO(grid-phase-5).
  const [rows, setRows] = useState<Position[] | null>(null);
  const [about, setAbout] = useState<SourceDescription | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    setAbout(null);
    void source.describe().then((d) => { if (live) setAbout(d); });
    void source.query(view).then((r) => { if (live) setRows(r.rows); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above
  }, [source]);

  const table = useTreasuryTable({ data: rows, view, onViewChange: change });
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const [density, setDensity] = useState<Density>(defaultDensity);
  const [detailOpen, setDetailOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggleDetail = useCallback((rowId: string) => {
    setDetailOpen((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);

  const [exporting, setExporting] = useState(false);
  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      // exceljs rides in only when a reader asks for a sheet.
      const { workbookBytes } = await import('../export/xlsx');
      const bytes = await workbookBytes(table, { title: about ? `${about.name} · as of ${about.asOf ?? '—'}` : undefined });
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(about?.name ?? 'positions').replace(/[^\w.-]+/g, '-')}-${about?.asOf ?? 'export'}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setExporting(false);
    }
  }, [table, about]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const onDragStart = useCallback((e: DragStartEvent) => {
    const id = idOf(String(e.active.id));
    setDragLabel(table.getColumn(id)?.columnDef.meta?.label ?? id);
  }, [table]);
  const onDragEnd = useCallback((e: DragEndEvent) => {
    setDragLabel(null);
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || active === over) return;
    if (active.startsWith(GROUP_PREFIX) && over.startsWith(GROUP_PREFIX)) {
      table.setGrouping((prev) => arrayMove(prev, prev.indexOf(idOf(active)), prev.indexOf(idOf(over))));
    } else if (over === GROUP_ZONE_ID || over.startsWith(GROUP_PREFIX)) {
      const column = table.getColumn(idOf(active));
      // The drop is refused unless the meta says groupable — the zone's
      // highlight is not a promise, `getCanGroup()` is the rule.
      if (column?.getCanGroup() && !column.getIsGrouped()) column.toggleGrouping();
    } else if (active.startsWith(SIDE_PREFIX) && over.startsWith(SIDE_PREFIX)) {
      const ids = orderedLeafColumns(table, view.columnOrder).map((c) => c.id);
      table.setColumnOrder(arrayMove(ids, ids.indexOf(idOf(active)), ids.indexOf(idOf(over))));
    }
  }, [table, view.columnOrder]);

  const model = table.getRowModel().rows;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragLabel(null)}
    >
      <div className="flex h-full min-h-0 flex-col" data-slot="treasury-grid" data-testid="treasury-grid-shell" data-density={density}>
        <GridToolbar
          table={table}
          view={view}
          viewStore={viewStore}
          onLoadView={(next) => change(() => next)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          density={density}
          onToggleDensity={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
          onExport={() => void onExport()}
          exporting={exporting}
        />
        <div className="flex min-h-0 flex-1">
          <RowContextMenu table={table} target={contextTarget} detailOpen={detailOpen} onToggleDetail={toggleDetail}>
            <div className="min-w-0 flex-1">
              {!rows ? (
                <div className="h-full animate-pulse rounded-sm bg-muted" data-slot="skeleton" />
              ) : !model.length ? (
                <div className="p-3 text-xs text-faint" data-slot="empty">no positions match</div>
              ) : (
                <GridTable
                  table={table}
                  density={density}
                  detailOpen={detailOpen}
                  onToggleDetail={toggleDetail}
                  onContextTarget={setContextTarget}
                />
              )}
            </div>
          </RowContextMenu>
          {sidebarOpen && <ColumnsSidebar table={table} grouping={view.grouping} columnOrder={view.columnOrder} />}
        </div>
        <StatusBar table={table} about={about} />
      </div>
      <DragOverlay dropAnimation={null}>
        {dragLabel ? <Badge variant="secondary" className="cursor-grabbing shadow-md">{dragLabel}</Badge> : null}
      </DragOverlay>
    </DndContext>
  );
}
