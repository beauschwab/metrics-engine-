/**
 * The widget-states harness (#/widgets) — every widget in every state from
 * canned data, in the shipping bundle (ADR-7). This page *is* the catalog's
 * design-review surface: a proposed widget lands here first, and the e2e
 * suite walks it so a broken empty-state is a red build, not a surprise.
 */

import type { WidgetInstance } from 'chartroom-spec';
import {
  Bar, DeltaTable, KpiTile, PerspectiveGrid, Timeseries,
  type WidgetData, type WidgetProps, type WidgetStatus,
} from 'chartroom-widgets';

const DATES = Array.from({ length: 30 }, (_, i) =>
  `2025-07-${String(i + 1).padStart(2, '0')}`);

const wave = (base: number, amp: number) =>
  DATES.map((date, i) => ({ date, value: base + amp * Math.sin(i / 4) + i * amp * 0.02 }));

const instance = (type: string, bind: Partial<WidgetInstance['bind']> = {}): WidgetInstance => ({
  id: 'harness', type: type as WidgetInstance['type'],
  pos: { x: 0, y: 0, w: 4, h: 3 },
  bind: { metric: 'keel://liquidity_pit.lcr_pct@1', ...bind },
});

const kpiData: WidgetData = {
  unit: 'percent', format: 'percent_1dp', asOf: DATES.at(-1)!,
  scalar: { value: 98.3, prior: 99.8 },
  compare: { label: 'lcr_floor', value: 100, style: 'threshold' },
};

const seriesData: WidgetData = {
  unit: 'percent', format: 'percent_1dp', asOf: DATES.at(-1)!,
  series: [
    { key: { entity_id: 'WF-US' }, points: wave(112, 4) },
    { key: { entity_id: 'WF-EMEA' }, points: wave(103, 5) },
  ],
  bands: [{ label: 'lcr_floor', points: DATES.map((date) => ({ date, value: 100 })) }],
};

const groupData: WidgetData = {
  unit: 'USD', format: 'currency_usd', asOf: DATES.at(-1)!,
  rows: [
    { key: { bucket_code: 'O/N' }, value: 4.1e8, prior: 3.9e8 },
    { key: { bucket_code: '2-7D' }, value: 2.7e8, prior: 2.9e8 },
    { key: { bucket_code: '8-30D' }, value: 6.3e8, prior: 6.1e8 },
  ],
  ordinalDim: true,
};

const pivotData: WidgetData = {
  unit: 'USD', format: 'currency_usd', asOf: DATES.at(-1)!,
  rows: ['WF-US', 'WF-EMEA'].flatMap((e) =>
    ['O/N', '2-7D'].map((b, i) => ({
      key: { entity_id: e, bucket_code: b }, value: (i + 1) * 1.7e8, prior: (i + 1) * 1.6e8,
    }))),
};

const WIDGETS: Array<{ name: string; component: React.FC<WidgetProps>; data: WidgetData; bind?: Partial<WidgetInstance['bind']> }> = [
  { name: 'kpi-tile@1', component: KpiTile, data: kpiData, bind: { compare: { vs: 'prior_period', style: 'delta' } } },
  { name: 'timeseries@1', component: Timeseries, data: seriesData, bind: { dims: ['as_of_date'] } },
  { name: 'bar@1', component: Bar, data: groupData, bind: { dims: ['bucket_code'] } },
  { name: 'delta-table@1', component: DeltaTable, data: groupData, bind: { dims: ['bucket_code'] } },
  { name: 'perspective-grid@1', component: PerspectiveGrid, data: pivotData, bind: { dims: ['entity_id', 'bucket_code'], max_cells: 50_000 } },
];

const STATES: WidgetStatus[] = ['fresh', 'loading', 'stale', 'error', 'empty'];

export function Harness() {
  return (
    <div className="cr-harness" data-testid="harness">
      <header className="cr-header">
        <span className="cr-brand">Chartroom</span>
        <span className="cr-header-title">widget states — the catalog’s review surface</span>
        <span className="cr-header-spacer" />
        <a className="cr-link" href="#/">back to the studio</a>
      </header>
      {WIDGETS.map(({ name, component: Component, data, bind }) => (
        <section key={name} className="cr-harness-row" data-testid={`harness-${name.split('@')[0]}`}>
          <h2 className="cr-side-head">{name}</h2>
          <div className="cr-harness-states">
            {STATES.map((status) => (
              <div key={status} className="cr-harness-cell">
                <span className="cr-harness-state">{status}</span>
                <div className="cr-frame" data-status={status}>
                  <div className="cr-frame-body">
                    <Component
                      instance={instance(name, bind)}
                      data={status === 'fresh' || status === 'stale' ? data : status === 'empty' ? { ...data, scalar: undefined, rows: [], series: [] } : null}
                      status={status}
                      error={status === 'error' ? 'the registry refused this slice' : undefined}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
