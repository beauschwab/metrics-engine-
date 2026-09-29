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
export * from './components/ui/dropdown-menu';
export * from './components/ui/context-menu';
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from './components/ui/popover';
export { Input } from './components/ui/input';
export { Separator } from './components/ui/separator';
export { heatIntensity, heatBackground, HEAT_MAX_PERCENT } from './grid/heat';
export { excelFormat } from './export/formats';
export { buildWorkbook, workbookBytes, type ExportOptions } from './export/xlsx';
export { GroupByDropZone } from './components/GroupByDropZone';
export { ColumnsSidebar } from './components/ColumnsSidebar';
export { GroupCell, leafCount } from './components/GroupCell';
export { wavg, Wavg, weightedAverage, aggregatedNumber, type WavgParts } from './grid/aggregations';
export { cn } from './lib/utils';
export { useTreasuryTable, type TreasuryTable, type TreasuryTableOptions, type ViewUpdate } from './grid/useTreasuryTable';
export {
  ViewStateSchema, VIEW_VERSION, defaultView, parseView, safeParseView, toTableState,
  type ViewState, type ViewSlice,
} from './grid/viewState';
export type { DataSource, SourceDescription, SourceColumn, QueryOptions, QueryResult } from './data/source';
export { inMemorySource } from './data/inMemorySource';
export { features, type Features } from './grid/features';
export { columns, selectColumn, SELECT_ID, COLUMN_META, COLUMN_ORDER } from './grid/columns';
export { formatValue, alignOf, MISSING, type ColumnMeta, type Unit, type Agg } from './grid/meta';
export {
  generatePositions, seeded, type Position,
  DESKS, ENTITIES, CURRENCIES, PRODUCTS, TENORS,
} from './data/mock';
