/**
 * The registry: every document in the workspace, resolved by name and by the
 * date it is in force.
 *
 * Effective dating is the part that cannot be retrofitted. Re-running a prior
 * regulatory submission must use the rules that applied on that as-of date,
 * not the rules on main today. Git gives transaction time — when we changed
 * our implementation. `effective.from` / `effective.to` give valid time — when
 * the regulation itself applied. They are different axes and conflating them
 * silently restates a filed report.
 */

import { parseDoc, sectionBlocks, type Graph, type Measure } from './parse';

export interface ClassificationRule {
  id: string;
  emit: string;
  label: string;
  when: string;
  citation: string;
  block: Measure;
}

export interface Classification {
  name: string;
  source: string;
  /** Column this rule set writes. */
  column: string;
  /** Closed value domain the emitted value must belong to. */
  domain: string;
  /** `error` raises a diagnostic when a record matches nothing. */
  onNoMatch: string;
  /** Column used to weight coverage — how much money each rule is deciding. */
  notional: string;
  effectiveFrom: string;
  effectiveTo: string;
  rules: ClassificationRule[];
  graph: Graph;
}

export interface ParameterSet {
  name: string;
  keys: string[];
  /** Field holding the value; every other field is a key or metadata. */
  value: string;
  effectiveFrom: string;
  effectiveTo: string;
  entries: Measure[];
  /** Keyed lookup: joined key → numeric value. */
  table: Record<string, number>;
  /** Keyed lookup: joined key → the entry that supplied it. */
  byKey: Record<string, Measure>;
  graph: Graph;
}

export interface Registry {
  /** Every effective version of each classification, in document order. */
  classifications: Record<string, Classification[]>;
  parameterSets: Record<string, ParameterSet[]>;
  graphs: Record<string, Graph>;
}

function listItems(raw: string): string[] {
  return (raw || '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

function readClassification(g: Graph): Classification {
  return {
    name: g.docName,
    source: g.view.source,
    column: (g.view['emits.column'] || g.view.column || '').trim(),
    domain: (g.view['emits.domain'] || g.view.domain || '').trim(),
    onNoMatch: (g.view['emits.on_no_match'] || g.view.on_no_match || 'error').trim(),
    notional: (g.view['emits.notional'] || g.view.notional || 'balance_usd').trim(),
    effectiveFrom: (g.view['effective.from'] || '').trim(),
    effectiveTo: (g.view['effective.to'] || '').trim(),
    rules: sectionBlocks(g, 'rules').map((b) => ({
      id: b.name,
      emit: (b.f.emit || '').trim(),
      label: (b.f.label || '').trim(),
      when: (b.f.when || '').trim(),
      citation: (b.f.citation || '').trim(),
      block: b,
    })),
    graph: g,
  };
}

function readParameterSet(g: Graph): ParameterSet {
  const keys = listItems(g.view.keys || '');
  const value = (g.view.value || '').trim();
  const entries = sectionBlocks(g, 'entries');

  const table: Record<string, number> = {};
  const byKey: Record<string, Measure> = {};
  entries.forEach((e) => {
    const k = keys.map((key) => (e.f[key] || '').trim()).join('');
    const v = parseFloat((e.f[value] || '').trim());
    if (!Number.isNaN(v)) table[k] = v;
    byKey[k] = e;
  });

  return {
    name: g.docName,
    keys,
    value,
    effectiveFrom: (g.view['effective.from'] || '').trim(),
    effectiveTo: (g.view['effective.to'] || '').trim(),
    entries,
    table,
    byKey,
    graph: g,
  };
}

export function buildRegistry(docs: Record<string, string>): Registry {
  const registry: Registry = { classifications: {}, parameterSets: {}, graphs: {} };

  Object.keys(docs).forEach((file) => {
    const g = parseDoc(docs[file]);
    registry.graphs[file] = g;

    if (g.kind === 'classification' && g.docName) {
      (registry.classifications[g.docName] ||= []).push(readClassification(g));
    }
    if (g.kind === 'parameter_set' && g.docName) {
      (registry.parameterSets[g.docName] ||= []).push(readParameterSet(g));
    }
  });

  return registry;
}

/** True when `asOf` falls inside a half-open [from, to) effective range. */
export function inForce(from: string, to: string, asOf: string): boolean {
  if (from && asOf < from) return false;
  if (to && asOf >= to) return false;
  return true;
}

export function resolveClassification(
  registry: Registry,
  name: string,
  asOf: string,
): Classification | null {
  const versions = registry.classifications[name] || [];
  return versions.find((v) => inForce(v.effectiveFrom, v.effectiveTo, asOf)) || null;
}

export function resolveParameterSet(
  registry: Registry,
  name: string,
  asOf: string,
): ParameterSet | null {
  const versions = registry.parameterSets[name] || [];
  return versions.find((v) => inForce(v.effectiveFrom, v.effectiveTo, asOf)) || null;
}

/**
 * Effective ranges that leave `asOf` uncovered, or that cover it twice. Both
 * are silent-wrong-answer bugs: a gap means no rules apply, an overlap means
 * document order decides which regulation you filed under.
 */
export function effectiveProblems(
  versions: Array<{ effectiveFrom: string; effectiveTo: string }>,
  asOf: string,
): 'gap' | 'overlap' | null {
  const covering = versions.filter((v) => inForce(v.effectiveFrom, v.effectiveTo, asOf));
  if (covering.length === 0) return 'gap';
  if (covering.length > 1) return 'overlap';
  return null;
}
