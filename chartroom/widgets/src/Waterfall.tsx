/**
 * waterfall@1 — the bridge from prior to current.
 *
 * Opening total, one floating bar per category's move, closing total. The
 * order is the bridge's own order (spec order, never magnitude): a waterfall
 * read out of order is not a waterfall, which is why this family is not `bar`
 * and BAR-02's value-sort does not reach it.
 *
 * Both totals are computed from the same rows as the steps, so this bridge
 * reconciles by construction — it cannot show a residual, and it is not the
 * thing that catches an unreconciled walk. What it *can* misrepresent is a
 * filtered binding, where `prior` and `current` are subset sums presented as
 * the totals; WF-01 warns about exactly that, and the data critic checks the
 * arithmetic against the real population (ADR-44).
 */

import type { WidgetProps } from './types';
import { formatValue } from './format';
import { yExtent, yPos } from './scale';

const W = 600;
const H = 260;
const PAD = { l: 54, r: 10, t: 12, b: 46 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

interface Step {
  label: string;
  /** Bar spans from → to; totals sit on the baseline. */
  from: number;
  to: number;
  kind: 'total' | 'up' | 'down';
}

export function Waterfall({ instance, data, status, error }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-chart" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const rows = data?.rows ?? [];
  if (!rows.length) return <div className="cr-widget-empty">no groups match</div>;

  const opening = rows.reduce((s, r) => s + (Number.isFinite(r.prior) ? r.prior : 0), 0);
  const closing = rows.reduce((s, r) => s + (Number.isFinite(r.value) ? r.value : 0), 0);

  const steps: Step[] = [{ label: 'prior', from: 0, to: opening, kind: 'total' }];
  let cursor = opening;
  rows.forEach((r) => {
    const delta = (Number.isFinite(r.value) ? r.value : 0) - (Number.isFinite(r.prior) ? r.prior : 0);
    const next = cursor + delta;
    steps.push({
      label: Object.values(r.key).join(' · '),
      from: cursor,
      to: next,
      kind: delta >= 0 ? 'up' : 'down',
    });
    cursor = next;
  });
  steps.push({ label: 'current', from: 0, to: closing, kind: 'total' });

  const e = yExtent([0, opening, closing, ...steps.map((s) => s.to)], data!.format);
  const slot = IW / steps.length;
  const barW = Math.max(6, slot * 0.62);

  return (
    <div className="cr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="waterfall">
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          <line className="cr-gridline" x1={0} x2={IW} y1={yPos(0, e, IH)} y2={yPos(0, e, IH)} />
          {steps.map((s, i) => {
            const yA = yPos(s.from, e, IH);
            const yB = yPos(s.to, e, IH);
            const x = i * slot + (slot - barW) / 2;
            return (
              <g key={`${s.label}-${i}`}>
                <rect
                  className="cr-wf-bar"
                  data-kind={s.kind}
                  x={x}
                  y={Math.min(yA, yB)}
                  width={barW}
                  height={Math.max(1, Math.abs(yB - yA))}
                />
                {/* The connector: where the last step left the running total. */}
                {i > 0 && i < steps.length - 1 && (
                  <line
                    className="cr-wf-connector"
                    x1={x - (slot - barW)}
                    x2={x}
                    y1={yA}
                    y2={yA}
                  />
                )}
                <text
                  className="cr-axis-label cr-wf-label"
                  x={i * slot + slot / 2}
                  y={IH + 14}
                  textAnchor="end"
                  transform={`rotate(-35 ${i * slot + slot / 2} ${IH + 14})`}
                >
                  {s.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="cr-wf-totals tnum">
        <span>prior {formatValue(opening, data!.format, instance.format?.decimals)}</span>
        <span>current {formatValue(closing, data!.format, instance.format?.decimals)}</span>
      </div>
    </div>
  );
}
