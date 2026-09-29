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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { schemaFromColumns, type GridRecord, type GridSchema } from '../grid/schema';
import { TREASURY_SCHEMA } from '../data/treasury';
import { SchemaContext } from './SchemaContext';
import type { DataSource, SourceDescription } from '../data/source';
import { isGroupNode } from '../data/sqlSource';
import { useTreasuryTable, type Applied, type GridRowData, type ViewUpdate } from '../grid/useTreasuryTable';
import type { GridRow } from './GroupCell';
import type { Agg, ColumnFormat } from '../grid/meta';
import type { ComputedColumn } from '../grid/computed';
import type { ChartOutcome } from '../grid/chart';
import { defaultView, type ViewState } from '../grid/viewState';
import type { ViewStore } from '../views/store';
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, undoHistory } from '../views/history';
import { ColumnsSidebar, SIDE_PREFIX, orderedLeafColumns } from './ColumnsSidebar';
import { GridTable, COLUMN_PREFIX, type ContextTarget, type Density } from './GridTable';
import { FilterBar } from './FilterBar';
import { GridToolbar } from './GridToolbar';
import { GROUP_PREFIX, GROUP_ZONE_ID, PIVOT_ZONE_ID } from './GroupByDropZone';
import { distinctValues } from '../grid/pivot';
import { RowContextMenu } from './RowContextMenu';
import { StatusBar } from './StatusBar';
import { Badge } from './ui/badge';

export { ROW_HEIGHT, ROW_HEIGHTS, DETAIL_HEIGHT, type Density } from './GridTable';

export interface TreasuryGridProps {
  source: DataSource<GridRecord>;
  /** Control the view from outside (a saved view, the URL, an agent); omit and the grid keeps its own. */
  view?: ViewState;
  onViewChange?: (update: ViewUpdate) => void;
  defaultSidebarOpen?: boolean;
  defaultDensity?: Density;
  /** Where saved views live; null hides saving but keeps reset and the link. */
  viewStore?: ViewStore | null;
  /** The host draws a chart of the selected block (ADR-81): the grid describes, the host renders. */
  onChart?: (outcome: ChartOutcome) => void;
}

const idOf = (dnd: string) => dnd.slice(dnd.indexOf(':') + 1);

// A header dragged over the zone lands where the pointer is; chips and
// sidebar items sort by the nearest centre.
const collision: CollisionDetection = (args) =>
  String(args.active.id).startsWith(COLUMN_PREFIX) ? pointerWithin(args) : closestCenter(args);

