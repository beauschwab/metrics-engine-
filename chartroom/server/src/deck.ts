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
export type DeckSlide = KpiSlide | ChartSlide | TableSlide | SkippedSlide;

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
    const family = w.type.split('@')[0];
    const decimals = w.format?.decimals;
    const fv = (v: number) => formatValue(v, r.format, decimals);

    if (r.kind === 'scalar') {
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
    } else if (family === 'bar') {
      slides.push({
        type: 'bar', widget: w.id, title: titleOf(w),
        labels: r.rows.map((row) => Object.values(row.key).join(' · ')),
        series: [{ name: titleOf(w), values: r.rows.map((row) => row.value) }],
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
    { x: 0.6, y: 2.7, w: 12, h: 0.5, fontSize: 16, color: '666666' },
  );
  t.addText(
    `version ${plan.title.version} · spec ${plan.title.specHash.slice(0, 12)}`,
    { x: 0.6, y: 6.8, w: 12, h: 0.4, fontSize: 10, color: '999999' },
  );

  for (const s of plan.slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 22, bold: true });
    if (s.type === 'skipped') {
      slide.addText(s.reason, { x: 0.6, y: 3, w: 12, h: 1, fontSize: 14, color: 'AA3333' });
      continue;
    }
    slide.addText(`as of ${s.asOf}`, { x: 0.6, y: 7, w: 6, h: 0.3, fontSize: 10, color: '999999' });

    if (s.type === 'kpi') {
      slide.addText(s.value, { x: 0.6, y: 2.6, w: 12, h: 1.6, fontSize: 54, bold: true });
      slide.addText(`prior ${s.prior}`, { x: 0.6, y: 4.3, w: 12, h: 0.5, fontSize: 16, color: '666666' });
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
        { x: 0.6, y: 1.2, w: 12, fontSize: 11, border: { type: 'solid', color: 'DDDDDD', pt: 0.5 } },
      );
    }
  }

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return out as Buffer;
}
