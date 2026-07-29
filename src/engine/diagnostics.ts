/**
 * The KEEL diagnostic catalogue.
 *
 * Severity is coupled to governance tier: the same missing description is
 * informational on an exploratory metric and blocking on one model risk will
 * validate. Messages are written for a reader, not a compiler — the code stays
 * for the linter's contract, the sentence carries the meaning.
 *
 * Every fix is a pure text transformation the author can read in a diff before
 * accepting. Nothing here rewrites silently.
 */

import { lev } from './format';
import { exprNames, ownerAt, reqs, type Graph, type Measure } from './parse';
import type { Evaluator } from './evaluate';
import {
  AGGREGATES, ALGEBRA_OPS, COLUMNS, DIMS, ENUMS, ENUM_LABEL, EXTERNAL, FUNCS,
  isReferenceName, KEYWORDS, spanPermitsMultipleDates, UNSUPPORTED, type Severity,
} from './vocab';
import {
  CLASSIFICATION_BLOCKING, diagnoseClassification, diagnoseDerivations, diagnoseParameterSet,
} from './classification-diagnostics';
import { buildRegistry, type Registry } from './registry';
import { derivationsOf } from './rows';

export type Fix =
  | { kind: 'rename'; from: string; to: string; line: number }
  /** Rename an identifier across every line — used for snake_case. */
  | { kind: 'renameAll'; from: string; to: string }
  | { kind: 'addReq'; name: string; line: number }
  | { kind: 'dropReq'; name: string; line: number }
  /** Replace whatever follows `key:` on one line. */
  | { kind: 'setValue'; line: number; value: string }
  | { kind: 'insertAfter'; line: number; lines: string[] }
  /** Drop one entry from an inline `[a, b, c]` list. */
  | { kind: 'removeFromList'; line: number; item: string }
  /** Turn a duplicated definition into a reference to the original. */
  | { kind: 'extractToRef'; measure: string; target: string };

export interface Diagnostic {
  code: string;
  sev: Severity;
  message: string;
  /** 0-based line index. */
  line: number;
  /** Identifier the message is about — underlined inline, rather than the whole line. */
  token?: string;
  fix?: Fix;
  fixLabel?: string;
}

/** Codes that mean the definition cannot compile — these, and only these, make a value stale. */
export const COMPILE_BLOCKING: Record<string, true> = {
  KEEL001: true, KEEL002: true, KEEL003: true, KEEL004: true, KEEL005: true,
  KEEL007: true, KEEL010: true, KEEL012: true, KEEL020: true, KEEL022: true,
  KEEL024: true, KEEL044: true, KEEL052: true,
  ...CLASSIFICATION_BLOCKING,
};

/** The line a field's text actually occupies — see `Measure.contentOf`. */
function at(m: Measure, key: string): number {
  return m.contentOf[key] !== undefined ? m.contentOf[key] : m.lineOf[key];
}

function tierOf(m: Measure): number {
  return parseInt(m.f.sr_11_7_tier || '0', 10);
}

