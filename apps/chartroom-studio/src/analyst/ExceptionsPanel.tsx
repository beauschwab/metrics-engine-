/**
 * The exception strip — what an analyst has to answer for before trusting the
 * board, above the board rather than behind a tab.
 *
 * Acknowledging is a reading gesture, not a governance one: it hides the row
 * for this session and nothing else. It writes no audit record and clears no
 * gate, because a breach that a reader dismissed is still a breach at
 * promotion time — the findings tab and the promotion gate are unmoved by
 * anything that happens here.
 */

import type { Exception } from './exceptions';

export interface ExceptionsPanelProps {
  exceptions: Exception[];
  onAck(id: string): void;
  onHide(): void;
  /** Jumping to the widget a finding names, when it names one. */
  onSelect(widget: string): void;
}

export function ExceptionsPanel({ exceptions, onAck, onHide, onSelect }: ExceptionsPanelProps) {
  return (
    <div className="cr-exceptions" data-testid="exceptions-panel">
      <div className="cr-exceptions-head">
        <span className="cr-exceptions-title">Exceptions on this board</span>
        <span className="cr-context-spacer" />
        <button type="button" className="cr-exceptions-hide" data-testid="exceptions-hide" onClick={onHide}>
          hide
        </button>
      </div>
      {exceptions.map((x) => (
        <div
          className="cr-exception"
          key={x.id}
          data-tone={x.tone}
          data-testid={`exception-${x.code}`}
        >
          <span className="cr-exception-dot" aria-hidden="true" />
          <span className="cr-exception-kind">{x.kind}</span>
          <span className="cr-exception-code">{x.code}</span>
          <span className="cr-exception-message">{x.message}</span>
          <span className="cr-exception-scope">
            {x.widget
              ? (
                <button
                  type="button"
                  className="cr-exception-jump"
                  onClick={() => onSelect(x.widget as string)}
                >
                  {x.scope}
                </button>
              )
              : x.scope}
          </span>
          <span className="cr-exception-action">{x.action}</span>
          <button
            type="button"
            className="cr-exception-ack"
            data-testid={`ack-${x.code}`}
            title="Hide this row for the rest of the session — it clears no gate"
            onClick={() => onAck(x.id)}
          >
            Acknowledge
          </button>
        </div>
      ))}
    </div>
  );
}
