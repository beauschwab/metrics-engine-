/**
 * Diagnostics for a variance monitor — the KEEL09x family.
 *
 * A monitor is a control, and the failure mode of a control is not that it
 * computes the wrong number. It is that it looks like it is watching something
 * and is not. Every check here is aimed at that: a threshold that can never
 * fire, one that fires so often nobody could act on it, a σ built on too little
 * history to mean anything, a grain finer than the series can support.
 *
 * `KEEL095` is the one worth reading twice. A threshold with no breaches across
 * the whole test window is reported, because "no alerts" and "no coverage" look
 * identical from the outside and only one of them is good news. It is a warning
 * rather than an error: an escalation trigger that has not fired in sixty days
 * may be correctly set. The point is that the author decides that knowingly.
 */

import type { Diagnostic } from './diagnostics';
import { fmt } from './format';
import { parseDoc, type Graph } from './parse';
import type { Registry } from './registry';
import { readReport, type ReportSpec } from './compile';
import { compilePredicate } from './predicate';
import {
  BASIS_WINDOW, MIN_OBSERVATIONS, THRESHOLD_BASES, readMonitor,
  runMonitor, type MonitorResult, type MonitorSpec,
} from './variance';
import { DATES } from './fixtures';
import type { FixtureName } from './vocab';

/** Codes that mean the monitor is not actually monitoring. */
export const VARIANCE_BLOCKING: Record<string, true> = {
  KEEL090: true, KEEL091: true, KEEL092: true, KEEL093: true, KEEL097: true,
};

/** A threshold firing on more than this share of evaluated points is noise. */
const NOISE_SHARE = 0.25;

