/**
 * The Evil Charts widgets (ADR-92): each signs the widget contract — resolved
 * data in, a chart out, never a fetch — and draws with the landed Evil Charts
 * module its gallery entry names. What the library brings is the drawing:
 * fills, strokes, curves, motion. What stays the board's is everything a
 * reader trusts: numbers format through the widgets' formatter (ADR-29), in
 * the tooltip too; colours are the series tokens (COL-03); order is BAR-02's;
 * and a chart that cannot draw its data honestly says why instead (ADR-44/45).
 */

import type { ReactNode } from 'react';
import { formatDate, formatTick, formatValue, type WidgetData, type WidgetProps } from 'chartroom-widgets';
import { ValueFormatContext } from './evilcharts/ui/recharts-chart';
import type { BackgroundVariant } from './evilcharts/ui/recharts-background';
import { EvilBarChart } from './evilcharts/charts/recharts-bar-chart';
import { EvilComposedChart } from './evilcharts/charts/recharts-composed-chart';
import { EvilLineChart } from './evilcharts/charts/recharts-line-chart';
import { EvilAreaChart } from './evilcharts/charts/recharts-area-chart';
import { EvilPieChart } from './evilcharts/charts/recharts-pie-chart';
import { EvilRadialChart } from './evilcharts/charts/recharts-radial-chart';
import { EvilRadarChart } from './evilcharts/charts/recharts-radar-chart';
import { EvilSankeyChart } from './evilcharts/charts/recharts-sankey-chart';
import { chartOptions } from './options';
import {
  categoryTable, configFor, flowTable, isRefusal, partsTable, priorTable, seriesColor, timeTable, type Refusal,
} from './shape';

type Options = Record<string, string>;
// The option lists are the libraries' own unions; `chartOptions` only ever returns a listed value.
const as = <T,>(v: string) => v as unknown as T;
const background = (o: Options) => (o.background && o.background !== 'none' ? as<BackgroundVariant>(o.background) : undefined);
const on = (v: string | undefined) => v === 'on';

/** The chart fills the frame: the library's 16:9 box is the frame's box here. */
const FILL = 'h-full w-full aspect-auto';

/**
 * The states every widget shares, then the chart: loading, a failed query, no
 * rows, a refusal — and only then the drawing, with the board's number format
 * in the tooltip's hands.
 */
function ChartFrame({
  props, empty, draw,
}: {
  props: WidgetProps;
  empty: (data: WidgetData) => boolean;
  draw: (data: WidgetData, options: Options) => ReactNode | Refusal;
}) {
  const { instance, data, status, error } = props;
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-chart" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  if (!data || empty(data)) return <div className="cr-widget-empty">no groups match</div>;
  const out = draw(data, chartOptions(instance.type, instance.state));
  if (isRefusal(out)) return <div className="cr-widget-error" role="note" data-slot="chart-refused">{out.refused}</div>;
  const fmt = (v: number) => formatValue(v, data.format, instance.format?.decimals);
  return (
    <ValueFormatContext.Provider value={fmt}>
      <div className="flex h-full min-h-0 w-full flex-col" data-slot="evil-chart" data-type={instance.type}>{out}</div>
    </ValueFormatContext.Provider>
  );
}

const noRows = (d: WidgetData) => !d.rows?.length;
const noSeries = (d: WidgetData) => !d.series?.length;
const tick = (data: WidgetData) => (v: number) => formatTick(v, data.format);
const share = (v: number) => `${Math.round(v * 100)}%`;
const AXIS_WIDTH = 64;
const CATEGORY_WIDTH = 96;

// ---- bars -------------------------------------------------------------------

function bars(props: WidgetProps, stacked: boolean) {
  const { instance } = props;
  return (
    <ChartFrame
      props={props}
      empty={noRows}
      draw={(data, o) => {
        const dims = (instance.bind.dims ?? []).filter((d) => d !== 'as_of_date');
        // A stack's dims lead with the parts (PIE-01 judges the first); the axis is the other.
        const t = stacked ? categoryTable(instance, data, dims[1], dims[0]) : categoryTable(instance, data);
        if (stacked) {
          const neg = t.rows.find((r) => t.series.some((s) => (r[s.key] as number) < 0));
          if (neg) return { refused: `${neg.category} has a negative part; a stack cannot draw a part below nothing` };
        }
        const horizontal = o.layout === 'horizontal';
        const percent = stacked && o.stack === 'percent';
        const valueTick = percent ? share : tick(data);
        return (
          <EvilBarChart
            className={FILL}
            data={t.rows}
            config={configFor(t.series)}
            layout={as(o.layout ?? 'vertical')}
            stackType={stacked ? as(o.stack ?? 'stacked') : 'default'}
            backgroundVariant={background(o)}
          >
            <EvilBarChart.Grid />
            {horizontal
              ? (<>
                <EvilBarChart.XAxis tickFormatter={valueTick} />
                <EvilBarChart.YAxis dataKey="category" width={CATEGORY_WIDTH} />
              </>)
              : (<>
                <EvilBarChart.XAxis dataKey="category" />
                <EvilBarChart.YAxis tickFormatter={valueTick} width={AXIS_WIDTH} />
              </>)}
            <EvilBarChart.Tooltip />
            {t.series.length > 1 && <EvilBarChart.Legend variant={as(o.legend ?? 'rounded-square')} />}
            {t.series.map((s) => (
              <EvilBarChart.Bar key={s.key} dataKey={s.key} variant={as(o.variant ?? 'default')} glowing={on(o.glow)} />
            ))}
          </EvilBarChart>
        );
      }}
    />
  );
}

