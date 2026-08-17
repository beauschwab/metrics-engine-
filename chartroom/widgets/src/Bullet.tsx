/**
 * bullet@1 — one measure against the limit it must respect.
 *
 * The value is a bar, the threshold a marker, and the gap between them is the
 * only thing the reader has to judge. That reading only works when the
 * threshold is a governed number, which is GAUGE-01's whole job: the
 * comparison must be a registry metric ref, never a literal typed into the
 * spec. A hardcoded limit is a limit nobody owns, reviews, or updates when the
 * policy moves — and it looks identical to a real one.
 *
 * Breach direction is not assumed, because it cannot be inferred: a coverage
 * ratio must stay above its floor and a concentration below its ceiling, and
 * the two look identical in the data. The binding declares it (`compare.limit`)
 * and GAUGE-01 requires that declaration on a gauge. With no declaration the
 * widget still draws the value against the limit — it just does not claim a
 * breach it has no basis to claim.
 */

import type { WidgetProps } from './types';
import { formatValue } from './format';

export function Bullet({ instance, data, status, error }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-tile" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const scalar = data?.scalar;
  if (!scalar || !Number.isFinite(scalar.value)) {
    return <div className="cr-widget-empty">no value</div>;
  }

  const limit = data?.compare;
  const value = scalar.value;
  const target = limit?.value;

  // The track spans zero to whichever of value/limit reaches further, with
  // headroom so a marker at the extreme is still visible. Negative values
  // measure their length from zero rather than being folded positive — a
  // -50 against a 100 limit is not 43% of the way there.
  const reach = Math.max(0, value, target ?? value) * 1.15 || 1;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / reach) * 100))}%`;

  // A threshold comparison implies a limit; a delta comparison is just a
  // reference point. Only a threshold with a declared side can be breached —
  // without one, the gauge shows the gap and says nothing about safety.
  const side = instance.bind.compare?.limit;
  const breached = limit?.style === 'threshold' && target !== undefined && side
    ? ((side === 'floor' && value < target) || (side === 'ceiling' && value > target)
      ? (side === 'floor' ? 'below' : 'above')
      : null)
    : null;

  return (
    <div className="cr-bullet" data-breached={breached || undefined}>
      <div className="cr-bullet-value tnum">
        {formatValue(value, data!.format, instance.format?.decimals)}
      </div>
      <div className="cr-bullet-track">
        <span className="cr-bullet-fill" style={{ width: pct(value) }} />
        {target !== undefined && Number.isFinite(target) && (
          <span
            className="cr-bullet-marker"
            style={{ left: pct(target) }}
            aria-label={`${limit!.label} ${formatValue(target, data!.format)}`}
          />
        )}
      </div>
      <div className="cr-bullet-foot">
        {target === undefined
          ? <span className="cr-bullet-nolimit">no limit bound</span>
          : (
            <span className="tnum">
              {side === 'ceiling' ? 'max ' : side === 'floor' ? 'min ' : ''}
              {limit!.label} {formatValue(target, data!.format, instance.format?.decimals)}
              {breached ? ` · breached (${breached})` : ''}
            </span>
          )}
      </div>
    </div>
  );
}
