/**
 * What this edit does, while it is still an edit.
 *
 * The diagnostics strip answers "is this document well formed?". This answers a
 * different question that nothing on the surface asked before: **what does
 * changing it do to things that already exist?** Those come apart most sharply
 * on a threshold — a monitor with a raised limit is perfectly well formed, has
 * no diagnostics, and has quietly stopped watching sixteen series.
 *
 * It sits above the editor rather than in the problems strip on purpose. A
 * problem is something wrong with what you wrote; this is a consequence of what
 * you wrote being right. Filing them together would teach people to clear both
 * with the same reflex.
 *
 * Nothing here blocks. The surface has no maker-checker model yet and inventing
 * a soft one — a dialog somebody clicks through — would be worse than saying the
 * thing plainly. The MCP path *does* block, because an agent has no eyes to read
 * a banner with; see `mcp/tools.ts`.
 */

import type { Finding, ImpactReport } from '../engine/impact';

interface Props {
  impact: ImpactReport;
  open: boolean;
  onToggle(): void;
}

const HUE: Record<Finding['direction'], string> = {
  weakens: 'var(--mdl-unresolved)',
  strengthens: 'var(--mdl-dimension)',
  changes: 'var(--mdl-warn)',
};

const LABEL: Record<Finding['consequence'], string> = {
  control: 'Control',
  restatement: 'Restates history',
  filed: 'What is filed',
  assumption: 'Assumption',
  definition: 'Definition',
};

export function ChangeImpact({ impact, open, onToggle }: Props) {
  if (!impact.findings.length) return null;

  const weakening = impact.findings.filter((f) => f.direction === 'weakens');
  const headline = weakening[0] || impact.findings[0];

  return (
    <div
      className="mdl-impact"
      data-testid="mdl-impact"
      data-review={impact.needsReview}
    >
      <button
        type="button"
        className="mdl-impact-head"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="mdl-impact-toggle"
      >
        <span
          className="mdl-dot"
          style={{ background: HUE[headline.direction] }}
          aria-hidden="true"
        />
        <span className="mdl-impact-tag">{LABEL[headline.consequence]}</span>
        <span className="mdl-impact-summary">{headline.summary}</span>
        {impact.findings.length > 1 ? (
          <span className="mdl-impact-more">+{impact.findings.length - 1}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {/* Said out loud rather than implied by colour, because the whole point
            is that this change looks harmless. */}
        {impact.needsReview ? (
          <span className="mdl-impact-review">worth a second pair of eyes</span>
        ) : null}
        <span className="mdl-impact-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="mdl-impact-body">
          {impact.findings.map((f) => (
            <div className="mdl-impact-finding" key={`${f.consequence}-${f.summary}`}>
              <div className="mdl-impact-finding-head">
                <span
                  className="mdl-dot mdl-dot-sm"
                  style={{ background: HUE[f.direction] }}
                  aria-hidden="true"
                />
                <span className="mdl-impact-tag">{LABEL[f.consequence]}</span>
                <span className="mdl-impact-summary">{f.summary}</span>
              </div>
              {f.detail.map((d) => (
                <p className="mdl-impact-detail" key={d}>{d}</p>
              ))}

              {/* The specific things that stop being true. A count is a claim; a
                  list is evidence, and it is what makes the difference between
                  "trust me" and "look". */}
              {f.silenced?.length ? (
                <ul className="mdl-impact-silenced">
                  {f.silenced.slice(0, 6).map((s) => (
                    <li key={`${s.key}-${s.date}`}>
                      <span className="mono">{s.key}</span>
                      <span className="mdl-impact-date">{s.date}</span>
                      <span className="tnum">
                        {s.delta >= 0 ? '+' : '−'}
                        {Math.abs(s.delta).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                    </li>
                  ))}
                  {f.silenced.length > 6 ? (
                    <li className="mdl-impact-date">
                      …and {f.silenced.length - 6} more
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
