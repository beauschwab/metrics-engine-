/**
 * Coverage — the verification instrument for a classification.
 *
 * A measure is proved by its number. A rule set has no single number, so the
 * question "is this right?" becomes three others, in this order: does every
 * record land somewhere, where did the money go, and which rule decided each
 * record. The panel answers them top to bottom.
 *
 * The migration list is the blast radius for a rule change — not which
 * measures moved, but how much notional changed product ID and where it went.
 */

import { fmt } from 'keel-engine/format';
import type { Coverage, Migration } from 'keel-engine/rows';
import { HUE } from 'keel-engine/vocab';

interface Props {
  coverage: Coverage | null;
  migration: Migration[];
  onPickRule(id: string): void;
}

function Bar({ share, hue }: { share: number; hue: string }) {
  return (
    <span className="mdl-share" aria-hidden="true">
      <span style={{ width: `${Math.max(1, share * 100)}%`, background: hue }} />
    </span>
  );
}

export function CoveragePanel({ coverage, migration, onPickRule }: Props) {
  if (!coverage) {
    return (
      <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--mdl-text-faint)' }}>
        No version of this rule set is in force on the reporting date, so nothing is classified.
      </div>
    );
  }

  const clean = coverage.unmatched === 0;
  const share = coverage.totalNotional
    ? coverage.matchedNotional / coverage.totalNotional
    : 0;

  return (
    <div>
      {/* ---- the headline: is everything classified? ---- */}
      <div className="mdl-section">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="mdl-eyebrow">Coverage</span>
          <span style={{ flex: 1 }} />
          <span
            className="mdl-eyebrow-quiet"
            style={{ color: clean ? '#34c77b' : HUE.unresolved, letterSpacing: '0.08em' }}
          >
            {clean ? 'every record mapped' : 'records unmapped'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span className="mdl-value" style={clean ? undefined : { color: HUE.unresolved }}>
            {(share * 100).toFixed(1)}%
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--mdl-text-faint)' }}>
            of notional
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            rowGap: 3,
            marginTop: 10,
            fontSize: 12,
          }}
        >
          <span style={{ color: 'var(--mdl-text-faint)' }}>records</span>
          <span className="mono tnum">
            {coverage.matched.toLocaleString('en-US')} / {coverage.total.toLocaleString('en-US')}
          </span>
          <span style={{ color: 'var(--mdl-text-faint)' }}>classified</span>
          <span className="mono tnum">{fmt(coverage.matchedNotional, 'currency_usd')}</span>
          {coverage.unmatched > 0 ? (
            <>
              <span style={{ color: HUE.unresolved }}>unmapped</span>
              <span className="mono tnum" style={{ color: HUE.unresolved }}>
                {fmt(coverage.unmatchedNotional, 'currency_usd')}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* ---- where the money went ---- */}
      <div className="mdl-section">
        <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>
          Notional by {coverage.column}
        </div>
        {coverage.values.map((v) => (
          <div key={v.value} className="mdl-cov-row">
            <span className="mono" style={{ color: 'var(--mdl-measure)', minWidth: 54 }}>
              {v.value}
            </span>
            <Bar
              share={coverage.matchedNotional ? v.notional / coverage.matchedNotional : 0}
              hue={HUE.measure}
            />
            <span
              className="mono tnum"
              style={{ fontSize: 11, color: 'var(--mdl-text-faint)', minWidth: 52, textAlign: 'right' }}
            >
              {v.records.toLocaleString('en-US')}
            </span>
            <span className="mono tnum" style={{ fontSize: 11, minWidth: 92, textAlign: 'right' }}>
              {fmt(v.notional, 'currency_usd')}
            </span>
          </div>
        ))}
        {coverage.values.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--mdl-text-faint)' }}>
            No rule matched anything in this test data.
          </div>
        ) : null}
      </div>

      {/* ---- which rule decided what ---- */}
      <div className="mdl-section">
        <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>
          Rules
        </div>
        {coverage.rules.map((r) => {
          const preempted = coverage.preemptedBy[r.id] || [];
          const dead = r.records === 0;
          return (
            <div key={r.id}>
              <div
                className="mdl-cov-row"
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer' }}
                onClick={() => onPickRule(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onPickRule(r.id);
                }}
              >
                <span
                  className="mono"
                  style={{ minWidth: 46, color: dead ? HUE.warn : 'var(--mdl-text)' }}
                >
                  {r.id}
                </span>
                <span className="mono" style={{ color: 'var(--mdl-text-faint)', minWidth: 46, fontSize: 11 }}>
                  {r.emit}
                </span>
                <Bar
                  share={coverage.matchedNotional ? r.notional / coverage.matchedNotional : 0}
                  hue={dead ? HUE.warn : HUE.dimension}
                />
                <span
                  className="mono tnum"
                  style={{ fontSize: 11, color: 'var(--mdl-text-faint)', minWidth: 52, textAlign: 'right' }}
                >
                  {r.records.toLocaleString('en-US')}
                </span>
                <span className="mono tnum" style={{ fontSize: 11, minWidth: 92, textAlign: 'right' }}>
                  {fmt(r.notional, 'currency_usd')}
                </span>
              </div>
              {/* Precedence is documentation, not a defect — it belongs here
                  rather than in the problems strip. */}
              {preempted.length ? (
                <div className="mdl-cov-note">
                  {preempted
                    .map((p) => `${p.by} takes ${p.records.toLocaleString('en-US')} first`)
                    .join(' · ')}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* ---- what a change to this rule set would move ---- */}
      <div style={{ padding: '14px 16px' }}>
        <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>
          If you file this, {migration.length ? `${migration.length} flows move` : 'nothing moves'}
        </div>
        {migration.map((m) => (
          <div key={`${m.from}-${m.to}`} className="mdl-cov-row">
            <span className="mono" style={{ fontSize: 11, minWidth: 50 }}>{m.from}</span>
            <span style={{ color: 'var(--mdl-text-faint)', fontSize: 10 }}>→</span>
            <span className="mono" style={{ fontSize: 11, minWidth: 50, color: 'var(--mdl-measure)' }}>
              {m.to}
            </span>
            <span style={{ flex: 1 }} />
            <span
              className="mono tnum"
              style={{ fontSize: 11, color: 'var(--mdl-text-faint)', minWidth: 46, textAlign: 'right' }}
            >
              {m.records.toLocaleString('en-US')}
            </span>
            <span
              className="mono tnum"
              style={{ fontSize: 11, minWidth: 92, textAlign: 'right', color: HUE.warn }}
            >
              {fmt(m.notional, 'currency_usd')}
            </span>
          </div>
        ))}
        {migration.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--mdl-text-faint)' }}>
            This rule set classifies every record exactly as the filed version does.
          </div>
        ) : null}
      </div>
    </div>
  );
}
