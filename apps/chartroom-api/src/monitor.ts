/**
 * The morning's value-level exceptions — the registry's own variance monitors,
 * run by the engine, filtered to one as-of date (ADR-55).
 *
 * The v3 handoff wants the exception strip to open on "what broke overnight",
 * with limit codes like LIM-101. This workspace already has a governed place
 * where limits live: `kind: variance_monitor` documents, whose thresholds are
 * effective-dated, cited, and severity-carrying. So the strip's breach rows
 * come from running those monitors — not from a threshold typed into the
 * studio, which would be exactly the ungoverned number the platform exists to
 * prevent.
 *
 * Everything here is a read: the same `runMonitor` the authoring surface's
 * variance panel calls, over the same fixture rows the query engine serves.
 */

import { AS_OF, DATES } from 'keel-engine/fixtures';
import { parseDoc, type Graph } from 'keel-engine/parse';
import { buildRegistry } from 'keel-engine/registry';
import { readReport } from 'keel-engine/compile';
import { readMonitor, runMonitor } from 'keel-engine/variance';
import type { RegistryState } from './keel';

export interface MonitorException {
  /** The monitor document that raised it. */
  monitor: string;
  /** The threshold that fired — the strip's traceable code. */
  threshold: string;
  severity: 'error' | 'warn' | 'info';
  /** The rollup key at the monitor's grain, joined for display. */
  key: string;
  date: string;
  value: number;
  delta: number;
  /** What the change was measured against, and the limit in force. */
  observed: number;
  limit: number;
  message: string;
}

/**
 * Run every monitor in the workspace and keep the breaches for one date.
 *
 * A monitor that cannot run — its report or view missing, a document that no
 * longer parses — contributes nothing rather than a 500: the diagnostics
 * surface next door already names that problem with a line number, and this
 * endpoint's job is the strip, not a second linter.
 */
export function monitorExceptions(
  state: RegistryState,
  asOf: string | null,
): MonitorException[] {
  const graphs: Graph[] = [];
  for (const doc of state.docs) {
    try {
      graphs.push(parseDoc(doc.body));
    } catch {
      // covered by diagnostics, not by us
    }
  }
  const registry = buildRegistry(
    Object.fromEntries(state.docs.map((d) => [d.name, d.body])),
  );
  const date = asOf && DATES.includes(asOf) ? asOf : AS_OF;

  const out: MonitorException[] = [];
  for (const g of graphs) {
    if (g.kind !== 'variance_monitor') continue;
    const monitor = readMonitor(g);
    const reportGraph = graphs.find((x) => x.kind === 'report' && x.docName === monitor.report);
    if (!reportGraph) continue;
    const report = readReport(reportGraph);
    const view = graphs.find((x) => x.kind === 'metrics_view' && x.docName === report.view);
    if (!view) continue;

    let result;
    try {
      result = runMonitor(monitor, report, view, registry, 'nominal', DATES);
    } catch {
      continue;
    }

    for (const b of result.breaches) {
      if (b.date !== date) continue;
      const t = b.evaluation.threshold;
      const key = b.key.join(' · ');
      out.push({
        monitor: monitor.name,
        threshold: t.id,
        severity: t.severity,
        key,
        date: b.date,
        value: b.value,
        delta: b.delta,
        observed: b.evaluation.observed,
        limit: b.evaluation.limit,
        message:
          `${monitor.measure} for ${key} moved ${fmtNum(b.delta)} day-over-day — `
          + `${fmtNum(Math.abs(b.evaluation.observed))} against the ${t.id} limit of ${fmtNum(b.evaluation.limit)}`,
      });
    }
  }
  return out;
}

const fmtNum = (v: number): string =>
  Math.abs(v) >= 1000
    ? Math.round(v).toLocaleString('en-US')
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
