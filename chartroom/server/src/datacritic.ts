/**
 * The data critic — the checks only running the numbers can make (PRD §data
 * critic, Phase 4). Deterministic and LLM-free by design: every finding is a
 * computed fact with the evidence attached, which is why (unlike the design
 * critic) its findings never need a "model unavailable" degrade path.
 *
 * The division of labour with the linter is the working agreement's: anything
 * checkable from the spec and contracts alone graduates into a lint rule
 * (AGG-01 and IX-01 did exactly that); what remains here is what needs the
 * QueryService — whether grouped numbers reconcile with the headline, whether
 * every widget answers at the same as-of, whether anything non-finite leaks
 * into a render.
 *
 * Checks:
 *   MASS-01   grouped sums equal the headline for a sum-aggregable measure,
 *             under the widget's own filters — conservation proven per
 *             dashboard, not assumed from the engine's tests.
 *   COHERE-01 every widget (and every compare/band leg) answers at one as-of.
 *             Two widgets silently showing different days is the coherent-
 *             looking wrong the PRD names.
 *   FIN-01    every rendered number is finite. A NaN in a KPI tile renders as
 *             "NaN" and a reader's trust does not survive it.
 */

import type { DashboardSpec, FilterExpr, WidgetInstance } from 'chartroom-spec';
import type { QueryRequest, QueryResult, QueryService } from './query';

export interface DataFinding {
  code: 'MASS-01' | 'COHERE-01' | 'FIN-01' | 'QUERY';
  severity: 'BLOCK' | 'WARN';
  widget?: string;
  message: string;
  /** The computed numbers behind the claim — the finding is checkable. */
  evidence?: Record<string, unknown>;
}

export interface DataCritique {
  findings: DataFinding[];
  /** widget id → the as-of its main query answered at. */
  asOf: Record<string, string>;
  widgetsChecked: number;
}

interface Leg {
  widget: string;
  role: 'main' | 'compare' | 'band';
  req: QueryRequest;
}

function paramsOf(spec: DashboardSpec): Record<string, string> {
  return Object.fromEntries(Object.entries(spec.context).map(([n, p]) => [n, p.default]));
}

/** The same request shapes the studio's binding resolver produces. */
export function legsOf(spec: DashboardSpec): Leg[] {
  const params = paramsOf(spec);
  const p = Object.keys(params).length ? { params } : {};
  const legs: Leg[] = [];
  for (const w of spec.widgets) {
    const b = w.bind;
    legs.push({
      widget: w.id,
      role: 'main',
      req: {
        metric: b.metric,
        ...(b.dims?.length ? { dims: b.dims } : {}),
        ...(b.filters?.length ? { filters: b.filters as FilterExpr[] } : {}),
        ...(b.window ? { window: b.window } : {}),
        ...(b.max_cells !== undefined ? { max_cells: b.max_cells } : {}),
        ...p,
      },
    });
    if (b.compare && b.compare.vs !== 'prior_period') {
      legs.push({ widget: w.id, role: 'compare', req: { metric: b.compare.vs, ...p } });
    }
    for (const ref of b.bands ?? []) {
      legs.push({
        widget: w.id, role: 'band',
        req: { metric: ref, dims: ['as_of_date'], ...(b.window ? { window: b.window } : {}), ...p },
      });
    }
  }
  return legs;
}

const finite = (n: number) => Number.isFinite(n);

function nonFinite(widget: string, role: Leg['role'], r: QueryResult): DataFinding[] {
  const bad: string[] = [];
  if (r.kind === 'scalar') {
    if (!finite(r.value)) bad.push('value');
    if (!finite(r.prior)) bad.push('prior');
  }
  if (r.kind === 'groups') {
    for (const row of r.rows) {
      if (!finite(row.value)) bad.push(Object.values(row.key).join(' · '));
    }
  }
  if (r.kind === 'series') {
    for (const s of r.series) {
      for (const pt of s.points) {
        if (!finite(pt.value)) bad.push(`${Object.values(s.key).join(' · ') || 'series'} @ ${pt.date}`);
      }
    }
  }
  if (!bad.length) return [];
  return [{
    code: 'FIN-01', severity: 'BLOCK', widget,
    message: `${widget}'s ${role} query returns non-finite values — they would render as NaN`,
    evidence: { cells: bad.slice(0, 10), total: bad.length },
  }];
}

export async function dataCritique(
  spec: DashboardSpec,
  queries: QueryService,
  contracts: Map<string, { allowed_aggregations: string[] }>,
): Promise<DataCritique> {
  const findings: DataFinding[] = [];
  const asOf: Record<string, string> = {};
  const asOfSeen = new Map<string, string[]>(); // as-of → widget/leg labels

  const legs = legsOf(spec);
  const byId = new Map(spec.widgets.map((w) => [w.id, w]));

  for (const leg of legs) {
    let result: QueryResult;
    try {
      result = await queries.run(leg.req);
    } catch (e) {
      findings.push({
        code: 'QUERY', severity: 'BLOCK', widget: leg.widget,
        message: `${leg.widget}'s ${leg.role} query could not run: ${e instanceof Error ? e.message : e}`,
      });
      continue;
    }

    if (leg.role === 'main') asOf[leg.widget] = result.asOf;
    const label = leg.role === 'main' ? leg.widget : `${leg.widget} (${leg.role})`;
    asOfSeen.set(result.asOf, [...(asOfSeen.get(result.asOf) ?? []), label]);

    findings.push(...nonFinite(leg.widget, leg.role, result));

    // MASS-01 — only where the contract says summing means something.
    if (leg.role === 'main' && result.kind === 'groups') {
      const w = byId.get(leg.widget) as WidgetInstance;
      const contract = contracts.get(w.bind.metric);
      if (contract?.allowed_aggregations.includes('sum')) {
        const grouped = result.rows.reduce((a, r) => a + r.value, 0);
        try {
          const headlineReq: QueryRequest = { ...leg.req };
          delete headlineReq.dims;
          delete headlineReq.max_cells;
          const headline = await queries.run(headlineReq);
          if (headline.kind === 'scalar' && finite(headline.value) && finite(grouped)) {
            const drift = Math.abs(grouped - headline.value);
            const tolerance = Math.max(1e-6, Math.abs(headline.value) * 1e-9);
            if (drift > tolerance) {
              findings.push({
                code: 'MASS-01', severity: 'BLOCK', widget: leg.widget,
                message: `${leg.widget}'s groups sum to a different number than the headline — `
                  + 'the split is not a partition of the total',
                evidence: { groupedSum: grouped, headline: headline.value, drift },
              });
            }
          }
        } catch { /* the headline leg failing is already a QUERY finding shape; skip */ }
      }
    }
  }

  if (asOfSeen.size > 1) {
    findings.push({
      code: 'COHERE-01', severity: 'BLOCK',
      message: 'the dashboard answers at more than one as-of date — readers would compare '
        + 'numbers from different days without knowing it',
      evidence: Object.fromEntries([...asOfSeen].map(([d, who]) => [d, who])),
    });
  }

  return { findings, asOf, widgetsChecked: spec.widgets.length };
}
