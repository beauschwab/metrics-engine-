/**
 * IX-01 — a cross-filter must be answerable on both ends.
 *
 * An interaction is a promise: click a value of `dim` on the source and every
 * target narrows to it. The promise holds only when the source actually
 * groups by that dim (otherwise there is nothing to click) and every target's
 * metric contract carries the dim (otherwise the filter cannot apply and the
 * target would silently show unfiltered numbers next to filtered ones — the
 * worst kind of wrong, coherent-looking). Both are checkable from the spec
 * and the contracts, so they are checked here, not discovered by a reader.
 *
 * The fix removes the interaction: which *other* wiring the author meant is
 * theirs to say.
 */

import type { Rule } from '../context';

export const IX_01: Rule = (spec, ctx) =>
  spec.interactions.flatMap((ix, i) => {
    const { source, dim, targets } = ix.cross_filter;
    const path = `/interactions/${i}`;
    const remove = {
      fix: [{ op: 'remove' as const, path }],
      fixLabel: 'Remove the interaction',
    };

    const src = spec.widgets.find((w) => w.id === source);
    if (src && !(src.bind.dims ?? []).includes(dim)) {
      return [{
        rule: 'IX-01', severity: 'BLOCK' as const, path, widget: source,
        message: `the cross-filter clicks ${dim}, but ${source} does not group by it — `
          + 'there is nothing on the widget to click',
        ...remove,
      }];
    }

    for (const id of targets) {
      const t = spec.widgets.find((w) => w.id === id);
      if (!t) continue; // the schema already rejects unknown widget ids
      const contract = ctx.contracts.get(t.bind.metric);
      if (contract && !contract.dims.some((d) => d.name === dim)) {
        return [{
          rule: 'IX-01', severity: 'BLOCK' as const, path, widget: id,
          message: `${id} is a cross-filter target, but its metric has no ${dim} dimension — `
            + 'the filter could not apply, and the widget would show unfiltered numbers '
            + 'beside filtered ones',
          ...remove,
        }];
      }
    }
    return [];
  });
