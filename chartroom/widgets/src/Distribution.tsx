/**
 * distribution@1 — the shape of the groups, not their names.
 *
 * A sorted bar chart answers "which is biggest"; it answers "is this one
 * outlier or a fat tail" only by counting bars, which nobody does. This bins
 * the group values and marks the median, so spread and skew are visible
 * directly.
 *
 * Bin count follows Sturges' rule, bounded — a fixed bin count lies about
 * small samples (ten groups in twenty bins is a picket fence) and hides
 * structure in large ones.
 */

import type { WidgetProps } from './types';
import { formatTick, formatValue } from './format';

const H = 200;
const PAD = { l: 8, r: 8, t: 10, b: 34 };

export function Distribution({ instance, data, status, error }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-chart" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const rows = data?.rows ?? [];
  const values = rows.map((r) => r.value).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!values.length) return <div className="cr-widget-empty">no groups match</div>;

  const min = values[0];
  const max = values[values.length - 1];
  const mid = values.length % 2
    ? values[(values.length - 1) / 2]
    : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;

  // Sturges, bounded: enough bins to show a shape, never more than the data
  // can support.
  const bins = Math.max(3, Math.min(12, Math.ceil(Math.log2(values.length) + 1)));
  const span = max - min || Math.abs(max) || 1;
  const width = span / bins;
  const counts = new Array<number>(bins).fill(0);
  values.forEach((v) => {
    const i = Math.min(bins - 1, Math.floor((v - min) / width));
    counts[i] += 1;
  });
  const peak = Math.max(...counts, 1);

  const W = 600;
  const IW = W - PAD.l - PAD.r;
  const IH = H - PAD.t - PAD.b;
  const slot = IW / bins;
  const medianX = ((mid - min) / span) * IW;

  return (
    <div className="cr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="distribution">
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          {counts.map((c, i) => {
            const h = (c / peak) * IH;
            return (
              <rect
                key={i}
                className="cr-dist-bar"
                x={i * slot + slot * 0.08}
                y={IH - h}
                width={slot * 0.84}
                height={Math.max(c > 0 ? 1 : 0, h)}
              >
                <title>{`${c} group${c === 1 ? '' : 's'}`}</title>
              </rect>
            );
          })}
          <line className="cr-dist-axis" x1={0} x2={IW} y1={IH} y2={IH} />
          <line className="cr-dist-median" x1={medianX} x2={medianX} y1={0} y2={IH} />
          <text className="cr-axis-label" x={0} y={IH + 14}>{formatTick(min, data!.format)}</text>
          <text className="cr-axis-label" x={IW} y={IH + 14} textAnchor="end">
            {formatTick(max, data!.format)}
          </text>
        </g>
      </svg>
      <div className="cr-dist-caption tnum">
        {values.length} groups · median {formatValue(mid, data!.format, instance.format?.decimals)}
      </div>
    </div>
  );
}
