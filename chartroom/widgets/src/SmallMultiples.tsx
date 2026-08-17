/**
 * small-multiples@1 — one panel per category, on one shared scale.
 *
 * The shared scale is the entire argument for the widget: panels drawn to
 * their own extents make a flat line and a cliff look identical, which is the
 * failure SM-01 exists to block. The extent here is computed once across every
 * panel and handed to all of them, so the renderer cannot drift from the rule.
 */

import type { WidgetProps } from './types';
import { formatTick } from './format';
import { linePath, yExtent, yPos } from './scale';

const PW = 168;
const PH = 84;
const PAD = { l: 4, r: 4, t: 8, b: 4 };
const IW = PW - PAD.l - PAD.r;
const IH = PH - PAD.t - PAD.b;

export function SmallMultiples({ data, status, error, onPick, picked }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-chart" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const lines = data?.series ?? [];
  if (!lines.length || !lines[0].points.length) {
    return <div className="cr-widget-empty">no points in the window</div>;
  }

  // One extent for every panel — SM-01, as arithmetic rather than as a promise.
  const shared = yExtent(lines.flatMap((l) => l.points.map((p) => p.value)), data!.format);
  const isPicked = (key: Record<string, string>) =>
    !!picked && Object.entries(picked).every(([k, v]) => key[k] === v);

  return (
    <div className="cr-multiples" data-pickable={!!onPick || undefined}>
      {lines.map((line, i) => {
        const label = Object.values(line.key).join(' · ') || `panel ${i + 1}`;
        const values = line.points.map((p) => p.value);
        const last = [...values].reverse().find((v) => Number.isFinite(v));
        return (
          <div
            key={label}
            className="cr-multiple"
            data-picked={isPicked(line.key) || undefined}
            data-testid={onPick ? `pick-${label}` : undefined}
            role={onPick ? 'button' : undefined}
            tabIndex={onPick ? 0 : undefined}
            onClick={onPick ? (ev) => { ev.stopPropagation(); onPick(line.key); } : undefined}
            onKeyDown={onPick ? (ev) => { if (ev.key === 'Enter') onPick(line.key); } : undefined}
          >
            <div className="cr-multiple-head">
              <span className="cr-multiple-label" title={label}>{label}</span>
              <span className="cr-multiple-value tnum">
                {last === undefined ? '—' : formatTick(last, data!.format)}
              </span>
            </div>
            <svg viewBox={`0 0 ${PW} ${PH}`} preserveAspectRatio="none" role="img" aria-label={label}>
              <g transform={`translate(${PAD.l},${PAD.t})`}>
                <line
                  className="cr-gridline"
                  x1={0}
                  x2={IW}
                  y1={yPos(shared.min, shared, IH)}
                  y2={yPos(shared.min, shared, IH)}
                />
                <path
                  className="cr-line"
                  style={{ stroke: `var(--cr-s${i % 8})` }}
                  d={linePath(values, shared, IW, IH)}
                />
              </g>
            </svg>
          </div>
        );
      })}
    </div>
  );
}
