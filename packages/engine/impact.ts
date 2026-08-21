/**
 * What an edit will do, before it is saved.
 *
 * The registry treats every change identically: one `PUT`, one revision, one
 * line in the history. But the stages differ in what going wrong *means*, and
 * one of them differs in kind rather than degree.
 *
 * **Loosening a threshold is how a breach disappears.** A wrong number is a data
 * error; a control that no longer fires is a control failure, and under SR 11-7
 * that is the more serious finding because it is systemic — it means nobody
 * would have caught the next one either. It is also the single easiest edit to
 * make for an innocent reason (this alert is noisy) and the hardest to notice in
 * a diff, because the document still says `thresholds:` and still lists the same
 * number of them.
 *
 * So this module answers "what does this edit do?" by **running both versions**
 * rather than by pattern-matching the text. A loosened threshold is not reported
 * because a number got bigger; it is reported because breaches that fire on
 * today's data stop firing. That distinction is the whole design: a heuristic
 * over YAML would flag a widened band that changes nothing and miss a narrowed
 * window that silences a series.
 *
 * Everything here is pure. It takes two document texts and the workspace they
 * live in, and returns findings — the same shape whether it is rendered above
 * the editor or handed to an agent over MCP, because the governance question is
 * the same either way.
 */

import { parseDoc, sectionBlocks, type Graph, type Measure } from './parse';
import { buildRegistry, resolveClassification } from './registry';
import { readReport } from './compile';
import { readMonitor, runMonitor, type Breach } from './variance';
import {
  classificationMigration, derivationsOf, runClassification, type Migration,
} from './rows';
import { AS_OF, TABLES, type Row } from './fixtures';
import { DOMAINS, type FixtureName } from './vocab';

/**
 * How much attention a change deserves, which is not the same as how large it
 * is. `control` outranks everything because it is the only one whose failure
 * mode is silence.
 */
export type Consequence = 'control' | 'restatement' | 'filed' | 'assumption' | 'definition';

export type Direction = 'weakens' | 'strengthens' | 'changes';

export interface Finding {
  consequence: Consequence;
  direction: Direction;
  /** One line, in the author's terms. */
  summary: string;
  /** The evidence, computed rather than asserted. */
  detail: string[];
  /** Things that stop being true — the part worth blocking on. */
  silenced?: Array<{ key: string; date: string; delta: number }>;
  movedRecords?: number;
  movedNotional?: number;
}

export interface ImpactReport {
  findings: Finding[];
  /** True when anything here weakens a control or restates filed history. */
  needsReview: boolean;
}

const CONSEQUENCE_RANK: Record<Consequence, number> = {
  control: 0, restatement: 1, filed: 2, assumption: 3, definition: 4,
};

const EMPTY: ImpactReport = { findings: [], needsReview: false };

/**
 * A breach is identified by *which threshold* fired on which rollup on which
 * day — not by the rollup-day alone.
 *
 * Leaving the threshold out was a real defect in the first cut of this file, and
 * an instructive one: raising `HARD-USD` from $1mm to $5mm silences three
 * breaches, and this module reported nothing — because those same three
 * key-days were still breaching under `SIGMA-30`. The rollup looked watched. The
 * specific control that had been weakened was invisible, which is exactly the
 * blindness this module exists to remove.
 */
const SEP = '\u001f';
const breachKey = (b: Breach) =>
  `${b.evaluation.threshold.id}${SEP}${b.key.join(SEP)}@${b.date}`;
const money = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * The consequence of replacing `before` with `after`.
 *
 * `docs` is the rest of the workspace — cross-document references have to
 * resolve for either version to be runnable at all, and a rule set is judged
 * against the view that uses it rather than in isolation.
 */
