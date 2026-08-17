/**
 * bar@1 — the as-of value split by one dimension, horizontal so the category
 * labels read as text. Order comes through `barOrder` (BAR-02's runtime
 * half): value-descending, unless the interpreter says the dim is ordinal.
 */

import type { WidgetProps } from './types';
import { formatValue } from './format';
import { barOrder } from './scale';

export function Bar({ instance, data, status, error, onPick, picked }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-chart" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const rows = data?.rows ?? [];
  if (!rows.length) return <div className="cr-widget-empty">no groups match</div>;

  const sort = instance.bind.sort ?? (data!.ordinalDim ? 'dim' : 'value');
  const ordered = barOrder(rows, sort);
  const max = Math.max(...ordered.map((r) => Math.abs(r.value)), 1e-9);
  const isPicked = (key: Record<string, string>) =>
    !!picked && Object.entries(picked).every(([k, v]) => key[k] === v);

  return (
    <div className="cr-bars" data-pickable={!!onPick || undefined}>
      {ordered.map((r) => {
        const label = Object.values(r.key).join(' · ');
        return (
          <div
            key={label}
            className="cr-bar-row"
            data-picked={isPicked(r.key) || undefined}
            data-testid={onPick ? `pick-${label}` : undefined}
            role={onPick ? 'button' : undefined}
            tabIndex={onPick ? 0 : undefined}
            onClick={onPick ? (e) => { e.stopPropagation(); onPick(r.key); } : undefined}
            onKeyDown={onPick ? (e) => { if (e.key === 'Enter') onPick(r.key); } : undefined}
          >
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
