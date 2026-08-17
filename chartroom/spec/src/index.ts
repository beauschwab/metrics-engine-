/**
 * chartroom-spec — the dashboard DSL and everything that reasons about it.
 *
 * Pure by contract: no fetch, no fs, no React, no Node APIs. Runs identically
 * in the studio, the server, and the (Phase-2) MCP process, which is the whole
 * point — one schema, one linter, no drift.
 */

export {
  DashboardSpecSchema, MetricRefSchema, WidgetTypeRefSchema,
  parseSpec, parseMetricRef, parseWidgetType,
  METRIC_REF, WIDGET_TYPE_REF, AUDIENCES, CADENCES, STATUSES,
} from './schema';
export type {
  DashboardSpec, WidgetInstance, Binding, FilterExpr, CompareSpec, DerivedExpr,
  FormatOverrides, Interaction, MetricRef, WidgetTypeRef,
} from './schema';

export type { MetricContract, DimContract, WidgetContract } from './contracts';
export { widgetTypeRef } from './contracts';

export { canonicalize, specHash } from './canonical';
export { sha256Hex } from './sha256';
export { diffSpecs } from './diff';
export type { SpecDiff } from './diff';
export { applyPatch, PatchFailed } from './patch';
export type { PatchOp } from './patch';

export { lint, RULES } from './lint';
export { widgetsOf } from './lint/context';
export type {
  LintContext, LintFinding, LintReport, Severity, Rule, WidgetAt,
} from './lint/context';
