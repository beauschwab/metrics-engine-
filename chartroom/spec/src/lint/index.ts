/**
 * The linter — every rule, one pass, findings in severity order.
 *
 * A pure function over (spec, context); see context.ts for why. Rule order in
 * the report is BLOCK → WARN → SUGGEST and, within a severity, spec order —
 * the reader fixes from the top.
 */

import type { DashboardSpec } from '../schema';
import type { LintContext, LintFinding, LintReport, Rule } from './context';
import { REF_01 } from './rules/ref01';
import { TS_01 } from './rules/ts01';
import { TS_02 } from './rules/ts02';
import { BAR_02 } from './rules/bar02';
import { PIE_01 } from './rules/pie01';
import { COL_03 } from './rules/col03';
import { NUM_01 } from './rules/num01';
import { KPI_02 } from './rules/kpi02';
import { DEN_01 } from './rules/den01';
import { GRID_01 } from './rules/grid01';
import { LAY_01 } from './rules/lay01';
import { GOV_01, GOV_02 } from './rules/gov';
import { CTX_01 } from './rules/ctx01';
import { AGG_01 } from './rules/agg01';
import { IX_01 } from './rules/ix01';
import { AREA_01 } from './rules/area01';
import { GAUGE_01 } from './rules/gauge01';
import { SM_01 } from './rules/sm01';
import { WF_01 } from './rules/wf01';

export const RULES: Rule[] = [
  REF_01, TS_01, TS_02, BAR_02, PIE_01, COL_03, NUM_01,
  KPI_02, DEN_01, GRID_01, LAY_01, GOV_01, GOV_02, CTX_01,
  AGG_01, IX_01, AREA_01, GAUGE_01, SM_01, WF_01,
];

/** Every id the linter can emit — the roster guide text is checked against. */
export const RULE_IDS = [
  'REF-01', 'TS-01', 'TS-02', 'BAR-02', 'PIE-01', 'COL-03', 'NUM-01',
  'KPI-02', 'DEN-01', 'GRID-01', 'LAY-01', 'GOV-01', 'GOV-02', 'CTX-01',
  'AGG-01', 'IX-01', 'AREA-01', 'GAUGE-01', 'SM-01', 'WF-01',
] as const;

const ORDER: Record<string, number> = { BLOCK: 0, WARN: 1, SUGGEST: 2 };

export function lint(spec: DashboardSpec, ctx: LintContext): LintReport {
  const findings: LintFinding[] = [];
  for (const rule of RULES) findings.push(...rule(spec, ctx));
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return {
    findings,
    counts: {
      block: findings.filter((f) => f.severity === 'BLOCK').length,
      warn: findings.filter((f) => f.severity === 'WARN').length,
      suggest: findings.filter((f) => f.severity === 'SUGGEST').length,
    },
  };
}
