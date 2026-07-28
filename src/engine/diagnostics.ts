/**
 * The KEEL diagnostic catalogue.
 *
 * Severity is coupled to governance tier: the same missing description is
 * informational on an exploratory measure and blocking on one model risk will
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
  COLUMNS, ENUMS, ENUM_LABEL, EXTERNAL, isReferenceName, UNSUPPORTED, type Severity,
} from './vocab';

export type Fix =
  | { kind: 'rename'; from: string; to: string; line: number }
  | { kind: 'addReq'; name: string; line: number }
  | { kind: 'dropReq'; name: string; line: number }
  | { kind: 'addWindow'; line: number }
  | { kind: 'addDesc'; line: number; measure: string };

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
  KEEL001: true, KEEL002: true, KEEL003: true, KEEL004: true,
  KEEL005: true, KEEL007: true, KEEL022: true, KEEL044: true, KEEL052: true,
};

/** The line a field's text actually occupies — see `Measure.contentOf`. */
function at(m: Measure, key: string): number {
  return m.contentOf[key] !== undefined ? m.contentOf[key] : m.lineOf[key];
}

export function diagnose(g: Graph, ev: Evaluator): Diagnostic[] {
  const out: Diagnostic[] = [];
  const cols = COLUMNS[g.view.source] || [];
  const scope = Object.keys(g.byName).concat(Object.keys(EXTERNAL));

  g.measures.forEach((m) => {
    const required = reqs(m);
    const tier = parseInt(m.f.sr_11_7_tier || '0', 10);

    // --- closed-choice fields (KEEL044) ---
    (['type', 'format', 'agg', 'sr_11_7_tier', 'window.op', 'window.over'] as const).forEach((k) => {
      const v = (m.f[k] || '').trim();
      if (!v || ENUMS[k].indexOf(v) >= 0) return;
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
        message: `“${v}” is not a valid ${ENUM_LABEL[k]}. Choose one of: ${ENUMS[k].join(', ')}.`,
        line: at(m, k),
        token: v,
        fix: { kind: 'rename', from: v, to: best, line: at(m, k) },
        fixLabel: `Use ${best}`,
      });
    });

    // --- source binding (KEEL004) ---
    if (m.f.type === 'simple' && m.f.field && cols.indexOf(m.f.field) < 0) {
      out.push({
        code: 'KEEL004',
        sev: 'error',
        message: `Column ${m.f.field} not found on source ${g.view.source}`,
        line: at(m, 'field'),
        token: m.f.field,
      });
    }

    // --- filters (KEEL050 / 051 / 052) ---
    if (m.f.type === 'simple') {
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

    // --- trailing windows (KEEL025 / 026 / 027) ---
    if (m.f.type === 'windowed') {
      if (!m.f['window.op']) {
        out.push({
          code: 'KEEL025',
          sev: 'error',
          message: `${m.name} looks across dates, so it needs window.op — for example stddev or delta`,
          line: m.lineOf.name,
          fix: { kind: 'addWindow', line: m.lineOf.name },
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
    }

    // --- reference resolution (KEEL001 / 005 / 006 / 021 / 035) ---
    const used = exprNames(m).filter(isReferenceName);

    used.forEach((n) => {
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
      if (used.indexOf(n) < 0 && m.f.expression) {
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

    exprNames(m).forEach((n) => {
      if (UNSUPPORTED[n]) {
        out.push({
          code: 'KEEL021',
          sev: 'warn',
          message: `${UNSUPPORTED[n]} can’t run ${n}, so this measure won’t work there`,
          line: at(m, 'expression'),
          token: n,
        });
      }
    });

    // --- governance (KEEL030 / 031) ---
    if (tier >= 1 && !m.f.description) {
      out.push({
        code: 'KEEL030',
        sev: tier <= 2 ? 'error' : 'warn',
        message: `${m.name} is under oversight level ${tier}, so it needs a description`,
        line: m.lineOf.name,
        fix: { kind: 'addDesc', line: m.lineOf.name, measure: m.name },
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

    // --- style (KEEL041 / 042) ---
    if (!/^[a-z][a-z0-9_]*$/.test(m.name)) {
      out.push({
        code: 'KEEL041',
        sev: 'info',
        message: `${m.name} should be lowercase_with_underscores`,
        line: m.lineOf.name,
        token: m.name,
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
  });

  return out.filter((d) => d.line !== undefined && d.line >= 0);
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

  if (fix.kind === 'addReq') {
    // No `requires:` line yet — write one under the measure's `type:`.
    if (fix.line === undefined || next[fix.line] === undefined) {
      const owner = ownerAt(g, fix.line);
      if (!owner) return lines;
      const at = owner.lineOf.type !== undefined ? owner.lineOf.type : owner.line;
      next.splice(at + 1, 0, `    requires: [${fix.name}]`);
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

  if (fix.kind === 'addWindow') {
    next.splice(fix.line + 1, 0,
      '    window.op: stddev',
      '    window.over: 30d',
      '    window.order_by: as_of_date');
    return next;
  }

  if (fix.kind === 'addDesc') {
    next.splice(fix.line + 1, 0,
      `    description: TODO — describe what ${fix.measure} computes and why.`);
    return next;
  }

  return lines;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
