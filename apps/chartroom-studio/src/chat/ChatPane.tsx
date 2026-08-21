/**
 * The embedded agent chat (ADR-34) — Claude-chat functionality built from
 * AI-Elements-vocabulary components on the studio's own design system:
 *
 *   Conversation  — the scroll region, stuck to the bottom while streaming
 *   Message       — one user or assistant turn
 *   Response      — the assistant's streamed markdown
 *   Tool          — a collapsible tool-call card (input → result / error)
 *   PromptInput   — textarea, Enter to send, Stop while streaming
 *   Suggestions   — starter chips when the thread is empty
 *
 * Transport is the server's SSE (`POST /api/chat`); the client keeps the
 * text-only history and replays it per turn (ADR-34). When the server has no
 * model, the pane says so and the rest of the studio carries on — the same
 * honesty as the design critic (ADR-35).
 */

import { useEffect, useRef, useState } from 'react';
import { Markdown } from './markdown';

interface ToolCall {
  name: string;
  input: unknown;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

/** One assistant turn accumulates interleaved text segments and tool calls. */
interface Segment {
  kind: 'text' | 'tool';
  text?: string;
  tool?: ToolCall;
}

interface Turn {
  role: 'user' | 'assistant';
  segments: Segment[];
}

const SUGGESTIONS = [
  'What metrics exist for liquidity coverage?',
  'Help me build a dashboard for the treasury committee',
  'What stands between lcr-monitor and team status?',
  'Lint and data-critique the open dashboard',
];

const textOf = (t: Turn): string =>
  t.segments.filter((s) => s.kind === 'text').map((s) => s.text ?? '').join('');

export function ChatPane({ dashboardId, onClose }: {
  dashboardId: string | null;
  onClose(): void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Conversation: stick to the bottom while content grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn: (turn: Turn) => Turn) =>
    setTurns((ts) => [...ts.slice(0, -1), fn(ts[ts.length - 1])]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput('');
    setUnavailable(null);

    const history = turns
      .map((t) => ({ role: t.role, text: textOf(t) }))
      .filter((m) => m.text.trim() !== '');
    setTurns((ts) => [
      ...ts,
      { role: 'user', segments: [{ kind: 'text', text: message }] },
      { role: 'assistant', segments: [] },
    ]);
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', text: message }],
          dashboard_id: dashboardId,
        }),
        signal: abort.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
          handleEvent(event);
        }
      }
    } catch {
      if (!abort.signal.aborted) {
        patchLast((t) => ({
          ...t,
          segments: [...t.segments, { kind: 'text', text: '\n\n*(the connection dropped — try again)*' }],
        }));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleEvent = (e: Record<string, unknown>) => {
    switch (e.type) {
      case 'text':
        patchLast((t) => {
          const last = t.segments[t.segments.length - 1];
          if (last?.kind === 'text') {
            return {
              ...t,
              segments: [...t.segments.slice(0, -1), { kind: 'text', text: (last.text ?? '') + String(e.delta) }],
            };
          }
          return { ...t, segments: [...t.segments, { kind: 'text', text: String(e.delta) }] };
        });
        break;
      case 'tool_start':
        patchLast((t) => ({
          ...t,
          segments: [...t.segments, { kind: 'tool', tool: { name: String(e.name), input: e.input } }],
        }));
        break;
      case 'tool_result':
        patchLast((t) => {
          let idx = -1;
          for (let j = t.segments.length - 1; j >= 0; j -= 1) {
            const s = t.segments[j];
            if (s.kind === 'tool' && s.tool!.name === e.name && s.tool!.ok === undefined && !s.tool!.error) {
              idx = j;
              break;
            }
          }
          if (idx < 0) return t;
          const segments = [...t.segments];
          const tool = { ...segments[idx].tool! };
          if (e.ok) { tool.ok = true; tool.result = e.result; } else { tool.ok = false; tool.error = String(e.error); }
          segments[idx] = { kind: 'tool', tool };
          return { ...t, segments };
        });
        break;
      case 'unavailable':
        setUnavailable(String(e.message));
        setTurns((ts) => ts.slice(0, -2)); // drop the empty exchange
        break;
      case 'error':
        patchLast((t) => ({
          ...t,
          segments: [...t.segments, { kind: 'text', text: `\n\n*(${String(e.message)})*` }],
        }));
        break;
      default: // turn_end, done — no UI state to change
    }
  };

  return (
    <aside className="cr-chat" data-testid="chat-pane">
      <header className="cr-chat-head">
        <span className="cr-chat-title">Design agent</span>
        {dashboardId && <span className="cr-chat-ctx">{dashboardId}</span>}
        <span className="cr-header-spacer" />
        <button type="button" className="cr-crossfilter-clear" data-testid="chat-close" onClick={onClose}>
          close
        </button>
      </header>

      {unavailable && (
        <div className="cr-chat-unavailable" data-testid="chat-unavailable">
          {unavailable}
        </div>
      )}

      <div className="cr-chat-conversation" ref={scrollRef} data-testid="chat-conversation">
        {turns.length === 0 && !unavailable && (
          <div className="cr-chat-suggestions" data-testid="chat-suggestions">
            <p className="cr-hint">
              The intake interview happens here; approval stays with you in the
              Brief and Govern tabs. Try:
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="cr-chat-suggestion" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="cr-chat-message" data-role={turn.role}>
            {turn.role === 'user'
              ? <div className="cr-chat-user">{textOf(turn)}</div>
              : (
                <div className="cr-chat-response">
                  {turn.segments.map((seg, j) => (seg.kind === 'text'
                    ? <Markdown key={j} text={seg.text ?? ''} />
                    : <ToolCard key={j} tool={seg.tool!} />))}
                  {streaming && i === turns.length - 1 && <span className="cr-chat-cursor" />}
                </div>
              )}
          </div>
        ))}
      </div>

      <form
        className="cr-chat-input"
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        <textarea
          className="cr-chat-textarea"
          data-testid="chat-input"
          placeholder={unavailable ? 'no model configured' : 'Describe the dashboard you need…'}
          value={input}
          disabled={!!unavailable}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        {streaming
          ? (
            <button
              type="button"
              className="cr-fix"
              data-testid="chat-stop"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </button>
          )
          : (
            <button type="submit" className="cr-save" data-testid="chat-send" disabled={!!unavailable || !input.trim()}>
              Send
            </button>
          )}
      </form>
    </aside>
  );
}

function ToolCard({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);
  const state = tool.error ? 'error' : tool.ok ? 'done' : 'running';
  return (
    <div className="cr-chat-tool" data-state={state} data-testid={`chat-tool-${tool.name}`}>
      <button type="button" className="cr-chat-tool-head" onClick={() => setOpen(!open)}>
        <span className="cr-chat-tool-dot" />
        <span className="cr-chat-tool-name">{tool.name}</span>
        <span className="cr-chat-tool-state">
          {state === 'running' ? 'running…' : state === 'error' ? 'refused' : 'done'}
        </span>
      </button>
      {open && (
        <div className="cr-chat-tool-body">
          <div className="cr-chat-tool-label">input</div>
          <pre className="cr-chat-code">{JSON.stringify(tool.input, null, 1)}</pre>
          {tool.error && (
            <>
              <div className="cr-chat-tool-label">refusal</div>
              <pre className="cr-chat-code" data-error>{tool.error}</pre>
            </>
          )}
          {tool.ok && (
            <>
              <div className="cr-chat-tool-label">result</div>
              <pre className="cr-chat-code">{clip(JSON.stringify(tool.result, null, 1))}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const clip = (s: string) => (s.length > 4000 ? `${s.slice(0, 4000)} …` : s);
