/**
 * delta-table@1 — value, prior, and the day-over-day move per group, the
 * variance monitor's reading habit as a widget. The move is words and sign,
 * colour only under semantic emphasis — a table of red numbers stops being
 * a warning and starts being wallpaper.
 */

import type { WidgetProps } from './types';
import { formatDelta, formatValue } from './format';

export function DeltaTable({ instance, data, status, error }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-table" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const rows = data?.rows ?? [];
  if (!rows.length) return <div className="cr-widget-empty">no groups match</div>;

  const dims = Object.keys(rows[0].key);
  const decimals = instance.format?.decimals;

  return (
    <table className="cr-table" data-emphasis={instance.format?.emphasis || 'neutral'}>
      <thead>
        <tr>
          {dims.map((d) => <th key={d}>{d}</th>)}
          <th className="cr-num">value</th>
          <th className="cr-num">prior</th>
          <th className="cr-num">Δ d/d</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const label = Object.values(r.key).join('');
          return (
            <tr key={label}>
              {dims.map((d) => <td key={d}>{r.key[d]}</td>)}
              <td className="cr-num tnum">{formatValue(r.value, data!.format, decimals)}</td>
              <td className="cr-num tnum">{formatValue(r.prior, data!.format, decimals)}</td>
              <td className="cr-num tnum" data-dir={r.value >= r.prior ? 'up' : 'down'}>
                {formatDelta(r.value, r.prior, data!.format)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
