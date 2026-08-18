/**
 * A governed assumption table, read rather than authored.
 *
 * The set is bounded, so the compiler inlines it as a literal mapping rather
 * than joining to it — which is what keeps the regulatory rates inside the
 * governed artifact instead of in an upstream table nobody reviews.
 */

import { sectionBlocks, type Graph } from 'keel-engine/parse';

interface Props {
  graph: Graph;
}

export function ParameterPanel({ graph }: Props) {
  const keys = (graph.view.keys || '')
    .replace(/[[\]]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const valueField = (graph.view.value || '').trim();
  const entries = sectionBlocks(graph, 'entries');
  const from = (graph.view['effective.from'] || '').trim();
  const to = (graph.view['effective.to'] || '').trim();

  return (
    <div>
      <div className="mdl-section">
        <div className="mdl-eyebrow">In force</div>
        <div className="mono" style={{ fontSize: 15, marginTop: 6, color: 'var(--mdl-signal)' }}>
          {from || '—'} → {to || 'open'}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--mdl-text-faint)' }}>
          {entries.length} entries keyed by {keys.join(' · ') || '—'}
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div className="mdl-eyebrow" style={{ marginBottom: 10 }}>
          {valueField || 'value'}
        </div>
        {entries.map((e) => (
          <div key={e.name} className="mdl-cov-row">
            <span className="mono" style={{ color: 'var(--mdl-measure)', minWidth: 56 }}>
              {keys.map((k) => e.f[k]).join(' · ')}
            </span>
            <span style={{ flex: 1 }} />
            <span className="mono tnum" style={{ minWidth: 60, textAlign: 'right' }}>
              {(parseFloat(e.f[valueField] || '0') * 100).toFixed(1)}%
            </span>
            <span
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--mdl-text-faint)',
                minWidth: 118,
                textAlign: 'right',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {e.f.citation || '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
