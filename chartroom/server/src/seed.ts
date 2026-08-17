/**
 * The E1.5 dogfood dashboards — hand-authored against the real registry
 * functions, seeded on first boot so the studio opens onto something true.
 *
 * Metric refs are stamped with the revision the workspace actually holds at
 * seed time: a template that hardcoded `@1` would silently unresolve the
 * moment an author saved a document. The DSL gaps these two surfaced are
 * ADR-14/15/16.
 */

import type { DashboardSpec } from 'chartroom-spec';
import { lint, parseSpec, type LintContext } from 'chartroom-spec';
import { CATALOG_BY_REF } from 'chartroom-widgets/contracts';
import { deriveContracts, type RegistryState } from './keel';
import { ChartroomRepository } from './repository';

/**
 * The EMEA liquidity monitor — the PRD's own worked example, restated against
 * the measures this registry really carries (the PRD's `hqla_by_level` does
 * not exist here; the outflow decomposition by maturity bucket is what the
 * FR 2052a view governs — ADR-14 tells that story).
 */
function lcrMonitor(rev: (doc: string) => number): DashboardSpec {
  const lp = (m: string) => `keel://liquidity_pit.${m}@${rev('liquidity_pit')}`;
  const of = (m: string) => `keel://fr2052a_outflows.${m}@${rev('fr2052a_outflows')}`;
  return {
    chartroom: '0.1',
    dashboard: {
      id: 'lcr-monitor',
      title: 'Liquidity Coverage Monitor',
      pattern: { none: { justification: 'seeded before a pattern catalog exists (Phase 2); the shape follows the PRD Liquidity Monitor archetype' } },
      audience: 'alm-analyst',
      cadence: 'eod',
      status: 'draft',
    },
    context: {},
    layout: { grid: { cols: 12, row_height: 96 } },
    widgets: [
      {
        id: 'lcr-tile', type: 'kpi-tile@1', title: 'LCR', pos: { x: 0, y: 0, w: 3, h: 2 },
        bind: { metric: lp('lcr_pct'), compare: { vs: 'prior_period', style: 'delta' } },
        format: { emphasis: 'semantic' },
      },
      {
        id: 'headroom-tile', type: 'kpi-tile@1', title: 'Headroom above 100%',
        pos: { x: 0, y: 2, w: 3, h: 2 },
        bind: { metric: lp('lcr_headroom'), compare: { vs: 'prior_period', style: 'delta' } },
      },
      {
        id: 'lcr-trend', type: 'timeseries@1', title: 'LCR, trailing 60 days',
        pos: { x: 3, y: 0, w: 9, h: 4 },
        bind: {
          metric: lp('lcr_pct'), dims: ['as_of_date'], window: { trailing: '60d' },
          bands: [lp('lcr_stress')],
        },
        format: { emphasis: 'semantic' },
      },
      {
        id: 'outflow-buckets', type: 'bar@1', title: 'Weighted outflows by maturity',
        pos: { x: 0, y: 4, w: 6, h: 3 },
        bind: { metric: of('weighted_outflows_30d'), dims: ['maturity_bucket'] },
      },
      {
        id: 'outflow-grid', type: 'perspective-grid@1', title: 'Outflows · entity × product',
        pos: { x: 6, y: 4, w: 6, h: 3 },
        bind: {
          metric: of('weighted_outflows_30d'), dims: ['entity_id', 'product_id'],
          max_cells: 50_000,
        },
      },
    ],
    interactions: [],
  };
}

/**
 * The limit board — utilisation tiles plus the day-over-day decomposition.
 * `compare.vs` binds governed measures, not literals: the floor arithmetic
 * lives in `lcr_shortfall`/`lcr_headroom`'s governed expressions (ADR-14).
 */
function limitBoard(rev: (doc: string) => number): DashboardSpec {
  const lp = (m: string) => `keel://liquidity_pit.${m}@${rev('liquidity_pit')}`;
  return {
    chartroom: '0.1',
    dashboard: {
      id: 'limit-board',
      title: 'LCR Limit Board',
      pattern: { none: { justification: 'seeded before a pattern catalog exists (Phase 2); the shape follows the PRD Limit Utilization archetype' } },
      audience: 'treasury-committee',
      cadence: 'eod',
      status: 'draft',
    },
    context: {},
    layout: { grid: { cols: 12, row_height: 96 } },
    widgets: [
      {
        id: 'shortfall-tile', type: 'kpi-tile@1', title: 'Shortfall below minimum',
        pos: { x: 0, y: 0, w: 3, h: 2 },
        bind: { metric: lp('lcr_shortfall'), compare: { vs: 'prior_period', style: 'delta' } },
        format: { emphasis: 'semantic' },
      },
      {
        id: 'vol-tile', type: 'kpi-tile@1', title: 'LCR volatility, 30d',
        pos: { x: 3, y: 0, w: 3, h: 2 },
        bind: { metric: lp('lcr_vol_30d'), compare: { vs: 'prior_period', style: 'delta' } },
      },
      {
        id: 'dod-tile', type: 'kpi-tile@1', title: 'Day-over-day move',
        pos: { x: 6, y: 0, w: 3, h: 2 },
        bind: { metric: lp('lcr_dod_change'), compare: { vs: 'prior_period', style: 'delta' } },
      },
      {
        id: 'stress-tile', type: 'kpi-tile@1', title: 'LCR under stress haircut',
        pos: { x: 9, y: 0, w: 3, h: 2 },
        bind: { metric: lp('lcr_stress'), compare: { vs: 'prior_period', style: 'delta' } },
        format: { emphasis: 'semantic' },
      },
      {
        id: 'entity-table', type: 'delta-table@1', title: 'HQLA by entity, day over day',
        pos: { x: 0, y: 2, w: 12, h: 3 },
        // Neutral emphasis: COL-03 reserves the semantic palette for widgets
        // with a declared threshold, and this table judges only against prior.
        bind: { metric: lp('hqla_total'), dims: ['entity_id'] },
      },
    ],
    interactions: [],
  };
}

/** Seed both boards if the repository is empty. Lint runs exactly as a save would. */
export async function seedDogfood(
  repo: ChartroomRepository,
  state: RegistryState,
): Promise<string[]> {
  const existing = await repo.dashboards();
  if (existing.length) return [];

  const revs = new Map(state.docs.map((d) => [d.name, d.revision]));
  const rev = (doc: string) => revs.get(doc) ?? 1;
  const set = deriveContracts(state);
  const ctx: LintContext = { contracts: set.byRef, widgets: CATALOG_BY_REF };

  const seeded: string[] = [];
  for (const spec of [lcrMonitor(rev), limitBoard(rev)]) {
    const parsed = parseSpec(spec);
    if (!parsed.ok) throw new Error(`seed spec invalid: ${parsed.problems.join('; ')}`);
    await repo.create({
      id: spec.dashboard.id, title: spec.dashboard.title, owner: 'seed', actor: 'seed',
    });
    await repo.saveVersion({
      dashboardId: spec.dashboard.id,
      spec: parsed.spec,
      lintReport: lint(parsed.spec, ctx),
      author: 'seed',
      actor: 'seed',
      expectedVersion: null,
    });
    seeded.push(spec.dashboard.id);
  }
  return seeded;
}