export function diagnoseMonitor(
  g: Graph,
  registry: Registry,
  fixture: FixtureName,
  docs: Record<string, string>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const monitor = readMonitor(g);
  const lineOf = (key: string) => Math.max(0, g.info.findIndex((i) => i.key === key));

  // --- what it watches (KEEL090 / 091 / 092) -------------------------------
  const reportDoc = Object.values(docs).find((d) => d.includes(`name: ${monitor.report}\n`));
  const reportGraph = reportDoc ? parseReport(reportDoc) : null;

  if (!monitor.report || !reportGraph) {
    out.push({
      code: 'KEEL090',
      sev: 'error',
      message: monitor.report
        ? `There is no report called ${monitor.report}, so there is no rollup to watch`
        : 'A monitor has to name the report whose rollup it watches',
      line: lineOf('report'),
      token: monitor.report,
    });
    return out.filter((d) => d.line >= 0);
  }

  const report = reportGraph.spec;
  const viewGraph = reportGraph.view(docs);

  if (!monitor.measure || !report.measures.includes(monitor.measure)) {
    out.push({
      code: 'KEEL091',
      sev: 'error',
      message: monitor.measure
        ? `${monitor.report} does not file ${monitor.measure}, so a variance on it would not correspond to anything submitted`
        : 'A monitor has to name which of the report’s measures it watches',
      line: lineOf('measure'),
      token: monitor.measure,
    });
  }

  const grain = monitor.grain.length ? monitor.grain : report.grouping;
  const notInReport = grain.filter((c) => !report.grouping.includes(c));
  if (notInReport.length) {
    out.push({
      code: 'KEEL092',
      sev: 'error',
      message:
        `${notInReport.join(', ')} is not part of ${monitor.report}’s grain, so a series at this ` +
        'level would not be a series of anything that gets filed',
      line: lineOf('grain'),
      token: notInReport[0],
    });
  }

  // --- each threshold, structurally (KEEL093 / 096 / 097 / 098) -------------
  const seen: Record<string, true> = {};
  monitor.thresholds.forEach((t) => {
    if (seen[t.id]) {
      out.push({
        code: 'KEEL098',
        sev: 'error',
        message: `Threshold id ${t.id} is used twice — a breach has to be attributable to one rule`,
        line: t.block.line,
        token: t.id,
      });
    }
    seen[t.id] = true;

    if (!THRESHOLD_BASES.includes(t.basis)) {
      out.push({
        code: 'KEEL093',
        sev: 'error',
        message: t.basis
          ? `${t.basis} is not a threshold basis. Use one of ${THRESHOLD_BASES.join(', ')}`
          : `${t.id} does not say what to compare against`,
        line: t.block.lineOf.basis ?? t.block.line,
        token: t.basis,
      });
      return;
    }

    const dynamic = t.basis in BASIS_WINDOW;

    if (dynamic && !Number.isFinite(t.sigma)) {
      out.push({
        code: 'KEEL093',
        sev: 'error',
        message: `${t.id} is a ${t.basis} threshold but sets no sigma multiplier`,
        line: t.block.line,
      });
    }
    if (!dynamic && !Number.isFinite(t.limit)) {
      out.push({
        code: 'KEEL093',
        sev: 'error',
        message: `${t.id} is a ${t.basis} threshold but sets no limit`,
        line: t.block.line,
      });
    }

    // A non-positive limit fires on literally everything, including a series
    // that did not move. That is not a tight control, it is a broken one.
    if (!dynamic && Number.isFinite(t.limit) && t.limit <= 0) {
      out.push({
        code: 'KEEL097',
        sev: 'error',
        message: `${t.id} has a limit of ${t.limit}, which every change exceeds`,
        line: t.block.lineOf.limit ?? t.block.line,
      });
    }
    if (dynamic && Number.isFinite(t.sigma) && t.sigma <= 0) {
      out.push({
        code: 'KEEL097',
        sev: 'error',
        message: `${t.id} has a sigma of ${t.sigma}, which every change exceeds`,
        line: t.block.lineOf.sigma ?? t.block.line,
      });
    }

    if (t.appliesTo) {
      const pred = compilePredicate(t.appliesTo);
      if (pred.err) {
        out.push({
          code: 'KEEL093',
          sev: 'error',
          message: `${t.id}: this scope can’t be read — ${pred.err}`,
          line: t.block.lineOf.applies_to ?? t.block.line,
        });
      } else {
        // Scoping on something the rollup key does not carry silently matches
        // nothing, so the threshold covers no rows at all.
        const unknown = pred.cols.filter((c) => !grain.includes(c));
        if (unknown.length) {
          out.push({
            code: 'KEEL092',
            sev: 'error',
            message:
              `${t.id} scopes on ${unknown.join(', ')}, which is not part of the watched grain ` +
              `(${grain.join(', ')}) — the scope would match nothing`,
            line: t.block.lineOf.applies_to ?? t.block.line,
            token: unknown[0],
          });
        }
      }
    }

    const tier = parseInt(g.view['governance.sr_11_7_tier'] || g.view.sr_11_7_tier || '0', 10);
    if (tier >= 1 && tier <= 2 && !t.citation) {
      out.push({
        code: 'KEEL099',
        sev: 'warn',
        message: `${t.id} has no citation — a tier ${tier} control must say which policy sets it`,
        line: t.block.line,
      });
    }
  });

  // --- how it behaves on the data (KEEL094 / 095 / 096) --------------------
  if (viewGraph && out.every((d) => !VARIANCE_BLOCKING[d.code])) {
    const result = runMonitor(monitor, report, viewGraph, registry, fixture);
    out.push(...behaviourDiagnostics(monitor, result, g));
  }

  return out.filter((d) => d.line >= 0);
}