export const EvilBarWidget = (props: WidgetProps) => bars(props, false);
export const EvilStackedBarWidget = (props: WidgetProps) => bars(props, true);

/** Today as bars, the prior close as a line: the move per group without a second axis. */
export function EvilComposedWidget(props: WidgetProps) {
  const { instance } = props;
  return (
    <ChartFrame
      props={props}
      empty={noRows}
      draw={(data, o) => {
        const rows = priorTable(instance, data);
        const config = {
          value: { label: `as of ${data.asOf}`, colors: { light: [seriesColor(0)] } },
          prior: { label: 'prior close', colors: { light: [seriesColor(6)] } },
        };
        return (
          <EvilComposedChart className={FILL} data={rows} config={config} curveType={as(o.curve ?? 'monotone')}>
            <EvilComposedChart.Grid />
            <EvilComposedChart.XAxis dataKey="category" />
            <EvilComposedChart.YAxis tickFormatter={tick(data)} width={AXIS_WIDTH} />
            <EvilComposedChart.Tooltip />
            <EvilComposedChart.Legend variant="rounded-square" />
            <EvilComposedChart.Bar dataKey="value" variant={as(o.variant ?? 'default')} />
            <EvilComposedChart.Line dataKey="prior" strokeVariant={as(o.stroke ?? 'dashed')} />
          </EvilComposedChart>
        );
      }}
    />
  );
}

// ---- over time ----------------------------------------------------------------

export function EvilLineWidget(props: WidgetProps) {
  const { instance } = props;
  return (
    <ChartFrame
      props={props}
      empty={noSeries}
      draw={(data, o) => {
        const t = timeTable(instance, data);
        return (
          <EvilLineChart className={FILL} data={t.rows} config={configFor(t.series)} curveType={as(o.curve ?? 'monotone')}>
            <EvilLineChart.Grid />
            <EvilLineChart.XAxis dataKey="date" tickFormatter={formatDate} />
            <EvilLineChart.YAxis tickFormatter={tick(data)} width={AXIS_WIDTH} />
            <EvilLineChart.Tooltip />
            {t.series.length > 1 && <EvilLineChart.Legend variant={as(o.legend ?? 'rounded-square')} />}
            {t.series.map((s) => (
              <EvilLineChart.Line key={s.key} dataKey={s.key} strokeVariant={as(o.stroke ?? 'solid')} glowing={on(o.glow)}>
                {o.dots && o.dots !== 'none' && <EvilLineChart.Dot variant={as(o.dots)} />}
                <EvilLineChart.ActiveDot variant="colored-border" />
              </EvilLineChart.Line>
            ))}
          </EvilLineChart>
        );
      }}
    />
  );
}

function areas(props: WidgetProps, stacked: boolean) {
  const { instance } = props;
  return (
    <ChartFrame
      props={props}
      empty={noSeries}
      draw={(data, o) => {
        const t = timeTable(instance, data);
        if (stacked) {
          const neg = t.series.find((s) => t.rows.some((r) => typeof r[s.key] === 'number' && (r[s.key] as number) < 0));
          if (neg) return { refused: `${neg.label} goes negative in the window; a stack cannot draw a part below nothing` };
        }
        const expanded = stacked && o.stack === 'expanded';
        return (
          <EvilAreaChart
            className={FILL}
            data={t.rows}
            config={configFor(t.series)}
            curveType={as(o.curve ?? 'monotone')}
            stackType={stacked ? as(o.stack ?? 'stacked') : 'default'}
          >
            <EvilAreaChart.Grid />
            <EvilAreaChart.XAxis dataKey="date" tickFormatter={formatDate} />
            <EvilAreaChart.YAxis tickFormatter={expanded ? share : tick(data)} width={AXIS_WIDTH} />
            <EvilAreaChart.Tooltip />
            {t.series.length > 1 && <EvilAreaChart.Legend variant={as(o.legend ?? 'rounded-square')} />}
            {t.series.map((s) => (
              <EvilAreaChart.Area key={s.key} dataKey={s.key} variant={as(o.variant ?? 'gradient')} strokeVariant={as(o.stroke ?? 'solid')} />
            ))}
          </EvilAreaChart>
        );
      }}
    />
  );
}