function listItems(raw: string): string[] {
  return (raw || '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Direct dependencies of a measure: `requires` plus anything named in the expression. */
function edgesOf(m: Measure): string[] {
  const out = reqs(m).concat(exprNames(m).filter(isReferenceName));
  return out.filter((n, i, a) => a.indexOf(n) === i);
}

/**
 * Cycles in the dependency graph, each returned as the path that closes it.
 * Reported once per cycle rather than once per member, so a two-measure loop
 * does not produce two mirror-image errors.
 */
function findCycles(g: Graph): Array<{ member: string; path: string[] }> {
  const found: Array<{ member: string; path: string[] }> = [];
  const seenKey: Record<string, true> = {};
  const state: Record<string, 0 | 1 | 2> = {};
  const stack: string[] = [];

  const visit = (name: string) => {
    if (state[name] === 2) return;
    if (state[name] === 1) {
      const start = stack.indexOf(name);
      if (start < 0) return;
      const path = stack.slice(start).concat(name);
      // Canonical key, so the same loop reached from a different entry point
      // is not reported twice.
      const key = [...path.slice(0, -1)].sort().join('>');
      if (!seenKey[key]) {
        seenKey[key] = true;
        found.push({ member: path[0], path });
      }
      return;
    }
    const m = g.byName[name];
    if (!m) return;
    state[name] = 1;
    stack.push(name);
    edgesOf(m).forEach(visit);
    stack.pop();
    state[name] = 2;
  };

  g.measures.forEach((m) => visit(m.name));
  return found;
}

/** Identifiers used in call position — `foo(` — which must name a registered function. */
function calledFunctions(m: Measure): string[] {
  const src = m.f.expression || '';
  const out: string[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(src)) !== null) {
    if (!(hit[1].toLowerCase() in KEYWORDS)) out.push(hit[1]);
  }
  return out.filter((n, i, a) => a.indexOf(n) === i);
}

function maxDepth(src: string): number {
  let depth = 0;
  let peak = 0;
  for (const ch of src) {
    if (ch === '(') peak = Math.max(peak, ++depth);
    if (ch === ')') depth--;
  }
  return peak;
}

function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

/** The shape a `simple` measure computes, for duplicate detection. */
function shapeOf(m: Measure): string | null {
  if ((m.f.type || '').trim() !== 'simple' || !m.f.field) return null;
  return `${(m.f.agg || 'sum').trim()}(${m.f.field.trim()})|${(m.f.where || '').trim()}`;
}

/**
 * Dispatch on document kind. A classification is not a metrics view with rules
 * in it — the questions worth asking of each are different, so the rule sets
 * are separate rather than one function branching internally.
 */
export function diagnose(
  g: Graph,
  ev: Evaluator,
  baseline?: Graph,
  registry: Registry = buildRegistry({}),
): Diagnostic[] {
  if (g.kind === 'classification') return diagnoseClassification(g, ev, registry, baseline);
  if (g.kind === 'parameter_set') return diagnoseParameterSet(g, registry, baseline);
  return diagnoseMetricsView(g, ev, baseline, registry);
}

function diagnoseMetricsView(
  g: Graph,
  ev: Evaluator,
  baseline: Graph | undefined,
  registry: Registry,
): Diagnostic[] {
  const out: Diagnostic[] = diagnoseDerivations(g, ev, registry);
  // A derivation writes a column, so `field:` and `where:` may legitimately
  // name it even though the source model does not.
  const cols = (COLUMNS[g.view.source] || []).concat(derivationsOf(g).map((d) => d.name));
  const scope = Object.keys(g.byName).concat(Object.keys(EXTERNAL));
  const grainType = (g.view.type || '').trim();
  const span = (g.view.max_query_span || '').trim();
  const targets = listItems(g.view.targets || '');
  const targetsLine = g.info.findIndex((i) => i.key === 'targets');

  // ---- view-level grain (KEEL011 / KEEL013) ------------------------------
  const spanLine = g.info.findIndex((i) => i.key === 'max_query_span');
  const asOfLine = g.info.findIndex((i) => i.key === 'as_of_field');

  if (grainType === 'stock' && !span) {
    out.push({
      code: 'KEEL011',
      sev: 'error',
      message: 'A point-in-time view needs max_query_span, or a query can silently span dates',
      line: asOfLine >= 0 ? asOfLine : 0,
      fix: { kind: 'insertAfter', line: asOfLine >= 0 ? asOfLine : 0, lines: ['  max_query_span: P1D'] },
      fixLabel: 'Insert P1D',
    });
  }

  if (grainType === 'stock' && span && spanPermitsMultipleDates(span) && spanLine >= 0) {
    out.push({
      code: 'KEEL013',
      sev: 'warn',
      message: `max_query_span of ${span} lets a point-in-time measure be added up across dates`,
      line: spanLine,
      token: span,
      fix: { kind: 'setValue', line: spanLine, value: 'P1D' },
      fixLabel: 'Use P1D',
    });
  }

  // ---- cycles (KEEL002) --------------------------------------------------
  findCycles(g).forEach(({ member, path }) => {
    const m = g.byName[member];
    if (!m) return;
    out.push({
      code: 'KEEL002',
      sev: 'error',
      message: `These measures depend on each other in a loop: ${path.join(' → ')}`,
      line: m.lineOf.requires !== undefined ? at(m, 'requires') : m.lineOf.name,
    });
  });

  // ---- a signed-off measure renamed away (KEEL034) -----------------------
  if (baseline) {
    baseline.measures.forEach((old) => {
      if ((old.f.validation_status || '').trim() !== 'validated') return;
      if (g.byName[old.name]) return;
      const broken = baseline.measures.filter((m) => edgesOf(m).indexOf(old.name) >= 0).length;
      if (!broken) return;
      out.push({
        code: 'KEEL034',
        sev: 'warn',
        message:
          `${old.name} was signed off and is no longer defined — ` +
          `${broken} measure${broken === 1 ? '' : 's'} referenced it`,
        line: 0,
      });
    });
  }

  g.measures.forEach((m) => {
    const required = reqs(m);
    const tier = tierOf(m);
    const type = (m.f.type || '').trim();
    const expression = m.f.expression || '';

    // --- closed-choice fields (KEEL044) ---
    (['type', 'format', 'agg', 'sr_11_7_tier', 'validation_status', 'grain',
      'window.op', 'window.over', 'window.frame'] as const).forEach((k) => {
      const v = (m.f[k] || '').trim();
      if (!v || !ENUMS[k] || ENUMS[k].indexOf(v) >= 0) return;
      let best = ENUMS[k][0];
      let bd = 99;
      ENUMS[k].forEach((o) => {
        const d = lev(v, o);
        if (d < bd) {
          bd = d;
          best = o;
        }
      });
      out.push({
        code: 'KEEL044',
        sev: 'error',
        message: `“${v}” is not a valid ${ENUM_LABEL[k] || k}. Choose one of: ${ENUMS[k].join(', ')}.`,
        line: at(m, k),
        token: v,
        fix: { kind: 'rename', from: v, to: best, line: at(m, k) },
        fixLabel: `Use ${best}`,
      });
    });

    // --- source binding (KEEL004) ---
    if (type === 'simple' && m.f.field && cols.indexOf(m.f.field) < 0) {
      out.push({
        code: 'KEEL004',
        sev: 'error',
        message: `Column ${m.f.field} not found on source ${g.view.source}`,
        line: at(m, 'field'),
        token: m.f.field,
      });
    }

    // --- grain (KEEL010 / KEEL012) ---
    const measureGrain = (m.f.grain || '').trim();
    if (measureGrain && grainType && measureGrain !== grainType) {
      out.push({
        code: 'KEEL012',
        sev: 'error',
        message: `This view is ${grainType}, but ${m.name} is ${measureGrain} — they cannot be mixed`,
        line: at(m, 'grain'),
        token: measureGrain,
        fix: { kind: 'setValue', line: at(m, 'grain'), value: grainType },
        fixLabel: `Use ${grainType}`,
      });
    }

    if (
      type === 'simple' && grainType === 'stock' && span && spanPermitsMultipleDates(span) &&
      ['sum', 'count', 'weighted_avg'].indexOf((m.f.agg || 'sum').trim()) >= 0
    ) {
      out.push({
        code: 'KEEL010',
        sev: 'error',
        message:
          `${m.name} is a balance at a point in time, so adding it up across dates is wrong. ` +
          `Use last, first or avg over ${g.view.as_of_field || 'as_of_date'}.`,
        line: at(m, 'agg'),
        token: (m.f.agg || 'sum').trim(),
        fix: { kind: 'setValue', line: at(m, 'agg'), value: 'last' },
        fixLabel: 'Use last',
      });
    }

    // --- a weighted average needs its weight (KEEL024) ---
    if ((m.f.agg || '').trim() === 'weighted_avg' && !m.f.weight) {
      // Propose a real column rather than an empty stub: a fix that leaves its
      // own diagnostic standing is not a fix. The author reads it in the diff.
      const suggestion = cols.find((c) => c !== m.f.field && !/_date$|_id$|_code$/.test(c));
      out.push({
        code: 'KEEL024',
        sev: 'error',
        message: `${m.name} averages by weight, so it needs a weight column`,
        line: at(m, 'agg'),
        fix: suggestion
          ? { kind: 'insertAfter', line: at(m, 'agg'), lines: [`    weight: ${suggestion}`] }
          : undefined,
        fixLabel: suggestion ? `Weight by ${suggestion}` : undefined,
      });
    }

    // --- filters (KEEL050 / 051 / 052) ---
    if (type === 'simple') {
      const r = ev.value(m.name);
      if (r.predErr) {
        out.push({
          code: 'KEEL052',
          sev: 'error',
          message: `This filter can’t be read — ${r.predErr}`,
          line: at(m, 'where'),
        });
      }
      (r.predCols || []).forEach((cn) => {
        if (cols.indexOf(cn) < 0) {
          out.push({
            code: 'KEEL050',
            sev: 'error',
            message: `The filter uses ${cn}, which is not a column on ${g.view.source}`,
            line: at(m, 'where'),
            token: cn,
          });
        }
      });
      if (!r.predErr && m.f.where && r.rows === 0) {
        out.push({
          code: 'KEEL051',
          sev: 'warn',
          message: `The filter on ${m.name} matches no rows in this test data, so the answer is empty`,
          line: at(m, 'where'),
        });
      }
    }

    // --- trailing windows (KEEL023 / 025 / 026 / 027) ---
    if (type === 'windowed') {
      if (!m.f['window.op']) {
        out.push({
          code: 'KEEL025',
          sev: 'error',
          message: `${m.name} looks across dates, so it needs window.op — for example stddev or delta`,
          line: m.lineOf.name,
          fix: {
            kind: 'insertAfter',
            line: m.lineOf.name,
            lines: ['    window.op: stddev', '    window.over: 30d', '    window.order_by: as_of_date'],
          },
          fixLabel: 'Add window',
        });
      }
      if (required.length !== 1) {
        out.push({
          code: 'KEEL027',
          sev: 'error',
          message: `${m.name} must list exactly one measure in requires — the series it looks across`,
          line: m.lineOf.requires !== undefined ? at(m, 'requires') : m.lineOf.name,
        });
      }
      if (m.f['window.over'] && !/^\d+d$/.test((m.f['window.over'] || '').trim())) {
        out.push({
          code: 'KEEL026',
          sev: 'error',
          message: 'window.over must be a number of days, like 30d',
          line: at(m, 'window.over'),
        });
      }
      if ((m.f['window.frame'] || '').trim() === 'rows') {
        out.push({
          code: 'KEEL023',
          sev: 'warn',
          message:
            'Counting rows makes this window shift whenever data arrives. Measure it in time instead.',
          line: at(m, 'window.frame'),
          token: 'rows',
          fix: { kind: 'setValue', line: at(m, 'window.frame'), value: 'time' },
          fixLabel: 'Use time',
        });
      }
    }

    // --- reference resolution (KEEL001 / 005 / 006 / 007 / 035) ---
    const used = exprNames(m).filter(isReferenceName);
    const called = calledFunctions(m);

    called.forEach((fn) => {
      if (fn in FUNCS) return;
      let best = '';
      let bd = 99;
      Object.keys(FUNCS).forEach((f) => {
        const d = lev(fn, f);
        if (d < bd) {
          bd = d;
          best = f;
        }
      });
      out.push({
        code: 'KEEL007',
        sev: 'error',
        message: `There is no function called ${fn}${bd <= 3 ? `. Did you mean ${best}?` : '.'}`,
        line: at(m, 'expression'),
        token: fn,
        fix: bd <= 3 ? { kind: 'rename', from: fn, to: best, line: at(m, 'expression') } : undefined,
        fixLabel: `Use ${best}`,
      });
    });

    used.forEach((n) => {
      // A name in call position is a function problem, not a missing measure.
      if (called.indexOf(n) >= 0) return;
      if (scope.indexOf(n) < 0) {
        let best = '';
        let bd = 99;
        scope.forEach((s) => {
          const d = lev(n, s);
          if (d < bd) {
            bd = d;
            best = s;
          }
        });
        out.push({
          code: 'KEEL001',
          sev: 'error',
          message: `Unknown measure ${n}${bd <= 4 ? `. Did you mean ${best}?` : '.'}`,
          line: at(m, 'expression'),
          token: n,
          fix: bd <= 4 ? { kind: 'rename', from: n, to: best, line: at(m, 'expression') } : undefined,
          fixLabel: `Use ${best}`,
        });
      } else if (required.indexOf(n) < 0) {
        out.push({
          code: 'KEEL005',
          sev: 'error',
          message: `${n} is used in the formula but missing from requires, its dependency list`,
          line: at(m, 'expression'),
          token: n,
          fix: { kind: 'addReq', name: n, line: at(m, 'requires') },
          fixLabel: 'Add to requires',
        });
      }
      if (EXTERNAL[n] && EXTERNAL[n].deprecated) {
        out.push({
          code: 'KEEL035',
          sev: 'warn',
          message: `${n} is being retired — move off it before this goes for review`,
          line: at(m, 'expression'),
          token: n,
        });
      }
    });

    required.forEach((n) => {
      if (used.indexOf(n) < 0 && expression) {
        out.push({
          code: 'KEEL006',
          sev: 'warn',
          message: `${n} is listed in requires but never used in the formula`,
          line: at(m, 'requires'),
          token: n,
          fix: { kind: 'dropReq', name: n, line: at(m, 'requires') },
          fixLabel: 'Remove',
        });
      }
    });

    // --- dimensions (KEEL003) ---
    (['partition_by', 'order_by', 'window.partition_by', 'window.order_by'] as const).forEach((k) => {
      if (m.f[k] === undefined) return;
      listItems(m.f[k]).forEach((n) => {
        if (DIMS[n] || cols.indexOf(n) >= 0) return;
        out.push({
          code: 'KEEL003',
          sev: 'error',
          message: `There is no grouping or column called ${n}`,
          line: at(m, k),
          token: n,
        });
      });
    });

    // --- algebra and portability (KEEL020 / 021 / 022) ---
    if (expression) {
      const ops = expression.match(/[^A-Za-z0-9_\s'".]/g) || [];
      ops
        .filter((o) => !ALGEBRA_OPS[o])
        .filter((o, i, a) => a.indexOf(o) === i)
        .forEach((o) => {
          out.push({
            code: 'KEEL020',
            sev: 'error',
            message: `“${o}” is not an operator the metric algebra knows`,
            line: at(m, 'expression'),
            token: o,
          });
        });
    }

    if (type === 'derived') {
      called.forEach((fn) => {
        if (!AGGREGATES[fn.toLowerCase()]) return;
        out.push({
          code: 'KEEL022',
          sev: 'error',
          message:
            `${fn}() folds rows, but a derived measure composes other measures rather than ` +
            'reading the table. Move it into a simple measure and reference that.',
          line: at(m, 'expression'),
          token: fn,
        });
      });
    }

    exprNames(m).forEach((n) => {
      const backend = UNSUPPORTED[n];
      if (!backend) return;
      if (!targets.some((b) => b.toLowerCase() === backend.toLowerCase())) return;
      out.push({
        code: 'KEEL021',
        sev: 'warn',
        message: `${backend} can’t run ${n}, so this measure won’t work there`,
        line: at(m, 'expression'),
        token: n,
        fix: targetsLine >= 0
          ? { kind: 'removeFromList', line: targetsLine, item: backend.toLowerCase() }
          : undefined,
        fixLabel: `Drop ${backend.toLowerCase()}`,
      });
    });

    // --- governance (KEEL030 / 031 / 032 / 033) ---
    if (tier >= 1 && !m.f.description) {
      out.push({
        code: 'KEEL030',
        sev: tier <= 2 ? 'error' : 'warn',
        message: `${m.name} is under oversight level ${tier}, so it needs a description`,
        line: m.lineOf.name,
        fix: {
          kind: 'insertAfter',
          line: m.lineOf.name,
          lines: [`    description: TODO — describe what ${m.name} computes and why.`],
        },
        fixLabel: 'Insert stub',
      });
    }
    if (tier >= 1 && !m.f.citation) {
      out.push({
        code: 'KEEL031',
        sev: 'error',
        message: `${m.name} is under oversight level ${tier}, so it needs the rule it comes from`,
        line: m.lineOf.name,
      });
    }

    // Editing a signed-off measure is permitted — the diagnostic and the audit
    // record are the control, not a lock (§11).
    if (baseline && (m.f.validation_status || '').trim() === 'validated' && !m.f.change_ticket) {
      const before = baseline.byName[m.name];
      if (before && JSON.stringify(before.f) !== JSON.stringify(m.f)) {
        out.push({
          code: 'KEEL032',
          sev: 'error',
          message: `${m.name} is signed off. Editing it needs a change ticket so the change can be traced.`,
          line: m.lineOf.name,
          fix: { kind: 'insertAfter', line: m.lineOf.name, lines: ['    change_ticket: TODO-0000'] },
          fixLabel: 'Add ticket',
        });
      }
    }

    if (!m.f.valid_range) {
      out.push({
        code: 'KEEL033',
        sev: 'info',
        message: `${m.name} has no valid_range, so nothing can be tested against it automatically`,
        line: m.lineOf.name,
        fix: { kind: 'insertAfter', line: m.lineOf.name, lines: ['    valid_range: [0, 0]'] },
        fixLabel: 'Add range',
      });
    }

    // --- style (KEEL041 / 042 / 043) ---
    if (!/^[a-z][a-z0-9_]*$/.test(m.name)) {
      out.push({
        code: 'KEEL041',
        sev: 'info',
        message: `${m.name} should be lowercase_with_underscores`,
        line: m.lineOf.name,
        token: m.name,
        fix: { kind: 'renameAll', from: m.name, to: snakeCase(m.name) },
        fixLabel: `Rename to ${snakeCase(m.name)}`,
      });
    }
    if (!m.f.format) {
      out.push({
        code: 'KEEL042',
        sev: 'info',
        message: `${m.name} has no format, so the number will display raw`,
        line: m.lineOf.name,
      });
    }
    const depth = maxDepth(expression);
    if (depth > 3) {
      out.push({
        code: 'KEEL043',
        sev: 'info',
        message:
          `${m.name} nests ${depth} levels deep. Pulling a step out into its own measure would ` +
          'make it readable — and reviewable.',
        line: at(m, 'expression'),
      });
    }
  });

  // --- duplicated definitions (KEEL040) ---
  const byShape: Record<string, Measure[]> = {};
  g.measures.forEach((m) => {
    const shape = shapeOf(m);
    if (!shape) return;
    (byShape[shape] || (byShape[shape] = [])).push(m);
  });
  Object.keys(byShape).forEach((shape) => {
    const group = byShape[shape];
    if (group.length < 2) return;
    const original = group[0];
    group.slice(1).forEach((dupe) => {
      out.push({
        code: 'KEEL040',
        sev: 'info',
        message: `${dupe.name} computes the same thing as ${original.name}. Reference it instead?`,
        line: dupe.lineOf.name,
        fix: { kind: 'extractToRef', measure: dupe.name, target: original.name },
        fixLabel: `Use ${original.name}`,
      });
    });
  });

  return out.filter((d) => d.line !== undefined && d.line >= 0);
}

// ---------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace whatever follows the first `key:` on a line, keeping indentation. */
function setValueOn(line: string, value: string): string {
  return line.replace(/^(\s*(?:-\s*)?[a-z_0-9.]+:).*$/, `$1 ${value}`);
}

/**
 * Apply a quick fix to a document. Pure — returns new lines, never mutates,
 * and never touches a line the fix did not name.
 */
export function applyFix(lines: string[], fix: Fix, g: Graph): string[] {
  const next = lines.slice();

  if (fix.kind === 'rename') {
    const t = next[fix.line];
    if (t === undefined) return lines;
    next[fix.line] = t.replace(new RegExp(`\\b${escapeRe(fix.from)}\\b`, 'g'), fix.to);
    return next;
  }

  if (fix.kind === 'renameAll') {
    const re = new RegExp(`\\b${escapeRe(fix.from)}\\b`, 'g');
    return next.map((l) => l.replace(re, fix.to));
  }

  if (fix.kind === 'setValue') {
    if (next[fix.line] === undefined) return lines;
    next[fix.line] = setValueOn(next[fix.line], fix.value);
    return next;
  }

  if (fix.kind === 'insertAfter') {
    if (fix.line < 0 || fix.line >= next.length) return lines;
    next.splice(fix.line + 1, 0, ...fix.lines);
    return next;
  }

  if (fix.kind === 'removeFromList') {
    const t = next[fix.line];
    if (t === undefined) return lines;
    const item = escapeRe(fix.item);
    next[fix.line] = t
      .replace(new RegExp(`,\\s*${item}\\b|\\b${item}\\s*,\\s*|\\b${item}\\b`), '')
      .replace(/\[\s*,\s*/, '[');
    return next;
  }

  if (fix.kind === 'addReq') {
    // No `requires:` line yet — write one under the measure's `type:`.
    if (fix.line === undefined || next[fix.line] === undefined) {
      const owner = ownerAt(g, fix.line);
      if (!owner) return lines;
      const anchor = owner.lineOf.type !== undefined ? owner.lineOf.type : owner.line;
      next.splice(anchor + 1, 0, `    requires: [${fix.name}]`);
      return next;
    }
    const t = next[fix.line];
    next[fix.line] = /\]\s*$/.test(t)
      ? t.replace(/\]\s*$/, `${/\[\s*\]/.test(t) ? '' : ', '}${fix.name}]`)
      : `${t.replace(/\s*$/, '')} ${fix.name}`;
    return next;
  }

  if (fix.kind === 'dropReq') {
    const t = next[fix.line];
    if (t === undefined) return lines;
    const n = escapeRe(fix.name);
    next[fix.line] = t
      .replace(new RegExp(`,\\s*${n}\\b|\\b${n}\\s*,\\s*|\\b${n}\\b`), '')
      .replace(/\[\s*,/, '[');
    return next;
  }

  if (fix.kind === 'extractToRef') {
    const m = g.byName[fix.measure];
    if (!m) return lines;
    // Swap the duplicated body for a reference, leaving name / label /
    // description and everything after it untouched.
    const dropLines = new Set<number>();
    ['type', 'agg', 'field', 'where'].forEach((k) => {
      if (m.lineOf[k] !== undefined) dropLines.add(m.lineOf[k]);
    });
    if (!dropLines.size) return lines;

    const first = Math.min(...dropLines);
    const rebuilt: string[] = [];
    next.forEach((l, i) => {
      if (i === first) {
        rebuilt.push('    type: derived');
        rebuilt.push(`    requires: [${fix.target}]`);
        rebuilt.push('    expression: >');
        rebuilt.push(`      ${fix.target}`);
        return;
      }
      if (dropLines.has(i)) return;
      rebuilt.push(l);
    });
    return rebuilt;
  }

  return lines;
}
