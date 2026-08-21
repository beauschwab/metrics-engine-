/**
 * kpi-tile@1 — one number, judged.
 *
 * The judgment line is the widget: against a threshold it says which side of
 * the limit the number sits and by how much; against the prior period it says
 * the move. Breach state is words *and* colour — `data-state` drives the
 * semantic palette only when the spec asked for semantic emphasis (COL-03's
 * runtime half lives in the theme, not here).
 */

import type { WidgetProps } from './types';
import { formatDelta, formatValue } from './format';

export function KpiTile({ instance, data, status, error }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-kpi" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  if (!data?.scalar) return <div className="cr-widget-empty">no value</div>;

  const { value, prior } = data.scalar;
  const decimals = instance.format?.decimals;
  const compare = data.compare;

  let judgment: { text: string; state: 'ok' | 'breach' | 'up' | 'down' } | null = null;
  if (compare?.style === 'threshold') {
    const breach = value < compare.value;
    judgment = {
      text: `${breach ? 'below' : 'above'} ${compare.label} ${formatValue(compare.value, data.format, decimals)}`,
      state: breach ? 'breach' : 'ok',
    };
  } else if (compare) {
    const d = value - compare.value;
    judgment = {
      text: `${formatDelta(value, compare.value, data.format)} vs ${compare.label}`,
      state: d >= 0 ? 'up' : 'down',
    };
  } else if (Number.isFinite(prior)) {
    judgment = {
      text: `${formatDelta(value, prior, data.format)} d/d`,
      state: value >= prior ? 'up' : 'down',
    };
  }

  return (
    <div className="cr-kpi" data-emphasis={instance.format?.emphasis || 'neutral'}>
      <div className="cr-kpi-value tnum">{formatValue(value, data.format, decimals)}</div>
      {judgment && (
        <div className="cr-kpi-judgment" data-state={judgment.state}>
          {judgment.text}
        </div>
      )}
    </div>
  );
}
