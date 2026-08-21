/**
 * timeseries@1 — lines over the daily series, bands drawn first so data sits
 * on top of its references, never under them. Pure SVG (ADR-8): axes, three
 * gridlines, first/last date labels, a legend only when there is more than
 * one line to tell apart.
 */

import { parseMetricRef } from 'chartroom-spec';
import type { SeriesLine, WidgetProps } from './types';
import { formatDate, formatTick } from './format';
import { linePath, ticks, yExtent, yPos } from './scale';

const W = 600;
const H = 240;
const PAD = { l: 54, r: 10, t: 10, b: 22 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

export function Timeseries({ instance, data, status, error }: WidgetProps) {
  // An unsplit series is named after its measure, not the word "value" — the
  // legend exists to identify lines, and "value" identifies nothing.
  const seriesLabel = (line: SeriesLine): string =>
    Object.values(line.key).join(' · ')
    || parseMetricRef(instance.bind.metric)?.measure
    || 'value';
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-chart" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const lines = data?.series ?? [];
  if (!lines.length || !lines[0].points.length) {
    return <div className="cr-widget-empty">no points in the window</div>;
  }

  const all = [
    ...lines.flatMap((l) => l.points.map((p) => p.value)),
    ...(data!.bands ?? []).flatMap((b) => b.points.map((p) => p.value)),
  ];
  const e = yExtent(all, data!.format);
  const dates = lines[0].points.map((p) => p.date);

  return (
    <div className="cr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="time series">
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          {ticks(e).map((t) => (
            <g key={t}>
              <line className="cr-gridline" x1={0} x2={IW} y1={yPos(t, e, IH)} y2={yPos(t, e, IH)} />
              <text className="cr-axis-label" x={-6} y={yPos(t, e, IH) + 3} textAnchor="end">
                {formatTick(t, data!.format)}
              </text>
            </g>
          ))}
          {(data!.bands ?? []).map((band, i) => (
            <path
              key={`band-${i}`}
              className="cr-band"
              d={linePath(band.points.map((p) => p.value), e, IW, IH)}
            />
          ))}
          {lines.map((line, i) => (
            <path
              key={seriesLabel(line)}
              className="cr-line"
              style={{ stroke: `var(--cr-s${i % 8})` }}
              d={linePath(line.points.map((p) => p.value), e, IW, IH)}
            />
          ))}
          <text className="cr-axis-label" x={0} y={IH + 14}>{formatDate(dates[0])}</text>
          <text className="cr-axis-label" x={IW} y={IH + 14} textAnchor="end">
            {formatDate(dates[dates.length - 1])}
          </text>
        </g>
      </svg>
      {(lines.length > 1 || (data!.bands ?? []).length > 0) && (
        <div className="cr-legend">
          {lines.map((line, i) => (
            <span key={seriesLabel(line)} className="cr-legend-item">
              <span className="cr-legend-swatch" style={{ background: `var(--cr-s${i % 8})` }} />
              {seriesLabel(line)}
            </span>
          ))}
          {(data!.bands ?? []).map((b) => (
            <span key={b.label} className="cr-legend-item cr-legend-band">
              <span className="cr-legend-swatch cr-legend-swatch-band" />
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
