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
import { CATALOG, CATALOG_BY_REF } from 'chartroom-widgets/contracts';
import { PATTERNS } from 'chartroom-patterns';
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

/**
 * The variance walk (Phase 9) — the first dogfood board built on a shipped
 * *pattern* rather than a `none` justification, and the acceptance case for
 * E9.1–E9.3: a bridge, its drivers on a shared scale, and the written reason,
 * all bound to governed measures.
 *
 * The bridge deliberately carries no filters. WF-01 warns about a filtered
 * walk because the excluded rows vanish into the gap between the two totals,
 * and a seeded board that trips its own rule would teach exactly the wrong
 * lesson on first boot.
 */
function varianceWalk(rev: (doc: string) => number): DashboardSpec {
  const of = (m: string) => `keel://fr2052a_outflows.${m}@${rev('fr2052a_outflows')}`;
  return {
    chartroom: '0.1',
    dashboard: {
      id: 'outflow-walk',
      title: 'Weighted Outflows — Variance Walk',
      pattern: 'variance-walk@1',
      audience: 'treasury-committee',
      cadence: 'eod',
      status: 'draft',
    },
    context: {},
    layout: { grid: { cols: 12, row_height: 96 } },
    widgets: [
      {
        id: 'outflow-bridge', type: 'waterfall@1',
        title: 'What moved weighted outflows, day over day',
        pos: { x: 0, y: 0, w: 12, h: 4 },
        bind: { metric: of('weighted_outflows_30d'), dims: ['maturity_bucket'] },
      },
      {
        id: 'bucket-drivers', type: 'small-multiples@1',
        title: 'Each bucket over the trailing 30 days',
        pos: { x: 0, y: 4, w: 8, h: 4 },
        bind: {
          metric: of('weighted_outflows_30d'),
          dims: ['as_of_date', 'maturity_bucket'],
          window: { trailing: '30d' },
        },
      },
      {
        id: 'walk-commentary', type: 'annotation@1', title: 'Reading',
        pos: { x: 8, y: 4, w: 4, h: 4 },
        bind: { metric: of('weighted_outflows_30d') },
        note: 'The move is concentrated in the short buckets, where run-off '
          + 'rates are highest — so a small shift in balances moves the weighted '
          + 'total more than the same shift further out the ladder. Read the '
          + 'bridge with the panels: a step that looks like a one-day shock is '
          + 'often a trend that has been building all week.',
      },
    ],
    interactions: [],
  };
}

/**
 * Seed the widget and pattern catalogs from the shipped code constants
 * (E10.1, ADR-46).
 *
 * Runs on every boot and is additive only: an entry already in the table is
 * left exactly as it is. That asymmetry is deliberate — once a contract is in
 * the catalog it has been reviewed, and a deploy quietly rewriting it would
 * make the table's history a lie. New code entries (a widget that ships in a
 * later phase) appear on the next boot; changed ones need a proposal, same as
 * anybody else's.
 */
export async function seedCatalog(repo: ChartroomRepository): Promise<string[]> {
  return repo.seedCatalog([
    ...CATALOG.map((c) => ({
      kind: 'widget' as const, name: c.widget, version: c.version, body: c,
    })),
    ...PATTERNS.map((p) => ({
      kind: 'pattern' as const, name: p.pattern, version: p.version, body: p,
    })),
  ]);
}

/** Seed the boards if the repository is empty. Lint runs exactly as a save would. */
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
  for (const spec of [lcrMonitor(rev), limitBoard(rev), varianceWalk(rev)]) {
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
