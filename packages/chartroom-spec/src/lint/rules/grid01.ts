/**
 * GRID-01 — a pivot grid declares its ceiling.
 *
 * The grid family is the one widget whose result size is a *product* of
 * cardinalities, which is how "add one more dim" becomes a million cells. So
 * `max_cells` is mandatory and capped: the boundary guard is part of the
 * binding, visible in review, not a runtime surprise. The rule also does the
 * arithmetic the author can't be expected to: if the declared dims already
 * multiply out past the cap, say so now, not at render.
 */

import type { Rule } from '../context';
import { widgetsOf } from '../context';

const CAP = 100_000;
const DEFAULT = 50_000;

export const GRID_01: Rule = (spec, ctx) =>
  widgetsOf(spec, ctx).flatMap(({ w, path, widgetContract, metricContract }) => {
    // Heatmaps cross two dims into cells the same way a pivot does, so the
    // cell ceiling is the same judgment — AGG-01's margin-total rule is not,
    // which is why they are separate families (Phase 9).
    if (widgetContract?.family !== 'grid' && widgetContract?.family !== 'heatmap') return [];
    const p = `${path}/bind/max_cells`;

    if (w.bind.max_cells === undefined) {
      return [{
        rule: 'GRID-01', severity: 'BLOCK' as const, path: p, widget: w.id,
        message: 'a grid must declare max_cells — the guard against a dimension product '
          + 'quietly becoming a full-table haul',
        fix: [{ op: 'add' as const, path: p, value: DEFAULT }],
        fixLabel: `Set max_cells ${DEFAULT.toLocaleString('en-US')}`,
      }];
    }
    if (w.bind.max_cells > CAP) {
      return [{
        rule: 'GRID-01', severity: 'BLOCK' as const, path: p, widget: w.id,
        message: `max_cells ${w.bind.max_cells.toLocaleString('en-US')} exceeds the `
          + `${CAP.toLocaleString('en-US')} boundary`,
        fix: [{ op: 'replace' as const, path: p, value: CAP }],
        fixLabel: `Clamp to ${CAP.toLocaleString('en-US')}`,
      }];
    }

    if (metricContract) {
      let cells = 1;
      for (const name of w.bind.dims ?? []) {
        const dim = metricContract.dims.find((d) => d.name === name);
        if (dim?.values) cells *= dim.values.length;
      }
      if (cells > w.bind.max_cells) {
        return [{
          rule: 'GRID-01', severity: 'BLOCK' as const, path: `${path}/bind/dims`, widget: w.id,
          message: `these dims multiply to ${cells.toLocaleString('en-US')} cells, past the `
            + `declared max_cells of ${w.bind.max_cells.toLocaleString('en-US')} — drop a dim or raise the guard`,
        }];
      }
    }
    return [];
  });
