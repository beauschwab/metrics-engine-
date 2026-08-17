/**
 * chartroom-widgets — the catalog (contracts as data) and its renderers.
 *
 * `COMPONENTS` is the seam the interpreter renders through: a widget type ref
 * resolves to a component or the dashboard fails loudly at the frame, never
 * silently at the canvas.
 */

import type { ComponentType } from 'react';
import type { WidgetProps } from './types';
import { KpiTile } from './KpiTile';
import { Timeseries } from './Timeseries';
import { Bar } from './Bar';
import { DeltaTable } from './DeltaTable';
import { PerspectiveGrid } from './PerspectiveGrid';

export { CATALOG, CATALOG_BY_REF } from './contracts';
export { formatDate, formatDelta, formatTick, formatValue } from './format';
export { barOrder, linePath, ticks, xPos, yExtent, yPos } from './scale';
export type { Extent } from './scale';
export type {
  GroupRow, SeriesLine, SeriesPoint, WidgetData, WidgetProps, WidgetStatus,
} from './types';
export { KpiTile, Timeseries, Bar, DeltaTable, PerspectiveGrid };

export const COMPONENTS: Record<string, ComponentType<WidgetProps>> = {
  'kpi-tile@1': KpiTile,
  'timeseries@1': Timeseries,
  'bar@1': Bar,
  'delta-table@1': DeltaTable,
  'perspective-grid@1': PerspectiveGrid,
};
