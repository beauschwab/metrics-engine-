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
 * Breach direction is not assumed. A floor (liquidity coverage) and a ceiling
 * (concentration) both render here, so the widget states which side is safe
 * from the compare style rather than guessing from the numbers.
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

  // The track spans zero (or the low end) to whichever of value/limit reaches
  // further, with headroom so a marker at the extreme is still visible.
  const reach = Math.max(Math.abs(value), Math.abs(target ?? value)) * 1.15 || 1;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (Math.abs(v) / reach) * 100))}%`;

  // A threshold comparison implies a limit; a delta comparison is just a
  // reference point. Only the former can be "breached".
  const breached = limit?.style === 'threshold' && target !== undefined
    ? (value < target ? 'below' : null)
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
              {limit!.label} {formatValue(target, data!.format, instance.format?.decimals)}
              {breached ? ' · breached' : ''}
            </span>
          )}
      </div>
    </div>
  );
}
