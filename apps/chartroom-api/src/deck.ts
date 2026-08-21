/**
 * The committee pack: spec → deterministic render → deck (PRD Phase 4).
 *
 * The deck cannot diverge from the live dashboard because there is nothing in
 * it that did not come from the same place: the numbers run through the same
 * QueryService the widgets use, the formatting is `chartroom-widgets`' own
 * `formatValue`, and the title slide carries the version and spec hash so a
 * committee member can name exactly which artifact they were shown.
 *
 * Split for testability: `buildDeckPlan` produces a plain-data plan — every
 * slide, every number, every label — which the tests assert deeply;
 * `renderDeck` feeds the plan to pptxgenjs. Native PPTX charts and tables,
 * not screenshots: the deck stays data all the way down.
 */

import type { DashboardSpec, WidgetInstance } from 'chartroom-spec';
import { parseMetricRef } from 'chartroom-spec';
// The React-free subpath: the server wants the widgets' number formatting,
// not their components.
import { formatValue } from 'chartroom-widgets/format';
import type { QueryResult, QueryService } from './query';
import { legsOf } from './datacritic';

/**
 * The committee pack's palette, named from Aperture Risk.
 *
 * A deck prints and projects, so it inverts the system's dark-first surfaces
 * onto white — but the *semantics* stay Aperture's: the same danger red for a
 * skipped slide, the same neutral greys for secondary and tertiary text, the
 * same hairline for table rules. Scattered literals (`666666`, `AA3333`) were
 * a third palette nobody owned, drifting from both the studio and the system.
 */
const DECK = {
  /** --gray-600, the system's strong border, as body-secondary on white. */
  textSecondary: '474C54',
  /** --gray-400, tertiary text / captions. */
  textTertiary: '757A82',
  /** --gray-800, near-black body text for prose. */
  textBody: '2A2D33',
  /** --danger-500, unchanged from the system — a refusal reads as a refusal. */
  danger: 'F5454F',
  /** --gray-200, the hairline that organises a table. */
  rule: 'AFB4BC',
} as const;

export interface KpiSlide {
  type: 'kpi';
  widget: string;
  title: string;
  value: string;
  prior: string;
  asOf: string;
}
export interface ChartSlide {
  type: 'line' | 'bar';
  widget: string;
  title: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  format: string;
  asOf: string;
}
export interface TableSlide {
  type: 'table';
  widget: string;
  title: string;
  headers: string[];
  rows: string[][];
  asOf: string;
}
export interface SkippedSlide {
  type: 'skipped';
  widget: string;
  title: string;
  reason: string;
}
/**
 * Author commentary (annotation@1). The note is the slide's substance and the
 * value is its anchor, so the sentence lands in the pack next to the number
 * it was written about rather than in the email nobody kept.
 */
export interface NoteSlide {
  type: 'note';
  widget: string;
  title: string;
  note: string;
  value: string;
  asOf: string;
}
export type DeckSlide = KpiSlide | ChartSlide | TableSlide | SkippedSlide | NoteSlide;

export interface DeckPlan {
  title: {
    heading: string;
    status: string;
    audience: string;
    cadence: string;
    version: number;
    specHash: string;
    asOf: string;
  };
  slides: DeckSlide[];
}

const titleOf = (w: WidgetInstance) =>
  w.title || parseMetricRef(w.bind.metric)?.measure || w.id;

