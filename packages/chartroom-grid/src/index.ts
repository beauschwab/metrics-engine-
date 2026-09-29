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

export { TreasuryGrid, ROW_HEIGHT, type TreasuryGridProps } from './components/TreasuryGrid';
export { ValueCell } from './components/CellRenderers';
export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption } from './components/ui/table';
export { cn } from './lib/utils';
export { useTreasuryTable, type TreasuryTable, type TreasuryTableOptions, type ViewUpdate } from './grid/useTreasuryTable';
export {
  ViewStateSchema, VIEW_VERSION, defaultView, parseView, safeParseView, toTableState,
  type ViewState, type ViewSlice,
} from './grid/viewState';
export type { DataSource, SourceDescription, SourceColumn, QueryOptions, QueryResult } from './data/source';
export { inMemorySource } from './data/inMemorySource';
export { features, type Features } from './grid/features';
export { columns, COLUMN_META, COLUMN_ORDER } from './grid/columns';
export { formatValue, alignOf, MISSING, type ColumnMeta, type Unit, type Agg } from './grid/meta';
export {
  generatePositions, seeded, type Position,
  DESKS, ENTITIES, CURRENCIES, PRODUCTS, TENORS,
} from './data/mock';
