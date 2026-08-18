/**
 * The definition card, on hover after 300ms.
 *
 * The live value is the reason this card exists. Every other field is metadata
 * an author could find elsewhere; the current computed number is what tells
 * them whether the reference they just typed is the one they meant.
 */

import type { Evaluator } from 'keel-engine/evaluate';
import { aggregate } from 'keel-engine/evaluate';
import { AS_OF, TABLES } from 'keel-engine/fixtures';
import { fmt } from 'keel-engine/format';
import { reqs, type Graph } from 'keel-engine/parse';
import { dependents } from 'keel-engine/trace';
import { pillHue } from 'keel-engine/tokens';
import {
  EXTERNAL, FIXTURES, KIND_LABEL, META, STATE_LABEL,
  type FixtureName, type PillKind, type PillState,
} from 'keel-engine/vocab';

export interface CardTarget {
  name: string;
  kind: PillKind;
  state: PillState;
  x: number;
  y: number;
}

interface Props {
  target: CardTarget;
  graph: Graph;
  evaluator: Evaluator;
  fixture: FixtureName;
}

const GLYPH: Record<PillKind, string> = {
  measure: '⟨',
  dimension: '▤ ',
  func: 'ƒ ',
  column: '· ',
};

export function DefinitionCard({ target, graph, evaluator, fixture }: Props) {
  const { name, kind, state } = target;
  const m = graph.byName[name];
  const ext = EXTERNAL[name];
  const r = evaluator.value(name);
  const meta = META[name];
  const tier = m ? parseInt(m.f.sr_11_7_tier || '0', 10) : 0;
  const hue = pillHue(kind, state);
  const type = m ? (m.f.type || '').trim() : '';

  const columnTotal =
    kind === 'column'
      ? aggregate(
          'sum',
          ((TABLES[fixture][graph.view.source] || {})[AS_OF] || [])
            .map((row) => row[name])
            .filter((x): x is number => typeof x === 'number'),
        )
      : NaN;

  const expr = m
    ? type === 'simple'
      ? `${m.f.agg || 'sum'}(${m.f.field})${m.f.where ? `\n  where ${m.f.where}` : ''}`
      : type === 'windowed'
        ? `${m.f['window.op'] || '?'} of ${reqs(m)[0] || '?'}\n  over the trailing ${m.f['window.over'] || '1d'}`
        : (m.f.expression || '')
    : kind === 'func'
      ? `${name}(…) · built-in function`
      : '';

  const description = m
    ? m.f.description || `No description yet — required at oversight level ${tier || 0}.`
    : kind === 'column'
      ? 'A raw column in the source table. Nothing is defined about it beyond its type.'
      : ext
        ? 'Defined in another file, not this one.'
        : '';

  return (
    <div
      className="mdl-card"
      role="tooltip"
      style={{ left: Math.min(target.x, window.innerWidth - 356), top: Math.min(target.y, window.innerHeight - 320) }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 6px 12px' }}>
        <span className="mono" style={{ fontSize: 13, color: hue }}>
          {GLYPH[kind]}
          {state === 'restricted' ? 'restricted' : name}
          {kind === 'measure' && state !== 'restricted' ? '⟩' : ''}
        </span>
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 11, color: tier ? 'var(--mdl-signal)' : 'var(--mdl-text-faint)' }}
        >
          {tier
            ? `oversight level ${tier}`
            : ext && ext.deprecated
              ? 'being retired'
              : KIND_LABEL[kind]}
        </span>
      </div>

      <div style={{ padding: '0 12px 8px 12px', fontSize: 12 }}>
        {m
          ? m.f.label || m.name.replace(/_/g, ' ')
          : ext
            ? ext.label
            : kind === 'column'
              ? `Column on ${graph.view.source}`
              : kind === 'func'
                ? 'Registered function'
                : name}
      </div>

      {description ? (
        <div
          style={{ padding: '0 12px 10px 12px', color: 'var(--mdl-text-muted)', fontSize: 12, lineHeight: '17px' }}
        >
          {description}
        </div>
      ) : null}

      <div className="mdl-card-value">
        <span className="mono tnum" style={{ fontSize: 15, color: 'var(--mdl-signal)' }}>
          {kind === 'column' ? fmt(columnTotal, 'currency_usd') : fmt(r.v, r.format)}
        </span>
        <span style={{ flex: 1 }} />
        <span className="mdl-eyebrow-quiet" style={{ letterSpacing: '0.08em' }}>
          on {(FIXTURES[fixture] || fixture).toLowerCase()} · {AS_OF}
        </span>
      </div>

      {expr ? (
        <div
          className="mono"
          style={{
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--mdl-text-muted)',
            lineHeight: '17px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {expr}
        </div>
      ) : null}

      <div className="mdl-card-meta">
        <span style={{ color: 'var(--mdl-text-faint)' }}>shape</span>
        <span className="mono">{(meta?.grain || 'stock · as_of_date').replace('stock', 'point in time')}</span>
        <span style={{ color: 'var(--mdl-text-faint)' }}>owner</span>
        <span className="mono">{meta?.owner || 'ALM Analytics'}</span>
        <span style={{ color: 'var(--mdl-text-faint)' }}>rule</span>
        <span className="mono">{(m && m.f.citation) || meta?.cite || '—'}</span>
        <span style={{ color: 'var(--mdl-text-faint)' }}>used by</span>
        <span className="mono">{dependents(graph, name).length} measures</span>
        {state !== 'resolved' ? (
          <>
            <span style={{ color: 'var(--mdl-text-faint)' }}>status</span>
            <span className="mono">{STATE_LABEL[state]}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
