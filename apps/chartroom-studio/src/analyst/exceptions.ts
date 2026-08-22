/**
 * The exception strip's contents — derived, never authored.
 *
 * The v2 analyst surface opens on "what is wrong this morning", which the
 * platform already knows twice over: the server's lint report says what breaks
 * the rules, and the upgrade notices say which pins have fallen behind the
 * registry. This module is the join, not a new opinion — inventing a severity
 * here would put a number on screen that no gate agrees with.
 *
 * SUGGEST findings are deliberately absent. The strip is what an analyst must
 * answer for before trusting the board; a suggestion is not that, and mixing
 * the two is how a breach ends up eighth in a list nobody reads.
 */

import type { LintFinding, LintReport } from 'chartroom-spec';
import type { MonitorException } from '../data';

/** Mirrors the API's `UpgradeNotice`, narrowed to what the strip reads. */
export interface UpgradeNotice {
  doc: string;
  pinned: number;
  latest: number;
  widgets: string[];
  weakens: boolean;
  historyUnavailable?: boolean;
}

export type ExceptionKind = 'BREACH' | 'WARNING' | 'GOVERNANCE' | 'PIN';
export type Tone = 'danger' | 'warning' | 'info';

export interface Exception {
  id: string;
  kind: ExceptionKind;
  tone: Tone;
  /** The rule that fired, or the pinned document — always traceable. */
  code: string;
  message: string;
  scope: string;
  action: string;
  widget?: string;
}

/**
 * Severity decides the colour, the rule family decides the label. A governance
 * rule that blocks is still a blocker — it just says so in governance's words,
 * which is the vocabulary the steward queue and the promotion gate use.
 */
function kindOf(f: LintFinding): ExceptionKind {
  if (f.rule.startsWith('GOV')) return 'GOVERNANCE';
  return f.severity === 'BLOCK' ? 'BREACH' : 'WARNING';
}

const DEFAULT_ACTION: Record<ExceptionKind, string> = {
  BREACH: 'Blocks promotion until resolved',
  WARNING: 'Review before the board is shared',
  GOVERNANCE: 'Steward decision pending in the proposals queue',
  PIN: 'Re-pin as an explicit edit',
};

export function exceptionsOf(
  report: LintReport | null,
  upgrades: UpgradeNotice[],
  acked: ReadonlySet<string>,
  breaches: MonitorException[] = [],
): Exception[] {
  const out: Exception[] = [];

  // Value-level rows first: what actually moved overnight outranks what is
  // wrong with the spec. The thresholds are the registry's variance monitors
  // (ADR-55) — effective-dated, cited, severity-carrying — so the code shown
  // is a threshold id a steward can open, not a label invented for the strip.
  for (const b of breaches) {
    out.push({
      id: `monitor:${b.monitor}:${b.threshold}:${b.key}:${b.date}`,
      kind: b.severity === 'error' ? 'BREACH' : 'WARNING',
      tone: b.severity === 'error' ? 'danger' : b.severity === 'warn' ? 'warning' : 'info',
      code: b.threshold,
      message: b.message,
      scope: b.key,
      action: `Raised by ${b.monitor} — the threshold lives in the registry`,
    });
  }

  for (const f of report?.findings ?? []) {
    if (f.severity === 'SUGGEST') continue;
    const kind = kindOf(f);
    out.push({
      id: `lint:${f.rule}:${f.path}`,
      kind,
      tone: f.severity === 'BLOCK' ? 'danger' : 'warning',
      code: f.rule,
      message: f.message,
      scope: f.widget ?? 'this board',
      // The fix label when the finding carries a mechanical fix: the strip
      // then says the same thing the findings tab's button does, rather than
      // a generic sentence that sends the reader looking for the real one.
      action: f.fixLabel ?? DEFAULT_ACTION[kind],
      widget: f.widget,
    });
  }

  for (const u of upgrades) {
    if (u.historyUnavailable || u.latest <= u.pinned) continue;
    out.push({
      id: `pin:${u.doc}`,
      kind: 'PIN',
      tone: u.weakens ? 'warning' : 'info',
      code: `PIN-${u.doc}`,
      message: `${u.doc} is pinned @${u.pinned}; the registry serves @${u.latest}`
        + (u.weakens ? ' — the newer revision weakens a guarantee' : ''),
      scope: u.widgets.length === 1 ? u.widgets[0] : `${u.widgets.length} widgets`,
      action: DEFAULT_ACTION.PIN,
    });
  }

  // Worst first. Two exceptions of one tone keep the order they were derived
  // in, which is the lint report's order — stable across renders.
  const rank: Record<Tone, number> = { danger: 0, warning: 1, info: 2 };
  return out
    .filter((x) => !acked.has(x.id))
    .sort((a, b) => rank[a.tone] - rank[b.tone]);
}