export async function buildDeckPlan(
  spec: DashboardSpec,
  version: { version: number; specHash: string },
  queries: QueryService,
): Promise<DeckPlan> {
  const legs = legsOf(spec).filter((l) => l.role === 'main');
  const slides: DeckSlide[] = [];
  let asOf = '';

  for (const w of spec.widgets) {
    const leg = legs.find((l) => l.widget === w.id)!;
    let r: QueryResult;
    try {
      r = await queries.run(leg.req);
    } catch (e) {
      slides.push({
        type: 'skipped', widget: w.id, title: titleOf(w),
        reason: `query failed: ${e instanceof Error ? e.message : e}`,
      });
      continue;
    }
    asOf = asOf || r.asOf;
    const widget = w.type.split('@')[0];
    const decimals = w.format?.decimals;
    const fv = (v: number) => formatValue(v, r.format, decimals);

    if (widget === 'annotation') {
      slides.push({
        type: 'note', widget: w.id, title: titleOf(w),
        note: w.note?.trim() || '(no commentary written)',
        value: r.kind === 'scalar' ? fv(r.value) : '',
        asOf: r.asOf,
      });
    } else if (r.kind === 'scalar') {
      slides.push({
        type: 'kpi', widget: w.id, title: titleOf(w),
        value: fv(r.value), prior: fv(r.prior), asOf: r.asOf,
      });
    } else if (r.kind === 'series') {
      const labels = r.series[0]?.points.map((p) => p.date) ?? [];
      slides.push({
        type: 'line', widget: w.id, title: titleOf(w), labels,
        series: r.series.map((s) => ({
          name: Object.values(s.key).filter((v) => v !== '').join(' · ') || titleOf(w),
          values: s.points.map((p) => p.value),
        })),
        format: r.format, asOf: r.asOf,
      });
    } else if (widget === 'bar' || widget === 'distribution') {
      slides.push({
        type: 'bar', widget: w.id, title: titleOf(w),
        labels: r.rows.map((row) => Object.values(row.key).join(' · ')),
        series: [{ name: titleOf(w), values: r.rows.map((row) => row.value) }],
        format: r.format, asOf: r.asOf,
      });
    } else if (widget === 'waterfall') {
      // A bridge exports as its steps — the per-driver moves, plus the two
      // totals that bracket them, so the slide carries the same arithmetic
      // the widget draws rather than a pair of unexplained levels.
      const opening = r.rows.reduce((s, row) => s + row.prior, 0);
      const closing = r.rows.reduce((s, row) => s + row.value, 0);
      slides.push({
        type: 'bar', widget: w.id, title: titleOf(w),
        labels: ['prior', ...r.rows.map((row) => Object.values(row.key).join(' · ')), 'current'],
        series: [{
          name: titleOf(w),
          values: [opening, ...r.rows.map((row) => row.value - row.prior), closing],
        }],
        format: r.format, asOf: r.asOf,
      });
    } else {
      const dims = r.rows.length ? Object.keys(r.rows[0].key) : [];
      slides.push({
        type: 'table', widget: w.id, title: titleOf(w),
        headers: [...dims, 'value', 'prior'],
        rows: r.rows.map((row) => [
          ...dims.map((d) => row.key[d]),
          fv(row.value),
          fv(row.prior),
        ]),
        asOf: r.asOf,
      });
    }
  }

  return {
    title: {
      heading: spec.dashboard.title,
      status: spec.dashboard.status,
      audience: spec.dashboard.audience,
      cadence: spec.dashboard.cadence,
      version: version.version,
      specHash: version.specHash,
      asOf,
    },
    slides,
  };
}

/** The plan, rendered. Kept thin: everything assertable lives in the plan. */
export async function renderDeck(plan: DeckPlan): Promise<Buffer> {
  const { default: PptxGen } = await import('pptxgenjs');
  const pptx = new PptxGen();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  const t = pptx.addSlide();
  t.addText(plan.title.heading, { x: 0.6, y: 1.6, w: 12, h: 1, fontSize: 36, bold: true });
  t.addText(
    `${plan.title.status.toUpperCase()} · ${plan.title.audience} · ${plan.title.cadence} · as of ${plan.title.asOf}`,
    { x: 0.6, y: 2.7, w: 12, h: 0.5, fontSize: 16, color: DECK.textSecondary },
  );
  t.addText(
    `version ${plan.title.version} · spec ${plan.title.specHash.slice(0, 12)}`,
    { x: 0.6, y: 6.8, w: 12, h: 0.4, fontSize: 10, color: DECK.textTertiary },
  );

  for (const s of plan.slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 22, bold: true });
    if (s.type === 'skipped') {
      slide.addText(s.reason, { x: 0.6, y: 3, w: 12, h: 1, fontSize: 14, color: DECK.danger });
      continue;
    }
    slide.addText(`as of ${s.asOf}`, { x: 0.6, y: 7, w: 6, h: 0.3, fontSize: 10, color: DECK.textTertiary });

    if (s.type === 'kpi') {
      slide.addText(s.value, { x: 0.6, y: 2.6, w: 12, h: 1.6, fontSize: 54, bold: true });
      slide.addText(`prior ${s.prior}`, { x: 0.6, y: 4.3, w: 12, h: 0.5, fontSize: 16, color: DECK.textSecondary });
    } else if (s.type === 'note') {
      if (s.value) {
        slide.addText(s.value, { x: 0.6, y: 1.3, w: 12, h: 1, fontSize: 32, bold: true });
      }
      slide.addText(s.note, {
        x: 0.6, y: s.value ? 2.5 : 1.3, w: 12, h: 4, fontSize: 16, color: DECK.textBody, valign: 'top',
      });
    } else if (s.type === 'line' || s.type === 'bar') {
      slide.addChart(s.type === 'line' ? 'line' : 'bar', s.series.map((line) => ({
        name: line.name, labels: s.labels, values: line.values,
      })), { x: 0.6, y: 1.2, w: 12, h: 5.6, ...(s.type === 'bar' ? { barDir: 'bar' } : {}) });
    } else if (s.type === 'table') {
      slide.addTable(
        [
          s.headers.map((h) => ({ text: h, options: { bold: true } })),
          ...s.rows.map((row) => row.map((cell) => ({ text: cell }))),
        ],
        { x: 0.6, y: 1.2, w: 12, fontSize: 11, border: { type: 'solid', color: DECK.rule, pt: 0.5 } },
      );
    }
  }

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return out as Buffer;
}