export const EvilAreaWidget = (props: WidgetProps) => areas(props, false);
export const EvilStackedAreaWidget = (props: WidgetProps) => areas(props, true);

// ---- parts and spokes ---------------------------------------------------------

export function EvilPieWidget(props: WidgetProps) {
  const { instance } = props;
  return (
    <ChartFrame
      props={props}
      empty={noRows}
      draw={(data, o) => {
        const t = partsTable(instance, data, 'pie');
        if (isRefusal(t)) return t;
        if (t.rows.every((r) => r.value === 0)) return { refused: 'every part is zero; there is no whole to share' };
        const donut = o.shape !== 'pie';
        const padded = o.padding !== 'none';
        return (
          <EvilPieChart className={FILL} data={t.rows} dataKey="value" nameKey="name" config={configFor(t.series)}>
            <EvilPieChart.Tooltip />
            <EvilPieChart.Legend variant={as(o.legend ?? 'rounded-square')} />
            <EvilPieChart.Pie innerRadius={donut ? '55%' : 0} paddingAngle={padded ? 3 : 0} cornerRadius={padded ? 4 : 0}>
              {on(o.labels) && <EvilPieChart.Label dataKey="label" />}
            </EvilPieChart.Pie>
          </EvilPieChart>
        );
      }}
    />
  );
}

export function EvilRadialWidget(props: WidgetProps) {
  const { instance } = props;
  return (
    <ChartFrame
      props={props}
      empty={noRows}
      draw={(data, o) => {
        const t = partsTable(instance, data, 'radial bar');
        if (isRefusal(t)) return t;
        return (
          <EvilRadialChart className={FILL} data={t.rows} nameKey="name" config={configFor(t.series)} variant={as(o.arc ?? 'full')}>
            <EvilRadialChart.Tooltip />
            <EvilRadialChart.Legend variant={as(o.legend ?? 'rounded-square')} />
            <EvilRadialChart.RadialBar dataKey="value" showBackground={o.track !== 'off'} />
          </EvilRadialChart>
        );
      }}
    />
  );
}

export function EvilRadarWidget(props: WidgetProps) {
  const { instance } = props;
  return (
    <ChartFrame
      props={props}
      empty={noRows}
      draw={(data, o) => {
        const t = categoryTable(instance, data);
        if (t.rows.length < 3) return { refused: `a radar needs three spokes or more; there ${t.rows.length === 1 ? 'is' : 'are'} ${t.rows.length}` };
        return (
          <EvilRadarChart className={FILL} data={t.rows} config={configFor(t.series)} backgroundVariant={background(o)}>
            <EvilRadarChart.PolarGrid gridType={as(o.grid ?? 'polygon')} />
            <EvilRadarChart.PolarAngleAxis dataKey="category" />
            <EvilRadarChart.Tooltip />
            {t.series.length > 1 && <EvilRadarChart.Legend variant={as(o.legend ?? 'rounded-square')} />}
            {t.series.map((s) => (
              <EvilRadarChart.Radar key={s.key} dataKey={s.key} variant={as(o.variant ?? 'filled')} isGlowing={on(o.glow)}>
                {o.dots && o.dots !== 'none' && <EvilRadarChart.Dot variant={as(o.dots)} />}
              </EvilRadarChart.Radar>
            ))}
          </EvilRadarChart>
        );
      }}
    />
  );
}

export function EvilSankeyWidget(props: WidgetProps) {
  const { instance } = props;
  return (
    <ChartFrame
      props={props}
      empty={noRows}
      draw={(data, o) => {
        const t = flowTable(instance, data);
        if (isRefusal(t)) return t;
        if (t.links.length === 0) return { refused: 'nothing flows: every pair is zero' };
        const fmt = (v: number) => formatValue(v, data.format, instance.format?.decimals);
        return (
          <EvilSankeyChart
            className={FILL}
            data={{ nodes: t.nodes, links: t.links }}
            config={configFor(t.series)}
            // Outside labels sit to the right of every node, the last column's too: leave them room.
            sankeyProps={{ margin: { top: 4, bottom: 4, left: 4, right: o.labels === 'inside' ? 4 : 112 } }}
          >
            <EvilSankeyChart.Node>
              <EvilSankeyChart.NodeLabel position={as(o.labels ?? 'outside')} showValues={o.values !== 'off'} valueFormatter={fmt} />
            </EvilSankeyChart.Node>
            <EvilSankeyChart.Link variant={as(o.link ?? 'gradient')} />
            <EvilSankeyChart.Tooltip />
          </EvilSankeyChart>
        );
      }}
    />
  );
}