function behaviourDiagnostics(
  monitor: MonitorSpec,
  result: MonitorResult,
  g: Graph,
): Diagnostic[] {
  const out: Diagnostic[] = [];

  monitor.thresholds.forEach((t) => {
    const stat = result.stats.find((s) => s.id === t.id);
    if (!stat) return;
    const ran = stat.breaches + stat.passes;

    if (stat.notApplicable > 0 && ran === 0) {
      out.push({
        code: 'KEEL096',
        sev: 'warn',
        message:
          `${t.id} applies to no rollup in the test data — its scope matches none of the ` +
          `${result.keys} series being watched`,
        line: t.block.line,
      });
      return;
    }

    if (t.basis in BASIS_WINDOW && ran > 0 && stat.insufficient / (ran + stat.insufficient) > 0.5) {
      out.push({
        code: 'KEEL094',
        sev: 'warn',
        message:
          `${t.id} has no usable threshold on ${stat.insufficient} of ` +
          `${ran + stat.insufficient} points — a ${BASIS_WINDOW[t.basis]}-day window needs ` +
          `${MIN_OBSERVATIONS} prior moves, and most of these series are too short or too new`,
        line: t.block.line,
      });
    }

    if (ran > 0 && stat.breaches === 0) {
      out.push({
        code: 'KEEL095',
        sev: 'warn',
        message:
          `${t.id} never fires across ${ran} evaluated points. "No alerts" and "no coverage" ` +
          'look the same from outside — confirm the limit is where you want it',
        line: t.block.line,
      });
    }

    if (ran > 0 && stat.breaches / ran > NOISE_SHARE) {
      out.push({
        code: 'KEEL096',
        sev: 'warn',
        message:
          `${t.id} fires on ${Math.round((stat.breaches / ran) * 100)}% of evaluated points ` +
          '— a control this loud is one nobody reads',
        line: t.block.line,
      });
    }
  });

  // A rollup that appears mid-series is a new product ID in a submission, which
  // is a reportable event rather than a variance. Surfaced here because no
  // threshold can express it: there is no prior day to compare against.
  if (result.appeared.length) {
    out.push({
      code: 'KEEL093',
      sev: 'info',
      message:
        `${result.appeared.length} rollup(s) appear part-way through the window — ` +
        `${result.appeared.slice(0, 3).map((a) => `${a.key.join('·')} on ${a.date}`).join(', ')}` +
        '. A key with no prior day has no day-over-day change, so no threshold sees it',
      line: Math.max(0, g.info.findIndex((i) => i.key === 'thresholds')),
    });
  }

  if (result.evaluated === 0) {
    out.push({
      code: 'KEEL094',
      sev: 'error',
      message:
        'No day-over-day change could be computed anywhere in the window, so nothing is ' +
        'being monitored at all',
      line: Math.max(0, g.info.findIndex((i) => i.key === 'watch')),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------

/**
 * Resolve the report a monitor names, and the view behind it.
 *
 * Found by name across the open documents rather than through the registry: the
 * registry holds classifications and parameter sets, which are referenced by
 * derivations, and a report is not one of those.
 */
function parseReport(doc: string): {
  spec: ReportSpec;
  view(docs: Record<string, string>): Graph | null;
} | null {
  const g = parseDoc(doc);
  if (g.kind !== 'report') return null;
  const spec = readReport(g);
  return {
    spec,
    view(docs) {
      const found = Object.values(docs).find((d) => d.includes(`view: ${spec.view}\n`));
      if (!found) return null;
      const vg = parseDoc(found);
      return vg.kind === 'metrics_view' ? vg : null;
    },
  };
}

/** A one-line summary for the panel header. */
export function monitorSummary(result: MonitorResult): string {
  const errors = result.breaches.filter((b) => b.evaluation.threshold.severity === 'error').length;
  return `${result.breaches.length} breach(es) over ${DATES.length} days across ` +
    `${result.keys} rollups${errors ? `, ${errors} at error severity` : ''}`;
}

/** How a breach reads in a list. */
export function breachLabel(delta: number, deltaPct: number): string {
  const money = fmt(delta, 'currency_usd');
  return Number.isFinite(deltaPct) ? `${money} · ${deltaPct.toFixed(1)}%` : money;
}