export function TreasuryGrid({
  source, view: controlled, onViewChange, defaultSidebarOpen = false, defaultDensity = 'compact', viewStore = null, onChart,
}: TreasuryGridProps) {
  const [ownView, setOwnView] = useState<ViewState>(defaultView);
  const view = controlled ?? ownView;
  const change = onViewChange ?? setOwnView;

  // Undo and redo (ADR-76): every view that arrives — from a feature, a
  // saved view, a link, an agent — is a step; undo hands the previous one
  // back through the same write. The stack lives here, not in the view.
  const history = useRef(createHistory(view));
  const [steps, setSteps] = useState({ canUndo: false, canRedo: false });
  useEffect(() => {
    history.current = pushHistory(history.current, view as unknown as Record<string, unknown>) as typeof history.current;
    const next = { canUndo: canUndo(history.current), canRedo: canRedo(history.current) };
    setSteps((prev) => (prev.canUndo === next.canUndo && prev.canRedo === next.canRedo ? prev : next));
  }, [view]);
  const undo = useCallback(() => {
    if (!canUndo(history.current)) return;
    history.current = undoHistory(history.current);
    const target = history.current.present;
    change(() => target);
  }, [change]);
  const redo = useCallback(() => {
    if (!canRedo(history.current)) return;
    history.current = redoHistory(history.current);
    const target = history.current.present;
    change(() => target);
  }, [change]);

  // The source describes itself once; the rows are asked for again only
  // when a slice the source *serves* changes (ADR-70). The in-memory source
  // serves nothing, so a sort or a filter is the client's and needs no
  // second answer; DuckDB or Dremio serve filter, sort and grouping, so
  // those slices re-query — debounced, since a resize handle or a keystroke
  // can move the view many times a second.
  const [about, setAbout] = useState<SourceDescription | null>(null);
  // The columns the source serves (ADR-82): the treasury book until the
  // description arrives, then whatever it describes.
  const schema = useMemo<GridSchema>(
    () => (about ? schemaFromColumns(about.columns, about.rowId ?? about.columns[0]?.id ?? '') : TREASURY_SCHEMA),
    [about],
  );
  useEffect(() => {
    let live = true;
    setAbout(null);
    void source.describe().then((d) => { if (live) setAbout(d); });
    return () => { live = false; };
  }, [source]);
  const serves = about?.serves;
  const servedKey = JSON.stringify({
    f: serves?.filter ? [view.columnFilters, view.globalFilter] : null,
    s: serves?.sort ? view.sorting : null,
    g: serves?.group ? view.grouping : null,
  });
  const [rows, setRows] = useState<GridRecord[] | null>(null);
  const [pending, setPending] = useState(false);
  const [children, setChildren] = useState<ReadonlyMap<string, GridRecord[]>>(() => new Map());
  // The table's manual modes follow what the source *serves*, not what the
  // last answer applied: between a served slice changing and the engine's
  // answer, the client row models must not group or sort the stale rows
  // themselves — the ids would be the client's, and the engine's nodes,
  // when they land, would not match what a reader had just expanded.
  const manual = useMemo<Applied | undefined>(
    () => (serves && (serves.filter || serves.sort || serves.group) ? { filter: serves.filter, sort: serves.sort, group: serves.group } : undefined),
    [serves],
  );
  useEffect(() => {
    if (!about) return;
    // Children fetched under the previous grouping are stale the moment a
    // served slice changes — dropped now, not when the debounced answer
    // lands, so a node expanded in the meantime keeps the children it just
    // fetched under the new grouping (their paths are the same).
    setChildren((prev) => (prev.size ? new Map() : prev));
    let live = true;
    setPending(true);
    const t = setTimeout(() => {
      void source.query(view).then((r) => {
        if (!live) return;
        setRows(r.rows);
        setPending(false);
      });
    }, rows === null ? 0 : 120);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the served slices, by design
  }, [source, about, servedKey]);

  // Group nodes the source made carry the children the shell has fetched.
  const data = useMemo<GridRowData[] | null>(() => {
    if (!rows) return null;
    if (children.size === 0) return rows;
    const attach = (list: GridRecord[]): GridRowData[] =>
      list.map((row) => {
        const kids = isGroupNode(row) ? children.get(String(row[schema.rowId])) : undefined;
        return kids ? { ...row, __children: attach(kids) } : row;
      });
    return attach(rows);
  }, [rows, children]);

  // Pivot mode (ADR-80): the dimension across the top, and its values from
  // the source — the whole source, so a filter never removes a column.
  const onPivot = useCallback((column: string | null) => {
    change((prev) => ({ ...prev, pivot: { ...prev.pivot, column } }));
  }, [change]);
  const pivotColumn = view.pivot.column;
  const [pivotValues, setPivotValues] = useState<{ column: string; values: string[] } | null>(null);
  useEffect(() => {
    if (!pivotColumn) return;
    let live = true;
    const ask = source.distinct ? source.distinct(pivotColumn) : Promise.resolve(distinctValues(rows ?? [], pivotColumn));
    void ask.then((values) => { if (live) setPivotValues({ column: pivotColumn, values }); });
    return () => { live = false; };
  }, [source, pivotColumn, rows]);

  const table = useTreasuryTable({
    data, view, onViewChange: change, applied: manual, schema,
    pivotValues: pivotValues && pivotValues.column === view.pivot.column ? pivotValues.values : undefined,
  });

  // A range is anchored to corner ids and would recompute across a reorder
  // or a pin into a scattered rectangle; the selection resets instead (ADR-71).
  const layoutKey = JSON.stringify([view.columnOrder, view.columnPinning]);
  useEffect(() => {
    if (table.getSelectedCellCount() > 0) table.resetCellSelection(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout key is the trigger
  }, [layoutKey]);

  // A measure's aggregation for this view (ADR-72): one more slice, written
  // like every other; the columns rebuild and every reader follows.
  const onAggChange = useCallback((columnId: string, agg: Agg | null) => {
    change((prev) => {
      const next = { ...prev.columnAggs } as Record<string, Agg>;
      if (agg === null) delete next[columnId];
      else next[columnId] = agg;
      return { ...prev, columnAggs: next };
    });
  }, [change]);

  // A measure's reading for this view (ADR-74): a patch merges into the
  // column's entry; null drops it; an entry with nothing left is dropped
  // too, so a view carries only what the reader changed.
  const onFormatChange = useCallback((columnId: string, patch: ColumnFormat | null) => {
    change((prev) => {
      const next = { ...prev.columnFormats } as Record<string, ColumnFormat>;
      if (patch === null) delete next[columnId];
      else {
        const merged = { ...next[columnId], ...patch };
        if (Object.values(merged).every((v) => v === undefined)) delete next[columnId];
        else next[columnId] = merged;
      }
      return { ...prev, columnFormats: next };
    });
  }, [change]);

  // A calculated column (ADR-79) joins the view; dropping one also scrubs
  // its id from every slice that may name it, so the view stays a view
  // that parses.
  const onAddComputed = useCallback((spec: ComputedColumn) => {
    change((prev) => ({ ...prev, computedColumns: [...prev.computedColumns, spec] }));
  }, [change]);
  const onRemoveComputed = useCallback((id: string) => {
    change((prev) => {
      const without = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => k !== id)) as Record<string, T>;
      return {
        ...prev,
        computedColumns: prev.computedColumns.filter((c) => c.id !== id),
        columnOrder: prev.columnOrder.filter((c) => c !== id),
        sorting: prev.sorting.filter((s) => s.id !== id),
        columnFilters: prev.columnFilters.filter((f) => f.id !== id),
        columnVisibility: without(prev.columnVisibility),
        columnSizing: without(prev.columnSizing),
        columnFormats: without(prev.columnFormats),
        columnPinning: { start: prev.columnPinning.start.filter((c) => c !== id), end: prev.columnPinning.end.filter((c) => c !== id) },
      };
    });
  }, [change]);

  // Lazy expansion: a node's children are asked for by its path, once.
  const onExpandGroup = useCallback((row: GridRow) => {
    const node = row.original;
    const nodeId = String(node[schema.rowId]);
    if (isGroupNode(node) && !children.has(nodeId)) {
      void source.query(view, { groupPath: node.__group.path }).then((r) => {
        setChildren((prev) => {
          if (prev.has(nodeId)) return prev;
          const next = new Map(prev);
          next.set(nodeId, r.rows);
          return next;
        });
      });
    }
    row.toggleExpanded();
  }, [source, view, children]);
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
    } else if (over === PIVOT_ZONE_ID) {
      const column = table.getColumn(idOf(active));
      if (column?.getCanGroup()) onPivot(column.id);
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


  return (
    <SchemaContext.Provider value={schema}>
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragLabel(null)}
    >
      <div
        className="flex h-full min-h-0 flex-col"
        data-slot="treasury-grid"
        data-testid="treasury-grid-shell"
        data-density={density}
        onKeyDownCapture={(e) => {
          // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y anywhere in the shell but a text field.
          const mod = e.ctrlKey || e.metaKey;
          if (!mod) return;
          const t = e.target as HTMLElement;
          if (t.closest('input, textarea, [contenteditable="true"]')) return;
          const key = e.key.toLowerCase();
          if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
          else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
        }}
      >
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
          history={{ ...steps, undo, redo }}
          onPivot={onPivot}
        />
        <FilterBar table={table} view={view} />
        <div className="flex min-h-0 flex-1">
          <RowContextMenu table={table} target={contextTarget} detailOpen={detailOpen} onToggleDetail={toggleDetail} onChart={onChart ? (o) => onChart(o.ok ? { ...o, request: { ...o.request, series: o.request.series.map((s) => ({ ...s, data: { ...s.data, asOf: about?.asOf ?? s.data.asOf } })) } } : o) : undefined}>
            <div className="min-w-0 flex-1">
              {!rows ? (
                <div className="h-full animate-pulse rounded-sm bg-muted" data-slot="skeleton" />
              ) : (
                <GridTable
                  table={table}
                  pending={pending}
                  density={density}
                  detailOpen={detailOpen}
                  onToggleDetail={toggleDetail}
                  onContextTarget={setContextTarget}
                  onExpandGroup={onExpandGroup}
                  onFormatChange={onFormatChange}
                  onAggChange={onAggChange}
                  onRemoveComputed={onRemoveComputed}
                  onPivot={onPivot}
                />
              )}
            </div>
          </RowContextMenu>
          {sidebarOpen && (
            <ColumnsSidebar
              table={table}
              grouping={view.grouping}
              columnOrder={view.columnOrder}
              computed={view.computedColumns}
              onAddComputed={onAddComputed}
              onRemoveComputed={onRemoveComputed}
            />
          )}
        </div>
        <StatusBar table={table} about={about} applied={manual} pending={pending} />
      </div>
      <DragOverlay dropAnimation={null}>
        {dragLabel ? <Badge variant="secondary" className="cursor-grabbing shadow-md">{dragLabel}</Badge> : null}
      </DragOverlay>
    </DndContext>
    </SchemaContext.Provider>
  );
}
