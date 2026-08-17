/**
 * stacked-area@1 — part-to-whole over time.
 *
 * Bands are stacked in a stable order (the series order the query returned,
 * not magnitude) because a band that jumps rows between renders is unreadable
 * even when every number is right. The top edge of the stack is the total,
 * drawn as a line so the whole is legible without adding the parts by eye.
 *
 * AREA-01 is what keeps this honest: stacking only means something when the
 * measure is additive and nonnegative, and that check lives in the linter
 * rather than here — a renderer that silently drops negative bands would be
 * hiding exactly the thing the reader needs to see.
 */

import type { WidgetProps } from './types';
import { formatDate, formatTick } from './format';
import { ticks, xPos, yExtent, yPos } from './scale';

const W = 600;
const H = 240;
const PAD = { l: 54, r: 10, t: 10, b: 22 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

export function StackedArea({ data, status, error }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-chart" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const lines = data?.series ?? [];
  if (!lines.length || !lines[0].points.length) {
    return <div className="cr-widget-empty">no points in the window</div>;
  }

  const dates = lines[0].points.map((p) => p.date);
  const n = dates.length;

  // Running cumulative tops, one row per band. A non-finite point contributes
  // nothing rather than poisoning the whole stack above it.
  const tops: number[][] = [];
  const running = new Array<number>(n).fill(0);
  lines.forEach((line) => {
    for (let i = 0; i < n; i++) {
      const v = line.points[i]?.value;
      running[i] += Number.isFinite(v) ? Math.max(0, v) : 0;
    }
    tops.push([...running]);
  });

  const e = yExtent([0, ...running], data!.format);
  const totals = tops[tops.length - 1];

  // Each band is the area between its own top and the band below it, closed
  // by walking the lower edge backwards.
  const bandPath = (i: number): string => {
    const upper = tops[i];
    const lower = i === 0 ? new Array<number>(n).fill(0) : tops[i - 1];
    const fwd = upper.map((v, j) => `${xPos(j, n, IW).toFixed(2)},${yPos(v, e, IH).toFixed(2)}`);
    const back = lower
      .map((v, j) => `${xPos(j, n, IW).toFixed(2)},${yPos(v, e, IH).toFixed(2)}`)
      .reverse();
    return `M${fwd.join('L')}L${back.join('L')}Z`;
  };

  const label = (i: number) => Object.values(lines[i].key).join(' · ') || `band ${i + 1}`;

  return (
    <div className="cr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="stacked area">
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          {ticks(e).map((t) => (
            <g key={t}>
              <line className="cr-gridline" x1={0} x2={IW} y1={yPos(t, e, IH)} y2={yPos(t, e, IH)} />
              <text className="cr-axis-label" x={-6} y={yPos(t, e, IH) + 3} textAnchor="end">
                {formatTick(t, data!.format)}
              </text>
            </g>
          ))}
          {lines.map((_, i) => (
            <path
              key={label(i)}
              className="cr-area"
              style={{ fill: `var(--cr-s${i % 8})` }}
              d={bandPath(i)}
            />
          ))}
          {/* The total, so the whole reads without summing the parts by eye. */}
          <path
            className="cr-area-total"
            d={`M${totals.map((v, j) => `${xPos(j, n, IW).toFixed(2)},${yPos(v, e, IH).toFixed(2)}`).join('L')}`}
          />
          <text className="cr-axis-label" x={0} y={IH + 14}>{formatDate(dates[0])}</text>
          <text className="cr-axis-label" x={IW} y={IH + 14} textAnchor="end">
            {formatDate(dates[n - 1])}
          </text>
        </g>
      </svg>
      <div className="cr-legend">
        {lines.map((_, i) => (
          <span key={label(i)} className="cr-legend-item">
            <span className="cr-legend-swatch" style={{ background: `var(--cr-s${i % 8})` }} />
            {label(i)}
          </span>
        ))}
      </div>
    </div>
  );
}
