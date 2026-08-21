/**
 * Row-level derivations — Tier E.
 *
 * This is the stage the metric graph was missing: given the source rows for
 * one as-of date, compute derived columns in declared order before anything
 * aggregates. Classification lives here, and so do bucketing, parameter lookup
 * and row arithmetic.
 *
 * Every operator is stateless and row-wise, which is why this is the *safest*
 * tier in the algebra rather than an extension of its riskiest part: a `case`
 * chain compiles to `ibis.cases`, a Polars `when/then`, a Spark `F.when`, and
 * a Deephaven `update()` formula without any of them needing incremental state.
 *
 * Coverage is computed alongside the values, because for a classification the
 * question "is this right?" is answered by *which rule fired and how much
 * money it moved*, not by a single number.
 */

import { compilePredicate, type CompiledPredicate } from './predicate';
import { evalExpression } from './expression';
import { sectionBlocks, type Graph, type Measure } from './parse';
import type { Row } from './fixtures';
import { MATURITY_LADDERS, OPEN_BUCKET } from './vocab';
import {
  resolveClassification, resolveParameterSet, resolvePreparedSource,
  type Classification, type Registry,
} from './registry';

export interface DerivationSpec {
  name: string;
  op: string;
  field: string;
  anchor: string;
  ladder: string;
  using: string;
  keys: string[];
  expression: string;
  block: Measure;
}

export interface RuleStat {
  id: string;
  emit: string;
  records: number;
  notional: number;
}

export interface ValueStat {
  value: string;
  records: number;
  notional: number;
}

export interface Coverage {
  column: string;
  classification: string;
  total: number;
  totalNotional: number;
  matched: number;
  matchedNotional: number;
  unmatched: number;
  unmatchedNotional: number;
  rules: RuleStat[];
  values: ValueStat[];
  /** Rule id → later rule ids that would also have matched the rows it won. */
  overlaps: Record<string, string[]>;
  /** Rule id → earlier rules that took rows this one would have matched. */
  preemptedBy: Record<string, Array<{ by: string; records: number }>>;
  /** Rules whose condition could not be read, with the reason. */
  unreadable: Array<{ id: string; err: string }>;
  /** Emitted values that are not in the declared domain. */
  offDomain: string[];
  /** Per-record rule attribution, index-aligned with the returned rows. */
  attribution: string[];
}

export interface ParamMiss {
  parameterSet: string;
  key: string;
  records: number;
}

export interface RowResult {
  rows: Row[];
  coverage: Record<string, Coverage>;
  paramMisses: ParamMiss[];
  /** Derivations naming an operator the engine does not know. */
  unknownOps: DerivationSpec[];
  /** Named artifacts a derivation referenced that are not in force at as-of. */
  unresolved: Array<{ spec: DerivationSpec; reason: 'missing' | 'not_in_force' }>;
}

