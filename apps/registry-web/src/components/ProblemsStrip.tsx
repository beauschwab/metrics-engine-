/**
 * The problems strip.
 *
 * Collapsed to a one-line summary by default, expanding on click, grouped
 * worst-first. Clicking a row navigates to it; the fix button applies a
 * transformation the author can read in the diff afterwards.
 */

import type { Diagnostic, Fix } from 'keel-engine/diagnostics';
import { plural } from 'keel-engine/format';
import type { Conformance } from 'keel-engine/plan';
import { HUE } from 'keel-engine/vocab';

interface Props {
  diagnostics: Diagnostic[];
  conformance: Conformance[];
  open: boolean;
  loopMs: number;
  onToggle(): void;
  onGo(line: number): void;
  onFix(fix: Fix): void;
  /**
   * Attach this diagnostic to the definition agent's next message (ADR-56).
   * Optional so the strip stands alone; when absent, no ask affordance renders.
   */
  onAsk?(d: Diagnostic): void;
  asked?(d: Diagnostic): boolean;
}

const SEV_ORDER = { error: 0, warn: 1, info: 2 } as const;
const SEV_GLYPH = { error: '✕', warn: '⚠', info: 'i' } as const;
const SEV_HUE = { error: HUE.unresolved, warn: HUE.warn, info: HUE.measure } as const;

export function ProblemsStrip({
  diagnostics, conformance, open, loopMs, onToggle, onGo, onFix, onAsk, asked,
}: Props) {
  const errors = diagnostics.filter((d) => d.sev === 'error').length;
  const warns = diagnostics.filter((d) => d.sev === 'warn').length;
  const infos = diagnostics.filter((d) => d.sev === 'info').length;

  const ok = conformance.filter((c) => c.ok).length;
  const gaps = conformance.length - ok;

  const summary = errors
    ? `✕ ${plural(errors, 'error')} · ${plural(warns, 'warning')}`
    : warns
      ? `⚠ ${plural(warns, 'warning')} · ${infos} info`
      : `✓ no problems · ${infos} info`;

  const summaryHue = errors ? HUE.unresolved : warns ? HUE.warn : '#34c77b';

  const sorted = [...diagnostics].sort(
    (a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || a.code.localeCompare(b.code) || a.line - b.line,
  );

  return (
    <div className="mdl-problems">
      <button type="button" className="mdl-problems-bar" onClick={onToggle} aria-expanded={open}>
        <span style={{ color: 'var(--mdl-text-faint)', fontSize: 10 }} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span style={{ color: summaryHue }}>{summary}</span>
        <span style={{ color: '#34c77b' }}>✓ works on {ok} databases</span>
        {gaps ? <span style={{ color: HUE.warn }}>⚠ {plural(gaps, 'gap')}</span> : null}
        <span style={{ flex: 1 }} />
        <span className="tnum" style={{ color: 'var(--mdl-text-faint)', fontSize: 11 }}>
          updated in {loopMs}ms
        </span>
      </button>

      {open ? (
        <div className="mdl-problems-list mdl-scroll" role="list">
          {sorted.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--mdl-text-faint)' }}>
              Nothing to fix. Diagnostics appear here as you edit.
            </div>
          ) : null}
          {sorted.slice(0, 40).map((d, i) => (
            <div
              key={`${d.code}-${d.line}-${i}`}
              role="listitem"
              className="mdl-problem"
              onClick={() => onGo(d.line)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onGo(d.line);
              }}
              tabIndex={0}
            >
              <span style={{ color: SEV_HUE[d.sev], fontSize: 10, width: 10 }} aria-hidden="true">
                {SEV_GLYPH[d.sev]}
              </span>
              <span className="mdl-problem-code">{d.code}</span>
              <span>{d.message}</span>
              <span style={{ flex: 1 }} />
              <span className="mdl-problem-where">line {d.line + 1}</span>
              {d.fix ? (
                <button
                  type="button"
                  className="mdl-fix"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFix(d.fix!);
                  }}
                >
                  {d.fixLabel || 'Quick fix'}
                </button>
              ) : null}
              {onAsk ? (
                /* A diagnostic is the rail's pointer: `✳ ask` attaches the
                   code, the line and the message as a resolved reference, and
                   asking again detaches (ADR-56). */
                <button
                  type="button"
                  className="mdl-ask"
                  data-testid={`ask-${d.code}-L${d.line + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAsk(d);
                  }}
                >
                  {asked?.(d) ? '✳ in chat' : '✳ ask'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
