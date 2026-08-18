/**
 * One widget's data, as a hook: resolve the binding, run the requests, shape
 * the responses. Re-runs when the binding (not the whole spec) changes, so
 * moving a widget never re-queries and editing one widget never refetches the
 * other eleven.
 */

import { useEffect, useMemo, useState } from 'react';
import type { DashboardSpec, FilterExpr, WidgetInstance } from 'chartroom-spec';
import type { WidgetData, WidgetStatus } from 'chartroom-widgets';
import { assemble, requestsFor, type QueryResult } from './bindings';
import { runQuery, type ContractSummary } from './data';

export interface WidgetQueryState {
  data: WidgetData | null;
  status: WidgetStatus;
  error?: string;
}

export function useWidgetData(
  w: WidgetInstance,
  spec: DashboardSpec,
  contracts: Map<string, ContractSummary>,
  /** Cross-filter narrowing when this widget is an interaction target. */
  extraFilters: FilterExpr[] = [],
): WidgetQueryState {
  const [state, setState] = useState<WidgetQueryState>({ data: null, status: 'loading' });

  // The dependency is the *meaning* of the binding — its resolved requests —
  // not object identity, which changes on every keystroke elsewhere.
  const requests = useMemo(() => requestsFor(w, spec, extraFilters), [
    JSON.stringify(w.bind), JSON.stringify(spec.context), JSON.stringify(extraFilters), w.type,
  ]);

  useEffect(() => {
    let alive = true;
    setState((s) => (s.data ? s : { data: null, status: 'loading' }));

    const run = async () => {
      const [main, compare, ...bands] = await Promise.all([
        runQuery(requests.main),
        requests.compare ? runQuery(requests.compare) : Promise.resolve(null),
        ...requests.bands.map((b) => runQuery(b)),
      ]);
      if (!alive) return;
      const bandPairs = requests.bands.map((b, i) => ({
        ref: b.metric,
        result: bands[i] as QueryResult,
      }));
      const data = assemble(w, main as QueryResult, compare, bandPairs, contracts.get(w.bind.metric));
      const empty = (data.rows && !data.rows.length)
        || (data.series && !data.series.length)
        || (!data.rows && !data.series && !data.scalar);
      setState({ data, status: empty ? 'empty' : 'fresh' });
    };

    run().catch((e: Error) => {
      if (alive) setState({ data: null, status: 'error', error: e.message });
    });
    return () => { alive = false; };
  }, [requests, contracts]);

  return state;
}
