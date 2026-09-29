/**
 * The grid — the shell around the table: the row-groups bar, the columns
 * sidebar, the drag-and-drop context that joins them, and the seam to the
 * data.
 *
 * The component owns nothing the contract does not: rows come from the
 * source, the view is the state, and the table is the hook's. A drop on the
 * group zone is `column.toggleGrouping()`; a chip reordered is
 * `table.setGrouping()`; a sidebar item moved is `table.setColumnOrder()` —
 * every gesture is a feature API writing the view (ADR-66, ADR-67).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Position } from '../data/mock';
import type { DataSource } from '../data/source';
import { useTreasuryTable, type ViewUpdate } from '../grid/useTreasuryTable';
import { defaultView, type ViewState } from '../grid/viewState';
import { ColumnsSidebar, SIDE_PREFIX, orderedLeafColumns } from './ColumnsSidebar';
import { GridTable, COLUMN_PREFIX } from './GridTable';
import { GridToolbar } from './GridToolbar';
import { GROUP_PREFIX, GROUP_ZONE_ID } from './GroupByDropZone';
import { Badge } from './ui/badge';

export { ROW_HEIGHT } from './GridTable';

export interface TreasuryGridProps {
  source: DataSource<Position>;
  /** Control the view from outside (a saved view, the URL, an agent); omit and the grid keeps its own. */
  view?: ViewState;
  onViewChange?: (update: ViewUpdate) => void;
  defaultSidebarOpen?: boolean;
}

const idOf = (dnd: string) => dnd.slice(dnd.indexOf(':') + 1);

// A header dragged over the zone lands where the pointer is; chips and
// sidebar items sort by the nearest centre.
const collision: CollisionDetection = (args) =>
  String(args.active.id).startsWith(COLUMN_PREFIX) ? pointerWithin(args) : closestCenter(args);

export function TreasuryGrid({ source, view: controlled, onViewChange, defaultSidebarOpen = false }: TreasuryGridProps) {
  const [ownView, setOwnView] = useState<ViewState>(defaultView);
  const view = controlled ?? ownView;
  const change = onViewChange ?? setOwnView;

  // The rows are asked for once per source. The in-memory source serves no
  // stage of the view, so a sort or a filter is the client's and needs no
  // second answer; when a source reports it serves one, the query must key
  // on that slice of the view too — TODO(grid-phase-5).
  const [rows, setRows] = useState<Position[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    void source.query(view).then((r) => { if (live) setRows(r.rows); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above
  }, [source]);

  const table = useTreasuryTable({ data: rows, view, onViewChange: change });
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);

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
      <div className="flex h-full min-h-0 flex-col" data-slot="treasury-grid" data-testid="treasury-grid-shell">
        <GridToolbar table={table} grouping={view.grouping} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {!rows ? (
              <div className="h-full animate-pulse rounded-sm bg-muted" data-slot="skeleton" />
            ) : !model.length ? (
              <div className="p-3 text-xs text-faint">no positions match</div>
            ) : (
              <GridTable table={table} />
            )}
          </div>
          {sidebarOpen && <ColumnsSidebar table={table} grouping={view.grouping} columnOrder={view.columnOrder} />}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragLabel ? <Badge variant="secondary" className="cursor-grabbing shadow-md">{dragLabel}</Badge> : null}
      </DragOverlay>
    </DndContext>
  );
}
