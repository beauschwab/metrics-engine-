/**
 * Diagnostics for classification rule sets, parameter sets, and the row-level
 * derivations that bind them into a metrics view — the KEEL06x/07x families.
 *
 * These answer a different question from the measure diagnostics. A measure is
 * wrong when it computes the wrong number; a rule set is wrong when it sends a
 * record to the wrong bucket, which no single number reveals. So the checks
 * here are about *coverage and precedence*: does every record land somewhere,
 * does every rule earn its place, and does anything depend on order in a way
 * the author has not been told about.
 *
 * Subsumption is evaluated empirically against the test data rather than
 * proved. That is a deliberate limit: it catches the rule that is dead on real
 * data, and it says so in those terms rather than claiming a proof it does not
 * have.
 */

import type { Evaluator } from './evaluate';
import type { Diagnostic } from './diagnostics';
import { fmt } from './format';
import { sectionBlocks, type Graph } from './parse';
import { derivationsOf, type Coverage } from './rows';
import {
  buildRegistry, effectiveProblems, resolveClassification, resolveParameterSet,
  type Registry,
} from './registry';
import { AS_OF } from './fixtures';
import { missingGrouping, missingMeasures, readReport } from './compile';
import { grainRisky } from './report';
import { COLUMNS, DERIVATION_OPS, DOMAINS, MATURITY_LADDERS } from './vocab';

/** Codes here that mean the definition cannot produce a trustworthy number. */
export const CLASSIFICATION_BLOCKING: Record<string, true> = {
  KEEL060: true, KEEL064: true, KEEL065: true, KEEL066: true,
  KEEL068: true, KEEL069: true, KEEL070: true, KEEL071: true, KEEL076: true,
  KEEL080: true, KEEL081: true, KEEL082: true, KEEL083: true,
};

const EMPTY_REGISTRY = buildRegistry({});

export function diagnoseClassification(
  g: Graph,
  ev: Evaluator,
  registry: Registry,
  baseline?: Graph,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const rules = sectionBlocks(g, 'rules');
  const tier = parseInt(g.view['governance.sr_11_7_tier'] || g.view.sr_11_7_tier || '0', 10);
  const domain = (g.view['emits.domain'] || '').trim();
  const allowed = DOMAINS[domain];

  // --- effective dating (KEEL066 / KEEL067) -------------------------------
  const versions = registry.classifications[g.docName] || [];
  const problem = effectiveProblems(versions, AS_OF);
  const headerLine = Math.max(0, g.info.findIndex((i) => i.key === 'from'));

  if (problem === 'gap') {
    out.push({
      code: 'KEEL066',
      sev: 'error',
      message: `No version of ${g.docName} is in force on ${AS_OF}, so nothing would be classified`,
      line: headerLine,
    });
  }
  if (problem === 'overlap') {
    out.push({
      code: 'KEEL067',
      sev: 'warn',
      message:
        `More than one version of ${g.docName} covers ${AS_OF} — document order decides ` +
        'which regulation you file under',
      line: headerLine,
    });
  }

  if (domain && !allowed) {
    out.push({
      code: 'KEEL064',
      sev: 'error',
      message: `There is no value domain called ${domain}`,
      line: Math.max(0, g.info.findIndex((i) => i.key === 'domain')),
      token: domain,
    });
  }

  // --- per-rule structure (KEEL064 / 068 / 073 / 074) ---------------------
  const seen: Record<string, number> = {};
  rules.forEach((r) => {
    const emit = (r.f.emit || '').trim();

    if (seen[r.name] !== undefined) {
      out.push({
        code: 'KEEL068',
        sev: 'error',
        message: `Rule id ${r.name} is used twice — ids must be unique so evidence can cite one rule`,
        line: r.line,
        token: r.name,
      });
    }
    seen[r.name] = r.line;

    if (!emit) {
      out.push({
        code: 'KEEL073',
        sev: 'error',
        message: `${r.name} does not say what to emit`,
        line: r.line,
      });
    } else if (allowed && allowed.indexOf(emit) < 0) {
      let best = '';
      let bd = 99;
      allowed.forEach((a) => {
        const d = Math.abs(a.length - emit.length) + (a.startsWith(emit.slice(0, 3)) ? 0 : 5);
        if (d < bd) {
          bd = d;
          best = a;
        }
      });
      out.push({
        code: 'KEEL064',
        sev: 'error',
        message: `${emit} is not a value in ${domain}. Did you mean ${best}?`,
        line: r.lineOf.emit !== undefined ? r.lineOf.emit : r.line,
        token: emit,
        fix: { kind: 'rename', from: emit, to: best, line: r.lineOf.emit ?? r.line },
        fixLabel: `Use ${best}`,
      });
    }

    if (!(r.f.when || '').trim()) {
      out.push({
        code: 'KEEL073',
        sev: 'error',
        message: `${r.name} has no condition, so it would claim every record`,
        line: r.line,
      });
    }

    if (tier >= 1 && tier <= 2 && !(r.f.citation || '').trim()) {
      out.push({
        code: 'KEEL074',
        sev: 'warn',
        message: `${r.name} has no citation — a tier ${tier} rule set must say which paragraph each rule implements`,
        line: r.line,
      });
    }
  });

  // --- coverage against the test data (KEEL060 / 061 / 062 / 069) ---------
  const coverage = ev.selfCoverage();
  if (coverage) out.push(...coverageDiagnostics(coverage, g, rules));

  // --- a rate changed without saying why (KEEL072) ------------------------
  if (baseline) {
    const before = sectionBlocks(baseline, 'rules');
    rules.forEach((r) => {
      const was = before.find((b) => b.name === r.name);
      if (!was) return;
      const conditionChanged = (was.f.when || '') !== (r.f.when || '');
      const citationSame = (was.f.citation || '') === (r.f.citation || '');
      if (conditionChanged && citationSame && (r.f.citation || '').trim()) {
        out.push({
          code: 'KEEL072',
          sev: 'warn',
          message:
            `${r.name} now matches different records but still cites ${r.f.citation.trim()} — ` +
            'confirm the citation still covers it',
          line: r.lineOf.when !== undefined ? r.lineOf.when : r.line,
        });
      }
    });
  }

  return out.filter((d) => d.line >= 0);
}