function listItems(raw: string): string[] {
  return (raw || '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Key separator for composite map keys.
 *
 * A literal control character here would make the file read as binary to grep,
 * diff and every review tool — which happened, and cost a search. `\u001f` is
 * the ASCII unit separator: the same guarantee of never appearing in a
 * parameter-set name or a column value, spelled so the file stays text.
 */
const KEY_SEP = '\u001f';

/**
 * The derivations written *in this document*.
 *
 * For a view that names a `prepared:` source this is only half the row stage;
 * `derivationsFor` is what a compiler or an evaluator wants.
 */
export function derivationsOf(g: Graph): DerivationSpec[] {
  return sectionBlocks(g, 'derivations').map((b) => ({
    name: b.name,
    op: (b.f.op || '').trim(),
    field: (b.f.field || '').trim(),
    anchor: (b.f.anchor || '').trim(),
    ladder: (b.f.ladder || '').trim(),
    using: (b.f.using || '').trim(),
    keys: listItems(b.f.keys || ''),
    expression: (b.f.expression || '').trim(),
    block: b,
  }));
}

/**
 * The whole row stage a document computes: its prepared source's derivations
 * first, then its own.
 *
 * Order is the contract. A prepared source exists to be depended on, so its
 * columns must be in scope before the first line a consumer writes — the same
 * order the author reads the two files in. A view's own derivation may then
 * build on a prepared one (`weighted_amount` on `outflow_rate`); the reverse
 * cannot happen, which is what keeps the shared stage independent of whoever
 * consumes it.
 *
 * A `prepared:` that names nothing in force contributes nothing rather than
 * throwing. The diagnostics layer says so precisely, with a line number; an
 * exception here would take the editor down on a half-typed name.
 */
export function derivationsFor(
  g: Graph,
  registry: Registry,
  asOf: string,
): DerivationSpec[] {
  const name = (g.view.prepared || '').trim();
  if (!name) return derivationsOf(g);
  const prepared = resolvePreparedSource(registry, name, asOf);
  if (!prepared) return derivationsOf(g);
  return derivationsOf(prepared.graph).concat(derivationsOf(g));
}

const DAY_MS = 86400000;

/**
 * Whole days from the anchor date to the target date.
 *
 * A position with no stated maturity is demandable now, so it resolves to
 * zero days rather than to a null that would silently drop out of a
 * `days_to_maturity <= 30` filter.
 */
export function daysBetween(from: string, to: string): number {
  if (!to) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / DAY_MS);
}

export function bucketFor(ladderName: string, days: number, hasDate: boolean): string {
  if (!hasDate) return OPEN_BUCKET;
  const ladder = MATURITY_LADDERS[ladderName];
  if (!ladder) return '';
  const hit = ladder.find((b) => days <= b.maxDays);
  return hit ? hit.name : ladder[ladder.length - 1].name;
}

interface CompiledRule {
  id: string;
  emit: string;
  pred: CompiledPredicate;
}

function compileRules(c: Classification): CompiledRule[] {
  return c.rules.map((r) => ({ id: r.id, emit: r.emit, pred: compilePredicate(r.when) }));
}

/**
 * Run an ordered rule set over rows, writing `column` and collecting coverage.
 *
 * Mutates the rows it is given — the caller owns copies. Coverage is gathered
 * in the same pass because a second pass over a million positions to count
 * what the first pass already knew is pure waste.
 */
export function runClassification(
  c: Classification,
  rows: Row[],
  domains: Record<string, string[]>,
  column = c.column,
): Coverage {
  const compiled = compileRules(c);
  const allowed = domains[c.domain];

  const stat: Coverage = {
    column,
    classification: c.name,
    total: rows.length,
    totalNotional: 0,
    matched: 0,
    matchedNotional: 0,
    unmatched: 0,
    unmatchedNotional: 0,
    rules: compiled.map((r) => ({ id: r.id, emit: r.emit, records: 0, notional: 0 })),
    values: [],
    overlaps: {},
    preemptedBy: {},
    offDomain: [],
    unreadable: compiled.filter((r) => r.pred.err).map((r) => ({ id: r.id, err: r.pred.err! })),
    attribution: [],
  };

  const byId: Record<string, RuleStat> = {};
  stat.rules.forEach((r) => {
    byId[r.id] = r;
  });
  const byValue: Record<string, ValueStat> = {};
  const overlapSets: Record<string, Record<string, number>> = {};
  const preempted: Record<string, Record<string, number>> = {};

  rows.forEach((row) => {
    const notional = Number(row[c.notional]) || 0;
    stat.totalNotional += notional;

    let winner: CompiledRule | null = null;
    for (const rule of compiled) {
      if (rule.pred.err) continue;
      if (!rule.pred.fn(row)) continue;
      if (!winner) {
        winner = rule;
        continue;
      }
      // This rule also matched, but a earlier one already claimed the row.
      // Precedence is doing real work — record it in both directions.
      (overlapSets[winner.id] ||= {})[rule.id] = (overlapSets[winner.id]?.[rule.id] || 0) + 1;
      (preempted[rule.id] ||= {})[winner.id] = (preempted[rule.id]?.[winner.id] || 0) + 1;
    }

    if (winner) {
      stat.matched++;
      stat.matchedNotional += notional;
      byId[winner.id].records++;
      byId[winner.id].notional += notional;
      row[column] = winner.emit;
      stat.attribution.push(winner.id);
      const v = (byValue[winner.emit] ||= { value: winner.emit, records: 0, notional: 0 });
      v.records++;
      v.notional += notional;
    } else {
      stat.unmatched++;
      stat.unmatchedNotional += notional;
      row[column] = '';
      stat.attribution.push('');
    }
  });

  stat.values = Object.values(byValue).sort((a, b) => b.notional - a.notional);
  Object.keys(overlapSets).forEach((id) => {
    stat.overlaps[id] = Object.keys(overlapSets[id]);
  });
  Object.keys(preempted).forEach((id) => {
    stat.preemptedBy[id] = Object.keys(preempted[id]).map((by) => ({
      by,
      records: preempted[id][by],
    }));
  });
  if (allowed) {
    stat.offDomain = compiled
      .map((r) => r.emit)
      .filter((v, i, a) => v && a.indexOf(v) === i && allowed.indexOf(v) < 0);
  }

  return stat;
}

/**
 * Apply every derivation to every row for one as-of date.
 *
 * Rules are evaluated in document order and the first match wins, which is why
 * the coverage pass also records *which other rules would have matched* — when
 * order is what decides the answer, the author needs to be told so.
 */
export function deriveRows(
  g: Graph,
  registry: Registry,
  sourceRows: Row[],
  asOf: string,
  domains: Record<string, string[]>,
): RowResult {
  const specs = derivationsFor(g, registry, asOf);
  const rows: Row[] = sourceRows.map((r) => ({ ...r }));
  const coverage: Record<string, Coverage> = {};
  const paramMissCounts: Record<string, number> = {};
  const unknownOps: DerivationSpec[] = [];
  const unresolved: RowResult['unresolved'] = [];

  specs.forEach((spec) => {
    switch (spec.op) {
      case 'days_between': {
        rows.forEach((row) => {
          row[spec.name] = daysBetween(
            String(row[spec.anchor] ?? asOf),
            String(row[spec.field] ?? ''),
          );
        });
        break;
      }

      case 'date_bucket': {
        rows.forEach((row) => {
          const target = String(row[spec.field] ?? '');
          const days = daysBetween(String(row[spec.anchor] ?? asOf), target);
          row[spec.name] = bucketFor(spec.ladder, days, !!target);
        });
        break;
      }

      case 'classify': {
        const c = resolveClassification(registry, spec.using, asOf);
        if (!c) {
          const known = !!registry.classifications[spec.using];
          unresolved.push({ spec, reason: known ? 'not_in_force' : 'missing' });
          rows.forEach((row) => {
            row[spec.name] = '';
          });
          break;
        }
        coverage[spec.name] = runClassification(c, rows, domains, spec.name);
        break;
      }

      case 'param_lookup': {
        const ps = resolveParameterSet(registry, spec.using, asOf);
        if (!ps) {
          const known = !!registry.parameterSets[spec.using];
          unresolved.push({ spec, reason: known ? 'not_in_force' : 'missing' });
          rows.forEach((row) => {
            row[spec.name] = NaN;
          });
          break;
        }
        const keys = spec.keys.length ? spec.keys : ps.keys;
        rows.forEach((row) => {
          const k = keys.map((key) => String(row[key] ?? '')).join('');
          const v = ps.table[k];
          if (v === undefined) {
            row[spec.name] = NaN;
            // A missing rate is not a zero. Zero would quietly report no
            // outflow for a product that has one.
            paramMissCounts[`${ps.name}${KEY_SEP}${k}`] = (paramMissCounts[`${ps.name}${KEY_SEP}${k}`] || 0) + 1;
          } else {
            row[spec.name] = v;
          }
        });
        break;
      }

      case 'expr': {
        rows.forEach((row) => {
          row[spec.name] = evalExpression(spec.expression, (n) => {
            const v = row[n];
            return typeof v === 'number' ? v : NaN;
          }).value;
        });
        break;
      }

      default:
        unknownOps.push(spec);
        rows.forEach((row) => {
          row[spec.name] = NaN;
        });
    }
  });

  const paramMisses: ParamMiss[] = Object.keys(paramMissCounts).map((k) => {
    const [parameterSet, key] = k.split(KEY_SEP);
    return { parameterSet, key, records: paramMissCounts[k] };
  });

  return { rows, coverage, paramMisses, unknownOps, unresolved };
}

/**
 * How much money moves between classification outcomes.
 *
 * This is the blast radius for a rule change: not "which measures moved" but
 * "which records changed product ID, and how much notional went with them".
 */
export interface Migration {
  from: string;
  to: string;
  records: number;
  notional: number;
}

export function classificationMigration(
  before: Coverage | undefined,
  after: Coverage | undefined,
  beforeRows: Row[],
  afterRows: Row[],
  notionalField: string,
): Migration[] {
  if (!before || !after) return [];
  const n = Math.min(beforeRows.length, afterRows.length);
  const moves: Record<string, Migration> = {};

  for (let i = 0; i < n; i++) {
    const a = String(beforeRows[i][before.column] ?? '');
    const b = String(afterRows[i][after.column] ?? '');
    if (a === b) continue;
    const key = `${a}${KEY_SEP}${b}`;
    const m = (moves[key] ||= {
      from: a || '(unmapped)',
      to: b || '(unmapped)',
      records: 0,
      notional: 0,
    });
    m.records++;
    m.notional += Number(afterRows[i][notionalField]) || 0;
  }

  return Object.values(moves).sort((x, y) => y.notional - x.notional);
}
