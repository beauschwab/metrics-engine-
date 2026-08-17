/**
 * perspective-grid@1 — a pivot over the grouped result.
 *
 * Native renderer in Phase 1 (ADR-9): first dim down the side, second across
 * the top, further dims folded into the row label, totals on both margins.
 * The contract — aggregates only, `max_cells` guard, one widget type — is
 * what dashboards bind; the FINOS Perspective wrap arrives under the same
 * type ref when the Phase-4 cross-filter loop gives it a job.
 */

import type { WidgetProps } from './types';
import { formatValue } from './format';

export function PerspectiveGrid({ instance, data, status, error }: WidgetProps) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-table" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const rows = data?.rows ?? [];
  if (!rows.length) return <div className="cr-widget-empty">no groups match</div>;

  const dims = Object.keys(rows[0].key);
  const rowDims = dims.length > 1 ? dims.slice(0, -1) : dims;
  const colDim = dims.length > 1 ? dims[dims.length - 1] : null;

  const colValues = colDim
    ? [...new Set(rows.map((r) => r.key[colDim]))].sort()
    : ['value'];
  const rowLabel = (r: { key: Record<string, string> }) =>
    rowDims.map((d) => r.key[d]).join(' · ');
  const rowValues = [...new Set(rows.map(rowLabel))].sort();

  const cell = new Map<string, number>();
  for (const r of rows) {
    cell.set(`${rowLabel(r)}${colDim ? r.key[colDim] : 'value'}`, r.value);
  }

  const decimals = instance.format?.decimals;
  const fv = (v: number | undefined) =>
    v === undefined ? '' : formatValue(v, data!.format, decimals);

  const colTotal = (c: string) =>
    rows.filter((r) => (colDim ? r.key[colDim] : 'value') === c).reduce((a, r) => a + r.value, 0);
  const rowTotal = (label: string) =>
    rows.filter((r) => rowLabel(r) === label).reduce((a, r) => a + r.value, 0);
  const grand = rows.reduce((a, r) => a + r.value, 0);

  return (
    <div className="cr-grid-scroll">
      <table className="cr-table cr-pivot">
        <thead>
          <tr>
            <th>{rowDims.join(' · ')}</th>
            {colValues.map((c) => <th key={c} className="cr-num">{c}</th>)}
            <th className="cr-num cr-pivot-total">total</th>
          </tr>
        </thead>
        <tbody>
          {rowValues.map((rv) => (
            <tr key={rv}>
              <td>{rv}</td>
              {colValues.map((c) => (
                <td key={c} className="cr-num tnum">{fv(cell.get(`${rv}${c}`))}</td>
              ))}
              <td className="cr-num tnum cr-pivot-total">{fv(rowTotal(rv))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>total</td>
            {colValues.map((c) => (
              <td key={c} className="cr-num tnum">{fv(colTotal(c))}</td>
            ))}
            <td className="cr-num tnum cr-pivot-total">{fv(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
