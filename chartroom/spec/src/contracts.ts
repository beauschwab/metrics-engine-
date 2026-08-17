/**
 * The contracts the linter reasons over.
 *
 * These are *shapes*, not fetchers. The server derives `MetricContract`s from
 * the registry; the widgets package declares `WidgetContract`s as data; the
 * linter receives both through `LintContext` and never goes looking for
 * either. That injection is what keeps this package pure and the golden tests
 * hermetic.
 */

import type { MetricRef, WidgetTypeRef } from './schema';

export interface DimContract {
  name: string;
  type: 'categorical' | 'time' | 'boolean';
  /** Ordered dims (tenor buckets) keep their order in a bar chart — BAR-02. */
  ordinal?: boolean;
  /** Distinct values, when the domain is small enough to enumerate. */
  values?: string[];
}

export interface MetricContract {
  ref: MetricRef;
  doc: string;
  measure: string;
  version: number;
  /**
   * Governance status, derived from the release/channel system (ADR-12):
   * `approved` when the production channel serves this document, else `draft`.
   */
  status: 'draft' | 'approved' | 'deprecated';
  /** Source-table grain, e.g. alm.fct_liquidity_position. */
  grain: string;
  dims: DimContract[];
  unit: 'USD' | 'percent' | 'count' | 'number';
  precision: number;
  /** The engine's own format string, e.g. currency_usd — rendering truth. */
  format: string;
  allowed_aggregations: string[];
  /**
   * For ratio measures, the measure name of the denominator — what DEN-01
   * compares across side-by-side widgets.
   */
  denominator_of?: string | null;
  owner: string;
  lineage_urn: string;
  description?: string;
}

export interface WidgetContract {
  widget: string;
  version: number;
  /** What kind of visual this is — several rules key off the family. */
  family: 'kpi' | 'timeseries' | 'bar' | 'table' | 'grid' | 'part_to_whole';
  accepts: {
    requires_time_dim?: boolean;
    max_series?: number;
    categorical_dims?: { min: number; max: number };
    supports: Array<'bands' | 'compare' | 'window' | 'sort' | 'max_cells' | 'filters'>;
  };
  /** Rules this widget's own defaults already enforce — cited, not re-checked. */
  guide_rules: string[];
  description?: string;
}

export const widgetTypeRef = (c: WidgetContract): WidgetTypeRef => `${c.widget}@${c.version}`;
