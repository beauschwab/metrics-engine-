/**
 * The rendering contract every widget signs.
 *
 * Presentation-only, enforced three ways: the props carry resolved data (a
 * widget receives numbers, never a binding to go fetch), the boundaries test
 * fails on `fetch` appearing anywhere in this package, and colors come from
 * CSS custom properties (`--cr-*`) so a widget cannot hardcode a palette —
 * the theme owns chromatics, the widget owns geometry.
 */

import type { WidgetInstance } from 'chartroom-spec';

export type WidgetStatus = 'loading' | 'streaming' | 'fresh' | 'stale' | 'error' | 'empty';

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface SeriesLine {
  key: Record<string, string>;
  points: SeriesPoint[];
}

export interface GroupRow {
  key: Record<string, string>;
  value: number;
  prior: number;
}

/** Resolved by the interpreter from the query responses — shaped, not raw. */
export interface WidgetData {
  unit: string;
  format: string;
  asOf: string;
  scalar?: { value: number; prior: number };
  rows?: GroupRow[];
  series?: SeriesLine[];
  /** The compare target, already evaluated. */
  compare?: { label: string; value: number; style: 'threshold' | 'delta' };
  /** Reference bands, already evaluated over the same window. */
  bands?: Array<{ label: string; points: SeriesPoint[] }>;
  /** True when the dim the rows are keyed by reads in its own order (BAR-02). */
  ordinalDim?: boolean;
}

export interface WidgetProps {
  instance: WidgetInstance;
  data: WidgetData | null;
  status: WidgetStatus;
  error?: string;
  /**
   * Cross-filter seam (Phase 4): when the interpreter wires this widget as an
   * interaction source, clicking a group calls back with its key. Still
   * presentation-only — the widget reports the click; what it filters, and
   * whether anything does, is the interpreter's spec-driven business.
   */
  onPick?(key: Record<string, string>): void;
  /** The group key currently driving a cross-filter, for highlight. */
  picked?: Record<string, string> | null;
}
