/**
 * chartroom-grid — the treasury data grid.
 *
 * A headless TanStack Table v9 core with column meta as the single source of
 * behaviour and view state as the contract every consumer speaks: the UI,
 * saved views, the query compiler and the agent tools (ADR-66). Rows come
 * through one data seam, `DataSource`, and nothing else.
 * Sits at `spec ← grid ← studio`; imports the widget catalog's React-free
 * `/format` so a number here reads as it does in a tile and in the deck.
 * Renders on shadcn/ui and Tailwind (ADR-65); `theme.css` binds shadcn's
 * variables to the studio's Aperture Risk aliases.
 */

export { TreasuryGrid, ROW_HEIGHT, ROW_HEIGHTS, DETAIL_HEIGHT, type TreasuryGridProps, type Density } from './components/TreasuryGrid';
export { ValueCell } from './components/CellRenderers';
export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption } from './components/ui/table';
export { Button, buttonVariants } from './components/ui/button';
export { Checkbox } from './components/ui/checkbox';
export { Badge, badgeVariants } from './components/ui/badge';
export { GridTable, type ContextTarget } from './components/GridTable';
export { HeaderMenu } from './components/HeaderMenu';
export { FilterPopover } from './components/FilterPopover';
export { DetailPanel } from './components/DetailPanel';
export { RowContextMenu } from './components/RowContextMenu';
export { StatusBar } from './components/StatusBar';
export { GridToolbar } from './components/GridToolbar';
export { ViewsMenu } from './components/ViewsMenu';
export { headlessTable, headlessFeatures, type HeadlessTable, type HeadlessFeatures } from './agent/headless';
export {
  describeView, queryView, setView, VIEW_CONTRACT,
  type DescribeResult, type QueryViewOptions, type QueryViewResult, type QueryRow, type SetViewResult, type ViewContract, type ContractColumn,
} from './agent/tools';
export { buildGridServer, GRID_MCP_NAME, GRID_MCP_VERSION, GRID_MCP_INSTRUCTIONS, type GridServerOptions } from './agent/server';
export { memoryViewStore, storageViewStore, localStorageViewStore, VIEW_STORE_KEY, type SavedView, type ViewStore, type StorageViewStore, type KeyValueStorage } from './views/store';
export { viewToParam, viewFromParam, readViewFromHash, writeViewToHash, VIEW_PARAM, type ViewFromParam } from './views/url';
export * from './components/ui/dropdown-menu';
export * from './components/ui/context-menu';
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from './components/ui/popover';
export { Input } from './components/ui/input';
export { Separator } from './components/ui/separator';
export { heatIntensity, heatBackground, HEAT_MAX_PERCENT } from './grid/heat';
export { rangesToTsv, selectedCellRanges, cellText, type CopyCell, type CopyOptions, type CopyTable } from './grid/copy';
export { excelFormat } from './export/formats';
export { buildWorkbook, workbookBytes, type ExportOptions } from './export/xlsx';
export { GroupByDropZone } from './components/GroupByDropZone';
export { ColumnsSidebar } from './components/ColumnsSidebar';
export { GroupCell, ServerGroupCell, leafCount } from './components/GroupCell';
export { wavg, Wavg, weightedAverage, aggregatedNumber, type WavgParts } from './grid/aggregations';
export { cn } from './lib/utils';
export { useTreasuryTable, type TreasuryTable, type TreasuryTableOptions, type ViewUpdate, type Applied, type GridRowData } from './grid/useTreasuryTable';
export {
  ViewStateSchema, VIEW_VERSION, defaultView, parseView, safeParseView, toTableState, migrateView,
  type ViewState, type ViewSlice,
} from './grid/viewState';
export type { DataSource, SourceDescription, SourceColumn, QueryOptions, QueryResult } from './data/source';
export { inMemorySource } from './data/inMemorySource';
export { compileSql, DUCKDB, SQLITE, DREMIO, type SqlDialect, type CompiledSql, type CompileOptions } from './data/compileSql';
export { sqlSource, isGroupNode, groupNodeId, type SqlExecutor, type GroupNode, type SqlSourceOptions } from './data/sqlSource';
export { duckdbSource, createDuckDbExecutor, DUCKDB_TABLE, type DuckDbExecutor } from './data/duckdbSource';
export { dremioSource, createDremioExecutor, type DremioOptions } from './data/dremioSource';
export { features, type Features } from './grid/features';
export { columns, buildColumns, effectiveAgg, allowedAggs, selectColumn, SELECT_ID, COLUMN_META, COLUMN_ORDER, type ColumnAggs } from './grid/columns';
export { formatValue, alignOf, MISSING, AGGS, AGG_LABELS, type ColumnMeta, type Unit, type Agg } from './grid/meta';
export {
  generatePositions, seeded, type Position,
  DESKS, ENTITIES, CURRENCIES, PRODUCTS, TENORS,
} from './data/mock';
