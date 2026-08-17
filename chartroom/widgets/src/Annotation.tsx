/**
 * annotation@1 — author commentary, beside the number it is about.
 *
 * A committee pack's standing complaint is that the explanation lives in an
 * email and the chart lives in a deck, so the two drift apart until nobody
 * can say which quarter the sentence was written for. Binding commentary to a
 * metric fixes that structurally: the note travels with the pinned revision,
 * so when that metric moves, the upgrade notice can name the commentary as
 * something to re-read.
 *
 * The note is prose, rendered as text — not markup. A commentary panel that
 * accepted HTML would be a stored-XSS hole in a governed artifact, and the
 * governance value here is provenance, not typography.
 */

import type { WidgetProps } from './types';
import { formatDelta, formatValue } from './format';

export function Annotation({ instance, data, status, error }: WidgetProps) {
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const note = instance.note?.trim();
  const scalar = data?.scalar;

  return (
    <div className="cr-annotation">
      {note
        ? <p className="cr-annotation-note">{note}</p>
        : (
          <p className="cr-annotation-note cr-annotation-empty">
            no commentary written yet
          </p>
        )}
      <div className="cr-annotation-anchor">
        {status === 'loading' && <span className="cr-skeleton cr-skeleton-inline" />}
        {status !== 'loading' && scalar && Number.isFinite(scalar.value) && (
          <>
            <span className="cr-annotation-value tnum">
              {formatValue(scalar.value, data!.format, instance.format?.decimals)}
            </span>
            <span className="cr-annotation-delta tnum">
              {formatDelta(scalar.value, scalar.prior, data!.format)}
            </span>
          </>
        )}
        {status !== 'loading' && data?.asOf && (
          <span className="cr-annotation-asof">as of {data.asOf}</span>
        )}
      </div>
    </div>
  );
}