function coverageDiagnostics(
  coverage: Coverage,
  g: Graph,
  rules: ReturnType<typeof sectionBlocks>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lineOfRule: Record<string, number> = {};
  rules.forEach((r) => {
    lineOfRule[r.name] = r.line;
  });
  const onNoMatch = (g.view['emits.on_no_match'] || 'error').trim();

  if (coverage.unmatched > 0) {
    out.push({
      code: 'KEEL060',
      sev: onNoMatch === 'error' ? 'error' : 'warn',
      message:
        `${coverage.unmatched.toLocaleString('en-US')} of ` +
        `${coverage.total.toLocaleString('en-US')} records match no rule ` +
        `(${fmt(coverage.unmatchedNotional, 'currency_usd')}). They would be filed under no product ID.`,
      line: Math.max(0, g.info.findIndex((i) => i.key === 'rules')),
    });
  }

  coverage.unreadable.forEach((u) => {
    out.push({
      code: 'KEEL069',
      sev: 'error',
      message: `${u.id}: this condition can’t be read — ${u.err}`,
      line: lineOfRule[u.id] ?? 0,
    });
  });

  coverage.rules.forEach((r) => {
    if (r.records > 0) return;
    if (coverage.unreadable.some((u) => u.id === r.id)) return;

    const preempted = coverage.preemptedBy[r.id];
    if (preempted && preempted.length) {
      const by = preempted.map((p) => p.by).join(', ');
      out.push({
        code: 'KEEL062',
        sev: 'warn',
        message:
          `${r.id} never wins — ${by} already claims every record it matches. ` +
          'Move it earlier or narrow the rule above it.',
        line: lineOfRule[r.id] ?? 0,
      });
    } else {
      out.push({
        code: 'KEEL061',
        sev: 'info',
        message: `${r.id} matched no records in this test data — it may be dead, or the data may not cover it`,
        line: lineOfRule[r.id] ?? 0,
      });
    }
  });

  return out;
}

