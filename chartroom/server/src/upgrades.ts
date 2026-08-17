/**
 * Version-pin upgrade notifications (E3.4).
 *
 * A promoted dashboard pins document revisions so its numbers are
 * reproducible; the registry keeps moving. The owner's question when it does
 * is never "is there a newer revision" — it is "what would change for my
 * readers if I re-pinned". So each stale pin carries the engine's own
 * `assessChange` between the pinned body and the latest one: the same impact
 * assessment the registry's promotion gate runs, pointed at the consumer.
 * Notify-with-a-diff, never silently changing numbers.
 */

import { parseMetricRef, type DashboardSpec } from 'chartroom-spec';
import { assessChange, type Finding } from '../../../src/engine/impact';
import { Evaluator } from '../../../src/engine/evaluate';
import { parseDoc, type Graph } from '../../../src/engine/parse';
import { buildRegistry } from '../../../src/engine/registry';
import { fetchRevision, type RegistryState } from './keel';

export interface UpgradeNotice {
  doc: string;
  pinned: number;
  latest: number;
  /** The widget ids whose bindings pin this document. */
  widgets: string[];
  /** assessChange findings between the pinned and latest bodies. */
  findings: Finding[];
  weakens: boolean;
  /** History unavailable (offline registry) — the diff could not be computed. */
  historyUnavailable?: boolean;
}

/** Every keel:// ref a spec carries, with the widget that carries it. */
export function pinnedRefs(spec: DashboardSpec): Array<{ ref: string; widget: string }> {
  const out: Array<{ ref: string; widget: string }> = [];
  for (const w of spec.widgets) {
    out.push({ ref: w.bind.metric, widget: w.id });
    for (const b of w.bind.bands ?? []) out.push({ ref: b, widget: w.id });
    if (w.bind.compare && w.bind.compare.vs !== 'prior_period') {
      out.push({ ref: w.bind.compare.vs, widget: w.id });
    }
    if (w.bind.derived) for (const r of w.bind.derived.of) out.push({ ref: r, widget: w.id });
  }
  return out;
}

/**
 * Measure-level findings between two revisions of a metrics view.
 *
 * The engine's `assessChange` runs controls, classifications, reports and
 * parameter sets both ways — but a dashboard pin almost always points at a
 * *metrics view*, and for those the reader's question is directly numeric:
 * which measures move, appear, or disappear if I re-pin. So the adapter
 * evaluates every measure of both bodies on the nominal fixture and reports
 * the diff, in the same `Finding` shape the engine uses (ADR-25).
 */
export function measureFindings(
  doc: string,
  before: string,
  after: string,
  docs: Record<string, string>,
): Finding[] {
  let a: Graph;
  let b: Graph;
  try {
    a = parseDoc(before);
    b = parseDoc(after);
  } catch {
    return [];
  }
  if (a.kind !== 'metrics_view' || b.kind !== 'metrics_view') return [];

  const run = (g: Graph, body: string): Map<string, number | null> => {
    const workspace = { ...docs, [doc]: body };
    const registry = buildRegistry(workspace);
    const ev = new Evaluator(g, 'nominal', registry);
    const out = new Map<string, number | null>();
    for (const m of g.measures) {
      try {
        const v = ev.value(m.name).v;
        out.set(m.name, Number.isFinite(v) ? v : null);
      } catch {
        out.set(m.name, null);
      }
    }
    return out;
  };

  const was = run(a, before);
  const now = run(b, after);
  const findings: Finding[] = [];

  for (const [name, v0] of was) {
    if (!now.has(name)) {
      // A pinned binding to this measure has nothing to re-pin to — the one
      // upgrade outcome that breaks a widget rather than moving its number.
      findings.push({
        consequence: 'definition',
        direction: 'weakens',
        summary: `${name} no longer exists at the latest revision`,
        detail: [`Any widget bound to ${doc}.${name} cannot re-pin; its binding would dangle.`],
      });
      continue;
    }
    const v1 = now.get(name)!;
    const moved = v0 === null || v1 === null
      ? v0 !== v1
      : Math.abs(v1 - v0) > Math.max(1e-9, Math.abs(v0) * 1e-9);
    if (moved) {
      findings.push({
        consequence: 'definition',
        direction: 'changes',
        summary: `${name} moves from ${fmt(v0)} to ${fmt(v1)} on the nominal fixture`,
        detail: [
          v0 !== null && v1 !== null && v0 !== 0
            ? `Re-pinning changes the displayed value by ${(((v1 - v0) / Math.abs(v0)) * 100).toFixed(1)}%.`
            : 'Re-pinning changes whether this measure evaluates at all.',
        ],
      });
    }
  }
  for (const name of now.keys()) {
    if (!was.has(name)) {
      findings.push({
        consequence: 'definition',
        direction: 'changes',
        summary: `${name} is new at the latest revision`,
        detail: [`Re-pinning makes ${doc}.${name} available to bind.`],
      });
    }
  }
  return findings;
}

const fmt = (v: number | null) =>
  v === null ? 'not evaluable' : v.toLocaleString('en-US', { maximumFractionDigits: 4 });

export async function upgradeNotices(
  spec: DashboardSpec,
  state: RegistryState,
): Promise<UpgradeNotice[]> {
  const latestRev = new Map(state.docs.map((d) => [d.name, d.revision]));
  const bodies = new Map(state.docs.map((d) => [d.name, d.body]));

  // Group stale pins by (doc, pinned revision) — one notice per document,
  // with every widget that rides it.
  const stale = new Map<string, { doc: string; pinned: number; widgets: Set<string> }>();
  for (const { ref, widget } of pinnedRefs(spec)) {
    const parsed = parseMetricRef(ref);
    if (!parsed) continue;
    const latest = latestRev.get(parsed.doc);
    if (latest === undefined || parsed.version >= latest) continue;
    const key = `${parsed.doc}@${parsed.version}`;
    const hit = stale.get(key) ?? { doc: parsed.doc, pinned: parsed.version, widgets: new Set() };
    hit.widgets.add(widget);
    stale.set(key, hit);
  }

  const docs = Object.fromEntries(state.docs.map((d) => [d.name, d.body]));
  const out: UpgradeNotice[] = [];
  for (const { doc, pinned, widgets } of stale.values()) {
    const latest = latestRev.get(doc)!;
    const notice: UpgradeNotice = {
      doc, pinned, latest, widgets: [...widgets].sort(), findings: [], weakens: false,
    };
    const before = await fetchRevision(doc, pinned);
    const after = bodies.get(doc);
    if (before === null || after === undefined) {
      notice.historyUnavailable = true;
    } else {
      try {
        const impact = assessChange(doc, before, after, docs);
        notice.findings = [...measureFindings(doc, before, after, docs), ...impact.findings];
        notice.weakens = notice.findings.some((f) => f.direction === 'weakens');
      } catch {
        notice.historyUnavailable = true;
      }
    }
    out.push(notice);
  }
  return out.sort((a, b) => a.doc.localeCompare(b.doc));
}
