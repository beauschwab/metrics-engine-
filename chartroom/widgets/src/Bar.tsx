/**
 * bar@1 — the as-of value split by one dimension, horizontal so the category
 * labels read as text. Order comes through `barOrder` (BAR-02's runtime
 * half): value-descending, unless the interpreter says the dim is ordinal.
 */

import type { WidgetProps } from './types';
import { formatValue } from './format';
import { barOrder } from './scale';

export function Bar({ instance, data, status, error }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-chart" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const rows = data?.rows ?? [];
  if (!rows.length) return <div className="cr-widget-empty">no groups match</div>;

  const sort = instance.bind.sort ?? (data!.ordinalDim ? 'dim' : 'value');
  const ordered = barOrder(rows, sort);
  const max = Math.max(...ordered.map((r) => Math.abs(r.value)), 1e-9);

  return (
    <div className="cr-bars">
      {ordered.map((r) => {
        const label = Object.values(r.key).join(' · ');
        return (
          <div key={label} className="cr-bar-row">
            <span className="cr-bar-label" title={label}>{label}</span>
            <span className="cr-bar-track">
              <span
                className="cr-bar-fill"
                data-negative={r.value < 0 || undefined}
                style={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
              />
            </span>
            <span className="cr-bar-value tnum">
              {formatValue(r.value, data!.format, instance.format?.decimals)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
