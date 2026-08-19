/**
 * The context bar — the scope every widget on the board is read under.
 *
 * Two things live here that used to be scattered. The dashboard's declared
 * context params (`spec.context`) finally have a control: `paramsOf` has
 * resolved them to their defaults since Phase 1 with the comment "no context
 * bar yet", and this is that bar. And the cross-filter chip moved up out of
 * the canvas, because a filter is scope — the same category as entity or
 * currency — and reading it in one strip beats finding it above the tiles.
 *
 * Options come from the data, not from a list typed here: a param names a
 * dimension, and the values are whatever that dimension actually holds in the
 * current workspace. A picker offering a value the warehouse has never seen is
 * a filter that returns an empty board.
 */

import { useEffect, useState } from 'react';
import type { DashboardSpec } from 'chartroom-spec';
import { runQuery } from '../data';

export interface CrossFilter {
  source: string;
  dim: string;
  value: string;
}

/**
 * Distinct values for each declared context param, asked of the engine as a
 * grouped query — the same path a widget takes, so a value that appears here
 * is a value a widget can actually be narrowed to.
 */
export function useContextOptions(spec: DashboardSpec | null): Record<string, string[]> {
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const entries = Object.entries(spec?.context ?? {});
  const key = JSON.stringify(entries.map(([n, p]) => [n, p.dim]));
  // Any bound metric will do — the dimension is a property of the workspace,
  // not of the measure being grouped.
  const probe = spec?.widgets[0]?.bind.metric;

  useEffect(() => {
    if (!probe || !entries.length) { setOptions({}); return; }
    let alive = true;
    void Promise.all(entries.map(async ([name, p]) => {
      try {
        const r = await runQuery({ metric: probe, dims: [p.dim] });
        const values = r.kind === 'groups'
          ? [...new Set(r.rows.map((row) => row.key[p.dim]).filter(Boolean))].sort()
          : [];
        return [name, values] as const;
      } catch {
        // A dimension the metric cannot group by is not an error worth a
        // banner — the chip simply falls back to its declared default.
        return [name, [] as string[]] as const;
      }
    })).then((pairs) => { if (alive) setOptions(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [key, probe]);

  return options;
}

export interface ContextBarProps {
  spec: DashboardSpec;
  values: Record<string, string>;
  options: Record<string, string[]>;
  onValue(name: string, value: string): void;
  cross: CrossFilter | null;
  onClearCross(): void;
  asOf: string | null;
  dirty: boolean;
  onReset(): void;
}

export function ContextBar({
  spec, values, options, onValue, cross, onClearCross, asOf, dirty, onReset,
}: ContextBarProps) {
  const params = Object.entries(spec.context);

  const scope = [
    asOf ?? 'latest close',
    ...params.map(([name, p]) => values[name] ?? p.default),
    ...(cross ? [`${cross.dim} = ${cross.value}`] : []),
  ].join(' · ');

  return (
    <div className="cr-context-bar" data-testid="context-bar">
      {params.map(([name, p]) => (
        <div className="cr-context-chip" key={name}>
          <span className="cr-context-label">{name}</span>
          <select
            className="cr-select"
            data-testid={`ctx-${name}`}
            value={values[name] ?? p.default}
            onChange={(e) => onValue(name, e.target.value)}
          >
            {/* The declared default is always offered, even before the
                distinct-value query lands, so the chip is never empty. */}
            {(options[name]?.length ? options[name] : [p.default]).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      ))}

      {cross && (
        <div className="cr-crossfilter-chip" data-testid="crossfilter-chip">
          <span className="cr-crossfilter-dim">{cross.dim} = {cross.value}</span>
          <span className="cr-crossfilter-src">from {cross.source}</span>
          <button
            type="button"
            className="cr-crossfilter-clear"
            data-testid="crossfilter-clear"
            onClick={onClearCross}
          >
            ×
          </button>
        </div>
      )}

      <span className="cr-context-spacer" />
      <span className="cr-scope-label" data-testid="scope-label">{scope}</span>
      {dirty && (
        <button type="button" className="cr-scope-reset" data-testid="scope-reset" onClick={onReset}>
          reset scope
        </button>
      )}
    </div>
  );
}