export function assessChange(
  file: string,
  before: string,
  after: string,
  docs: Record<string, string>,
  fixture: FixtureName = 'nominal',
): ImpactReport {
  if (before === after) return EMPTY;

  let beforeGraph: Graph;
  let afterGraph: Graph;
  try {
    beforeGraph = parseDoc(before);
    afterGraph = parseDoc(after);
  } catch {
    // An unreadable version has no computable consequence, and the diagnostics
    // layer is already saying something far more useful than a guess.
    return EMPTY;
  }

  const findings: Finding[] = [];
  const kind = afterGraph.kind;

  if (kind === 'variance_monitor') {
    findings.push(...monitorFindings(file, before, after, docs, fixture));
  }
  if (kind === 'classification') {
    findings.push(...classificationFindings(file, before, after, docs, fixture));
  }
  if (kind === 'report') {
    findings.push(...reportFindings(beforeGraph, afterGraph));
  }
  if (kind === 'parameter_set') {
    findings.push(...parameterFindings(beforeGraph, afterGraph));
  }

  findings.sort((a, b) => CONSEQUENCE_RANK[a.consequence] - CONSEQUENCE_RANK[b.consequence]);
  return {
    findings,
    // What "needs review" means: an edit whose failure mode is silence, a
    // restatement of filings already made, or a change to what is submitted.
    // Tightening a threshold is not on the list — a control that fires more
    // often is a decision somebody can see the results of.
    needsReview: findings.some((f) => f.direction === 'weakens'),
  };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * Run the monitor both ways and compare the breach lists.
 *
 * This is the finding that matters, and running it is what makes it a fact
 * rather than an inference. A threshold whose limit doubled but which never
 * fired anyway has weakened nothing anyone can observe; a threshold whose
 * trailing window went from 30 days to 60 has not obviously loosened at all
 * until you notice it now spans a quiet period and stops flagging a series.
 * Only execution tells those apart.
 */
function monitorFindings(
  file: string,
  before: string,
  after: string,
  docs: Record<string, string>,
  fixture: FixtureName,
): Finding[] {
  const run = (text: string) => {
    try {
      const workspace = { ...docs, [file]: text };
      const g = parseDoc(text);
      const monitor = readMonitor(g);
      const registry = buildRegistry(workspace);
      const reportGraph = Object.values(workspace)
        .map((d) => {
          try {
            return parseDoc(d);
          } catch {
            return null;
          }
        })
        .find((x): x is Graph => !!x && x.kind === 'report' && x.docName === monitor.report);
      if (!reportGraph) return null;

      const spec = readReport(reportGraph);
      const viewGraph = Object.values(workspace)
        .map((d) => {
          try {
            return parseDoc(d);
          } catch {
            return null;
          }
        })
        .find((x): x is Graph => !!x && x.kind === 'metrics_view'
          && (x.view.view || '').trim() === spec.view);
      if (!viewGraph) return null;

      return runMonitor(monitor, spec, viewGraph, registry, fixture);
    } catch {
      return null;
    }
  };

  const a = run(before);
  const b = run(after);
  if (!a || !b) return [];

  const wasBreaching = new Map(a.breaches.map((x) => [breachKey(x), x]));
  const nowBreaching = new Set(b.breaches.map(breachKey));

  const silenced = a.breaches.filter((x) => !nowBreaching.has(breachKey(x)));
  const added = b.breaches.filter((x) => !wasBreaching.has(breachKey(x)));

  const findings: Finding[] = [];

  if (silenced.length) {
    // The headline is the count of *series*, not of key-days: "12 series stop
    // being watched" is the governance fact; "37 breaches" is a number whose
    // size depends on how long the window happens to be.
    const series = new Set(silenced.map((x) => x.key.join(' · ')));
    const largest = silenced.slice().sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0];

    findings.push({
      consequence: 'control',
      direction: 'weakens',
      summary: `Silences ${silenced.length} breach${silenced.length === 1 ? '' : 'es'} `
        + `across ${series.size} series`,
      detail: [
        `On today's data, ${silenced.length} move${silenced.length === 1 ? '' : 's'} that `
          + `currently breach would pass after this change.`,
        `Largest silenced move: ${largest.key.join(' · ')} on ${largest.date}, `
          + `${largest.delta >= 0 ? '+' : '−'}${money(largest.delta)}.`,
        'A control that stops firing is not a smaller version of a wrong number — '
          + 'it is the reason the next wrong number would not be caught.',
      ],
      silenced: silenced.slice(0, 25).map((x) => ({
        key: x.key.join(' · '), date: x.date, delta: x.delta,
      })),
    });
  }

  if (added.length) {
    findings.push({
      consequence: 'control',
      direction: 'strengthens',
      summary: `Raises ${added.length} new breach${added.length === 1 ? '' : 'es'}`,
      detail: [
        `${added.length} move${added.length === 1 ? '' : 's'} that currently pass would `
          + 'breach after this change.',
        'Worth checking the alert volume is one somebody will actually read.',
      ],
    });
  }

  // A threshold that disappears entirely does not show up as a silenced breach
  // if it was never firing — and "this rollup is no longer watched at all" is a
  // governance fact regardless of whether it happened to be breaching today.
  const wasWatched = new Set(a.stats.map((s) => s.id));
  const nowWatched = new Set(b.stats.map((s) => s.id));
  const dropped = [...wasWatched].filter((id) => !nowWatched.has(id));
  if (dropped.length) {
    findings.push({
      consequence: 'control',
      direction: 'weakens',
      summary: `Removes ${dropped.length} threshold${dropped.length === 1 ? '' : 's'}: `
        + dropped.join(', '),
      detail: [
        'A removed threshold raises no breaches by definition, so its absence is '
          + 'invisible in an alert count. It is visible here and nowhere else.',
      ],
    });
  }

  if (a.keys && b.keys && b.keys < a.keys) {
    findings.push({
      consequence: 'control',
      direction: 'weakens',
      summary: `Watches ${a.keys - b.keys} fewer rollup${a.keys - b.keys === 1 ? '' : 's'}`,
      detail: [
        `The grain change takes the monitor from ${a.keys} series to ${b.keys}. `
          + 'Rollups outside the new grain are no longer compared to anything.',
      ],
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Restatement
// ---------------------------------------------------------------------------

/**
 * A rule change re-states history.
 *
 * Effective dating already exists, so the *mechanism* for doing this correctly
 * is there. What was missing is the prompt: an author editing a `when:` clause
 * is making a decision about every filing computed under the old rule, and
 * nothing asked them whether they meant to.
 */
function classificationFindings(
  file: string,
  before: string,
  after: string,
  docs: Record<string, string>,
  fixture: FixtureName,
): Finding[] {
  const migration = migrationFor(file, before, after, docs, fixture);
  if (!migration.length) return [];

  const records = migration.reduce((n, m) => n + m.records, 0);
  const notional = migration.reduce((n, m) => n + m.notional, 0);
  const biggest = migration.slice().sort((a, b) => b.records - a.records)[0];

  // A record leaving a bucket for *nothing* is a different and worse event than
  // one moving between buckets: it means the rule set no longer classifies it.
  const unmapped = migration.filter((m) => m.to === '');

  const detail = [
    `${records} record${records === 1 ? '' : 's'} change classification on today's `
      + `data, moving ${money(notional)}.`,
    `Largest move: ${biggest.from || '(unmapped)'} → ${biggest.to || '(unmapped)'}, `
      + `${biggest.records} records.`,
    'Every filing already made under the previous rule set was computed differently. '
      + 'Set `effective.from` if this should apply going forward rather than restating.',
  ];

  if (unmapped.length) {
    const lost = unmapped.reduce((n, m) => n + m.records, 0);
    detail.splice(1, 0,
      `${lost} record${lost === 1 ? '' : 's'} become unmapped — no rule matches them at all.`);
  }

  return [{
    consequence: 'restatement',
    direction: unmapped.length ? 'weakens' : 'changes',
    summary: `Reclassifies ${records} record${records === 1 ? '' : 's'} (${money(notional)})`,
    detail,
    movedRecords: records,
    movedNotional: notional,
  }];
}

/** Run the rule set both ways over the same rows and diff the assignments. */
function migrationFor(
  file: string,
  before: string,
  after: string,
  docs: Record<string, string>,
  fixture: FixtureName,
): Migration[] {
  try {
    const name = parseDoc(after).docName;
    // The document that classifies with this rule set decides which rows it sees
    // and which column it writes — judging a rule set against anything else
    // would give a number that is not about this workspace. That document is a
    // metrics view or, once the stage is shared, the prepared source; both name
    // a `source:` and declare the derivation, which is all this needs.
    const view = Object.values(docs)
      .map((d) => {
        try {
          return parseDoc(d);
        } catch {
          return null;
        }
      })
      .find((g): g is Graph => !!g
        && (g.kind === 'metrics_view' || g.kind === 'prepared_source')
        && derivationsOf(g).some((x) => x.op === 'classify' && x.using === name));
    if (!view) return [];

    const derivation = derivationsOf(view).find((x) => x.op === 'classify' && x.using === name)!;
    const source = (view.view.source || '').trim();
    const rows: Row[] = TABLES[fixture]?.[source]?.[AS_OF] || [];
    if (!rows.length) return [];

    const one = (text: string) => {
      const registry = buildRegistry({ ...docs, [file]: text });
      const classification = resolveClassification(registry, name, AS_OF);
      if (!classification) return null;
      const copy = rows.map((r) => ({ ...r }));
      const coverage = runClassification(classification, copy, DOMAINS, derivation.name);
      // The rule set names the column that weights its coverage; taking it from
      // there rather than assuming one keeps the money figure honest for a rule
      // set over something that is not `balance_usd`.
      return { coverage, rows: copy, notional: classification.notional };
    };

    const a = one(before);
    const b = one(after);
    if (!a || !b) return [];
    return classificationMigration(a.coverage, b.coverage, a.rows, b.rows, b.notional);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The filed shape, and the assumptions behind it
// ---------------------------------------------------------------------------

function reportFindings(before: Graph, after: Graph): Finding[] {
  const a = readReport(before);
  const b = readReport(after);
  const findings: Finding[] = [];

  const gained = b.grouping.filter((g) => !a.grouping.includes(g));
  const lost = a.grouping.filter((g) => !b.grouping.includes(g));
  if (gained.length || lost.length) {
    findings.push({
      consequence: 'filed',
      direction: lost.length ? 'weakens' : 'changes',
      summary: 'Changes the grain of what is filed',
      detail: [
        lost.length ? `No longer split by: ${lost.join(', ')}.` : '',
        gained.length ? `Now split by: ${gained.join(', ')}.` : '',
        'The submission changes shape, and any monitor watching it at the old grain '
          + 'is watching series that no longer exist.',
      ].filter(Boolean),
    });
  }

  const droppedMeasures = a.measures.filter((m) => !b.measures.includes(m));
  if (droppedMeasures.length) {
    findings.push({
      consequence: 'filed',
      direction: 'weakens',
      summary: `Stops filing ${droppedMeasures.join(', ')}`,
      detail: ['A measure that is no longer filed is no longer reconcilable against '
        + 'anything downstream that still expects it.'],
    });
  }

  if (a.table !== b.table && a.table) {
    findings.push({
      consequence: 'filed',
      direction: 'changes',
      summary: `Writes to ${b.table || '(nowhere)'} instead of ${a.table}`,
      detail: ['Anything reading the old table keeps reading the old table, which '
        + 'will quietly go stale rather than fail.'],
    });
  }

  return findings;
}

function parameterFindings(before: Graph, after: Graph): Finding[] {
  const field = (after.view.value || '').trim();
  if (!field) return [];

  // A rate table's rows live in `entries:`, not in `measures:` — `graph.measures`
  // is empty for this kind, which is why an earlier version of this function
  // reported nothing at all for a changed rate.
  const rows = (g: Graph) => {
    const out: Record<string, Measure> = {};
    sectionBlocks(g, 'entries').forEach((b) => {
      out[b.name] = b;
    });
    return out;
  };

  const a = rows(before);
  const b = rows(after);
  const changed: string[] = [];
  // A citation that does not move with the rate it justifies is the thing a
  // reviewer is actually looking for, so it is tracked rather than assumed.
  let uncited = 0;

  Object.keys(b).forEach((key) => {
    const was = a[key];
    if (!was) {
      changed.push(`${key} added at ${(b[key].f[field] || '').trim()}`);
      return;
    }
    const from = (was.f[field] || '').trim();
    const to = (b[key].f[field] || '').trim();
    if (from === to) return;
    changed.push(`${key}: ${from} → ${to}`);
    if ((was.f.citation || '').trim() === (b[key].f.citation || '').trim()) uncited++;
  });
  Object.keys(a).forEach((key) => {
    if (!b[key]) changed.push(`${key} removed`);
  });

  if (!changed.length) return [];

  const detail = [
    ...changed.slice(0, 8),
    ...(changed.length > 8 ? [`…and ${changed.length - 8} more`] : []),
  ];
  if (uncited) {
    detail.push(
      `${uncited} rate${uncited === 1 ? '' : 's'} moved without its citation moving. `
      + 'A governed assumption changing under an unchanged authority is the case '
      + 'worth explaining.',
    );
  }

  return [{
    consequence: 'assumption',
    direction: uncited ? 'weakens' : 'changes',
    summary: `Changes ${changed.length} governed rate${changed.length === 1 ? '' : 's'}`,
    detail,
  }];
}
