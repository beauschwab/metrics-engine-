/**
 * The analyst bar — the controls that decide *which* numbers the board shows,
 * as opposed to which numbers it binds.
 *
 * These sit in the header rather than the inspector on purpose: as-of and
 * basis apply to every widget at once, and a per-widget control would let a
 * board show twelve tiles standing on different days. That is the failure the
 * fixed pane idiom (ADR-10) exists to prevent, so the control that could cause
 * it lives where it visibly applies to everything under it.
 */

import type { Basis } from '../bindings';
import type { Calendar } from '../data';

const BASIS_LABEL: Record<Basis, string> = {
  prior_day: 'vs prior day',
  prior_week: 'vs prior week',
  month_end: 'vs month-end',
};

/** `2026-06-30 · month-end`, when the next date starts a new month. */
function labelFor(dates: string[], i: number, latest: string): string {
  const d = dates[i];
  if (d === latest) return `${d} · latest close`;
  const next = dates[i + 1];
  if (next && next.slice(0, 7) !== d.slice(0, 7)) return `${d} · month-end`;
  return d;
}

function daysBehind(dates: string[], asOf: string): number {
  const i = dates.indexOf(asOf);
  return i === -1 ? 0 : dates.length - 1 - i;
}

export interface AnalystBarProps {
  calendar: Calendar | null;
  asOf: string | null;
  basis: Basis;
  onAsOf(v: string | null): void;
  onBasis(b: Basis): void;
  exceptionCount: number;
  exceptionsOpen: boolean;
  onToggleExceptions(): void;
  mode: 'read' | 'author';
  onToggleMode(): void;
}

export function AnalystBar({
  calendar, asOf, basis, onAsOf, onBasis,
  exceptionCount, exceptionsOpen, onToggleExceptions, mode, onToggleMode,
}: AnalystBarProps) {
  const dates = calendar?.dates ?? [];
  const latest = calendar?.latest ?? '';
  const current = asOf ?? latest;
  const behind = current && latest ? daysBehind(dates, current) : 0;

  return (
    <div className="cr-analyst" data-testid="analyst-bar">
      <span className="cr-analyst-label">as of</span>
      <select
        className="cr-select cr-select-asof"
        data-testid="as-of"
        value={current}
        disabled={!calendar}
        onChange={(e) => onAsOf(e.target.value === latest ? null : e.target.value)}
      >
        {/* Latest first: the date an analyst wants is almost always the top one. */}
        {dates.map((d, i) => (
          <option key={d} value={d}>{labelFor(dates, i, latest)}</option>
        )).reverse()}
      </select>

      <select
        className="cr-select cr-select-basis"
        data-testid="basis"
        value={basis}
        onChange={(e) => onBasis(e.target.value as Basis)}
      >
        {(calendar?.bases ?? (['prior_day', 'prior_week', 'month_end'] as Basis[])).map((b) => (
          <option key={b} value={b}>{BASIS_LABEL[b]}</option>
        ))}
      </select>

      {/*
        Where the prototype showed a feed-refresh SLO, this says the one thing
        the platform can actually vouch for: whether you are reading the latest
        close or standing behind it. A hardcoded "on time" would be chrome
        asserting a fact no part of this system checks.
      */}
      <span
        className="cr-slo"
        data-behind={behind > 0 || undefined}
        data-testid="slo"
        title={behind > 0
          ? 'every widget on this board is evaluated at the selected date'
          : 'the board is reading the most recent close the engine carries'}
      >
        {behind > 0 ? `${behind} day${behind === 1 ? '' : 's'} behind close` : 'at latest close'}
      </span>

      <button
        type="button"
        className="cr-exceptions-toggle"
        data-testid="exceptions-toggle"
        data-open={exceptionsOpen || undefined}
        data-clean={exceptionCount === 0 || undefined}
        title="Exceptions — press e"
        onClick={onToggleExceptions}
      >
        exceptions <span className="cr-exceptions-count">{exceptionCount}</span>
      </button>

      <button
        type="button"
        className="cr-mode-toggle"
        data-testid="mode-toggle"
        data-mode={mode}
        title="Read / author — press r"
        onClick={onToggleMode}
      >
        {mode === 'author' ? 'Author' : 'Read'}
      </button>
    </div>
  );
}
