/**
 * The feature registry — everything the table instance can do, declared once.
 *
 * TanStack Table v9 is headless and explicit: a state slice, an API or a row
 * model exists only if its feature is registered here, and `tableFeatures`
 * type-checks the prerequisites (a sorted row model without the sorting
 * feature is a compile error, not a runtime surprise). The whole grid shares
 * this one object through `useTreasuryTable`, which is what makes the view
 * state (Phase 1) a single shape rather than one per screen.
 *
 * Verified against the installed 9.2.4 declarations, not memory — v9's API
 * moved between betas and the skills shipped in `node_modules/@tanstack/*`
 * are the reference when the docs lag.
 *
 * Imported from `@tanstack/table-core`, not the React adapter: this file,
 * the columns, the view state and the aggregations are the React-free core
 * the agent tools and the MCP server load in Node (ADR-69); only the hook
 * touches `@tanstack/react-table`.
 *
 * Not registered: the paginated row model. `getRowModel()` resolves to the
 * last registered model, and a paged one would hand the Phase-1 virtualizer
 * ten rows. Pagination returns in Phase 5 as `manualPagination` — the window
 * the virtualizer asks the data source for — TODO(grid-phase-5).
 */

import {
  aggregationFn_count, aggregationFn_max, aggregationFn_mean, aggregationFn_median, aggregationFn_min,
  aggregationFn_sum, aggregationFn_uniqueCount,
  cellSelectionFeature,
  constructFilterFn,
  columnFacetingFeature, columnFilteringFeature, columnGroupingFeature,
  columnOrderingFeature, columnPinningFeature, columnResizingFeature,
  columnSizingFeature, columnVisibilityFeature,
  createExpandedRowModel, createFacetedMinMaxValues, createFacetedRowModel,
  createFacetedUniqueValues, createFilteredRowModel, createGroupedRowModel,
  createSortedRowModel,
  filterFn_arrHas, filterFn_arrIncludesSome, filterFn_between, filterFn_equals,
  filterFn_greaterThan, filterFn_inNumberRange, filterFn_includesString,
  filterFn_lessThan, filterFn_weakEquals,
  globalFilteringFeature, metaHelper, rowAggregationFeature, rowExpandingFeature,
  rowSelectionFeature, rowSortingFeature, sortFn_alphanumeric, sortFn_basic, sortFn_datetime,
  tableFeatures,
} from '@tanstack/table-core';
import { wavg } from './aggregations';
import type { ColumnMeta } from './meta';
import { searchFilterFn } from './search';

export const features = tableFeatures({
  // Column meta is typed per table through this phantom slot rather than by
  // global declaration merging, so the grid's meta cannot leak onto any other
  // table in the bundle.
  columnMeta: metaHelper<ColumnMeta>(),

  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    equals: filterFn_equals,
    weakEquals: filterFn_weakEquals,
    arrIncludesSome: filterFn_arrIncludesSome,
    // The set filter: a scalar cell equal to one of the chosen values. The
    // built-in drops an empty list as "no filter"; here an empty list is a
    // reader's "none of these" and keeps no row (ADR-73).
    arrHas: constructFilterFn({ ...filterFn_arrHas, autoRemove: (v: unknown) => !Array.isArray(v) }),
    // The quick filter's grammar — free words and column terms (ADR-73).
    search: searchFilterFn,
    // The number filter: an inclusive range whose blank ends are open.
    inNumberRange: filterFn_inNumberRange,
    greaterThan: filterFn_greaterThan,
    lessThan: filterFn_lessThan,
    between: filterFn_between,
  },
  globalFilteringFeature,

  columnFacetingFeature,
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  facetedMinMaxValues: createFacetedMinMaxValues(),

  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },

  columnGroupingFeature,
  groupedRowModel: createGroupedRowModel(),
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),

  rowAggregationFeature,
  aggregationFns: {
    sum: aggregationFn_sum,
    min: aggregationFn_min,
    max: aggregationFn_max,
    count: aggregationFn_count,
    mean: aggregationFn_mean,
    median: aggregationFn_median,
    uniqueCount: aggregationFn_uniqueCount,
    // Decomposable Σ(x·w) / Σ(w), weighted by the meta's column (ADR-67).
    wavg,
  },

  // Selection is transient — a reader's hand on the book, not part of the
  // saved view — so its slice stays inside the table (ADR-68). Cell ranges
  // likewise: a block to copy, never a view (ADR-71).
  rowSelectionFeature,
  cellSelectionFeature,

  columnVisibilityFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnResizingFeature,
});

export type Features = typeof features;
