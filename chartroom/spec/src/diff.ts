/**
 * What changed between two spec versions, in reviewer vocabulary.
 *
 * A reviewer does not want a JSON diff; they want "the LCR tile was rebound",
 * "two widgets moved", "hqla_by_level was bumped from @3 to @5". The
 * distinction between *rebound* and *version bumped* matters most: a bump is
 * the upgrade-notification path (same measure, newer pin), a rebind changes
 * what number the widget shows at all.
 */

import { parseMetricRef, type DashboardSpec, type WidgetInstance } from './schema';

export interface SpecDiff {
  added: string[];
  removed: string[];
  moved: string[];
  resized: string[];
  /** bind changed beyond a pure version bump */
  rebound: Array<{ id: string; from: string; to: string }>;
  /** same document.measure, different pinned revision */
  versionBumped: Array<{ id: string; metric: string; from: number; to: number }>;
  reformatted: string[];
  retitled: string[];
  /** Commentary edited (annotation@1's `note`) — a reviewable change. */
  annotated: string[];
  contextChanged: string[];
  dashboardChanged: string[];
  identical: boolean;
}

const stable = (v: unknown): string => JSON.stringify(v ?? null);

function bindDiff(id: string, a: WidgetInstance, b: WidgetInstance, out: SpecDiff): void {
  const ra = parseMetricRef(a.bind.metric);
  const rb = parseMetricRef(b.bind.metric);
  const sameFn = !!ra && !!rb && ra.doc === rb.doc && ra.measure === rb.measure;

  if (sameFn && ra!.version !== rb!.version) {
    // Compare the rest of the binding with versions normalised away, so a pure
    // pin bump is reported as a bump and nothing else.
    const restA = stable({ ...a.bind, metric: `${ra!.doc}.${ra!.measure}` });
    const restB = stable({ ...b.bind, metric: `${rb!.doc}.${rb!.measure}` });
    out.versionBumped.push({
      id, metric: `${ra!.doc}.${ra!.measure}`, from: ra!.version, to: rb!.version,
    });
    if (restA !== restB) out.rebound.push({ id, from: a.bind.metric, to: b.bind.metric });
    return;
  }

  if (stable(a.bind) !== stable(b.bind)) {
    out.rebound.push({ id, from: a.bind.metric, to: b.bind.metric });
  }
}

export function diffSpecs(a: DashboardSpec, b: DashboardSpec): SpecDiff {
  const out: SpecDiff = {
    added: [], removed: [], moved: [], resized: [], rebound: [], versionBumped: [],
    reformatted: [], retitled: [], annotated: [], contextChanged: [], dashboardChanged: [],
    identical: false,
  };

  const byIdA = new Map(a.widgets.map((w) => [w.id, w]));
  const byIdB = new Map(b.widgets.map((w) => [w.id, w]));

  for (const w of b.widgets) if (!byIdA.has(w.id)) out.added.push(w.id);
  for (const w of a.widgets) if (!byIdB.has(w.id)) out.removed.push(w.id);

  for (const [id, wa] of byIdA) {
    const wb = byIdB.get(id);
    if (!wb) continue;
    if (wa.pos.x !== wb.pos.x || wa.pos.y !== wb.pos.y) out.moved.push(id);
    if (wa.pos.w !== wb.pos.w || wa.pos.h !== wb.pos.h) out.resized.push(id);
    if (wa.type !== wb.type) out.rebound.push({ id, from: wa.bind.metric, to: wb.bind.metric });
    else bindDiff(id, wa, wb, out);
    if (stable(wa.format) !== stable(wb.format)) out.reformatted.push(id);
    if ((wa.title ?? '') !== (wb.title ?? '')) out.retitled.push(id);
    // Commentary is content a reviewer approves, not decoration: a note-only
    // edit changes the spec hash, so the diff has to have something to show.
    if ((wa.note ?? '') !== (wb.note ?? '')) out.annotated.push(id);
  }

  const ctxKeys = new Set([...Object.keys(a.context), ...Object.keys(b.context)]);
  for (const k of ctxKeys) {
    if (stable(a.context[k]) !== stable(b.context[k])) out.contextChanged.push(k);
  }

  for (const k of ['title', 'pattern', 'audience', 'cadence', 'status'] as const) {
    if (stable(a.dashboard[k]) !== stable(b.dashboard[k])) out.dashboardChanged.push(k);
  }

  out.identical =
    !out.added.length && !out.removed.length && !out.moved.length && !out.resized.length
    && !out.rebound.length && !out.versionBumped.length && !out.reformatted.length
    && !out.retitled.length && !out.annotated.length
    && !out.contextChanged.length && !out.dashboardChanged.length;
  return out;
}