export function diagnoseParameterSet(
  g: Graph,
  registry: Registry,
  baseline?: Graph,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const entries = sectionBlocks(g, 'entries');
  const keys = (g.view.keys || '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  const valueField = (g.view.value || '').trim();

  const problem = effectiveProblems(registry.parameterSets[g.docName] || [], AS_OF);
  if (problem === 'gap') {
    out.push({
      code: 'KEEL066',
      sev: 'error',
      message: `No version of ${g.docName} is in force on ${AS_OF}, so every lookup would be empty`,
      line: Math.max(0, g.info.findIndex((i) => i.key === 'from')),
    });
  }
  if (problem === 'overlap') {
    out.push({
      code: 'KEEL067',
      sev: 'warn',
      message: `More than one version of ${g.docName} covers ${AS_OF}`,
      line: Math.max(0, g.info.findIndex((i) => i.key === 'from')),
    });
  }

  const seen: Record<string, true> = {};
  entries.forEach((e) => {
    const key = keys.map((k) => (e.f[k] || '').trim()).join(' · ');
    if (seen[key]) {
      out.push({
        code: 'KEEL075',
        sev: 'error',
        message: `${key} appears twice — the later entry would silently win`,
        line: e.line,
      });
    }
    seen[key] = true;

    const raw = (e.f[valueField] || '').trim();
    if (!raw || Number.isNaN(parseFloat(raw))) {
      out.push({
        code: 'KEEL076',
        sev: 'error',
        message: `${key} has no readable ${valueField || 'value'}`,
        line: e.line,
      });
    }

    if (baseline) {
      const was = sectionBlocks(baseline, 'entries').find(
        (b) => keys.map((k) => (b.f[k] || '').trim()).join(' · ') === key,
      );
      if (was && (was.f[valueField] || '') !== raw && (was.f.citation || '') === (e.f.citation || '')) {
        out.push({
          code: 'KEEL072',
          sev: 'warn',
          message:
            `${key} changed from ${was.f[valueField]} to ${raw} but still cites the same ` +
            'paragraph — a rate change usually means a new citation or a change ticket',
          line: e.lineOf[valueField] ?? e.line,
        });
      }
    }
  });

  return out.filter((d) => d.line >= 0);
}

/**
 * Derivations inside a metrics view: do they name real operators, real
 * artifacts, and artifacts that are actually in force?
 */
export function diagnoseDerivations(
  g: Graph,
  ev: Evaluator,
  registry: Registry = EMPTY_REGISTRY,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const specs = derivationsOf(g);
  const sourceCols = COLUMNS[g.view.source] || [];

  specs.forEach((spec) => {
    if (!DERIVATION_OPS[spec.op]) {
      out.push({
        code: 'KEEL070',
        sev: 'error',
        message:
          `${spec.op || '(nothing)'} is not a row-level operator. Choose one of: ` +
          `${Object.keys(DERIVATION_OPS).join(', ')}.`,
        line: spec.block.lineOf.op ?? spec.block.line,
        token: spec.op,
      });
      return;
    }

    if (sourceCols.indexOf(spec.name) >= 0) {
      out.push({
        code: 'KEEL077',
        sev: 'warn',
        message: `${spec.name} is already a column on ${g.view.source} — this derivation hides it`,
        line: spec.block.line,
        token: spec.name,
      });
    }

    if (spec.op === 'date_bucket' && !MATURITY_LADDERS[spec.ladder]) {
      out.push({
        code: 'KEEL071',
        sev: 'error',
        message: `There is no ladder called ${spec.ladder || '(none)'}`,
        line: spec.block.lineOf.ladder ?? spec.block.line,
        token: spec.ladder,
      });
    }

    if (spec.op === 'classify') {
      if (!registry.classifications[spec.using]) {
        out.push({
          code: 'KEEL071',
          sev: 'error',
          message: `There is no classification called ${spec.using || '(none)'}`,
          line: spec.block.lineOf.using ?? spec.block.line,
          token: spec.using,
        });
      } else if (!resolveClassification(registry, spec.using, AS_OF)) {
        out.push({
          code: 'KEEL066',
          sev: 'error',
          message: `${spec.using} exists but no version of it is in force on ${AS_OF}`,
          line: spec.block.lineOf.using ?? spec.block.line,
        });
      }
    }

    if (spec.op === 'param_lookup') {
      if (!registry.parameterSets[spec.using]) {
        out.push({
          code: 'KEEL071',
          sev: 'error',
          message: `There is no parameter set called ${spec.using || '(none)'}`,
          line: spec.block.lineOf.using ?? spec.block.line,
          token: spec.using,
        });
      } else if (!resolveParameterSet(registry, spec.using, AS_OF)) {
        out.push({
          code: 'KEEL066',
          sev: 'error',
          message: `${spec.using} exists but no version of it is in force on ${AS_OF}`,
          line: spec.block.lineOf.using ?? spec.block.line,
        });
      }
    }
  });

  // --- coverage and lookups, measured on the test data --------------------
  const coverage = ev.coverage();
  Object.keys(coverage).forEach((column) => {
    const c = coverage[column];
    if (c.unmatched === 0) return;
    const spec = specs.find((x) => x.name === column);
    out.push({
      code: 'KEEL060',
      sev: 'error',
      message:
        `${c.unmatched.toLocaleString('en-US')} records are not classified by ${c.classification} ` +
        `(${fmt(c.unmatchedNotional, 'currency_usd')}), so they carry no ${column}`,
      line: spec ? spec.block.line : 0,
    });
  });

  const problems = ev.rowProblems();
  problems.paramMisses.forEach((miss) => {
    const spec = specs.find((x) => x.op === 'param_lookup' && x.using === miss.parameterSet);
    out.push({
      code: 'KEEL065',
      sev: 'error',
      message:
        `${miss.parameterSet} has no value for ${miss.key || '(blank)'}, which ` +
        `${miss.records.toLocaleString('en-US')} records need. A missing rate is not a zero.`,
      line: spec ? spec.block.line : 0,
      token: miss.key,
    });
  });

  return out.filter((d) => d.line >= 0);
}

/**
 * A report is a grain declaration plus a destination. The checks are about
 * whether it can actually be produced and written, and whether grouping it
 * changes what its measures mean.
 */
export function diagnoseReport(g: Graph, registry: Registry): Diagnostic[] {
  const out: Diagnostic[] = [];
  const report = readReport(g);
  const viewGraph = Object.values(registry.graphs).find(
    (x) => x.kind === 'metrics_view' && (x.view.view || '').trim() === report.view,
  ) || null;

  const lineOf = (key: string) => Math.max(0, g.info.findIndex((i) => i.key === key));

  if (!report.view || !viewGraph) {
    out.push({
      code: 'KEEL080',
      sev: 'error',
      message: `There is no metrics view called ${report.view || '(none)'}`,
      line: lineOf('view'),
      token: report.view,
    });
    return out;
  }

  if (!report.grouping.length) {
    out.push({
      code: 'KEEL081',
      sev: 'error',
      message: 'A report needs a grouping — without one there is no grain to file at',
      line: lineOf('grouping'),
    });
  }

  const sourceCols = COLUMNS[viewGraph.view.source] || [];
  missingGrouping(report, viewGraph, sourceCols).forEach((c) => {
    out.push({
      code: 'KEEL082',
      sev: 'error',
      message: `${c} is neither a column on ${viewGraph.view.source} nor something a derivation makes`,
      line: lineOf('grouping'),
      token: c,
    });
  });

  missingMeasures(report, viewGraph).forEach((m) => {
    out.push({
      code: 'KEEL083',
      sev: 'error',
      message: `${report.view} does not define a measure called ${m}`,
      line: lineOf('measures'),
      token: m,
    });
  });

  // Grouping a measure that carries a portfolio-level cap changes what it
  // means. The 75% inflow cap is not 75% per product ID.
  grainRisky(report, viewGraph).forEach((m) => {
    out.push({
      code: 'KEEL084',
      sev: 'warn',
      message:
        `${m} caps or floors against a total. Evaluated per group it means something ` +
        'different from the portfolio figure — confirm that is what you intend to file.',
      line: lineOf('measures'),
      token: m,
    });
  });

  if (!report.table) {
    out.push({
      code: 'KEEL085',
      sev: 'warn',
      message: 'No materialize target — this report can be read but never written',
      line: lineOf('materialize'),
    });
  } else if (!report.partitionBy.length) {
    out.push({
      code: 'KEEL086',
      sev: 'warn',
      message:
        `${report.table} has no partition column, so a rerun would rewrite every date ` +
        'rather than the one being restated',
      line: lineOf('table'),
      fix: { kind: 'insertAfter', line: lineOf('table'), lines: ['  partition_by: [as_of_date]'] },
      fixLabel: 'Partition by as_of_date',
    });
  }

  return out.filter((d) => d.line >= 0);
}
