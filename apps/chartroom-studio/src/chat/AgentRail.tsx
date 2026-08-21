/**
 * The design agent, as a left rail (ADR-55) — the v3 handoff's Track B over
 * the embedded chat that ADR-34 built.
 *
 * What moved and what did not: the placement (right pane → left rail), the
 * composer (completions for `/` commands, `@` widgets-functions-boards, `#`
 * pattern references, file drop, the scope chip), the element pointers, the
 * phase spine, and the empty state are new. The transport is not — this is
 * the same frozen SSE contract (ADR-37), read by the same parser, degrading
 * to the same honest banner when no model or no service is there (ADR-35).
 *
 * The prototype's segment taxonomy is six kinds; the real stream carries
 * three — `text`, `tool`, and (additively, when the model produces them)
 * `thinking`. Checklist and artifact cards are structures the prototype
 * scripts; rendering them from anything other than real events would be a
 * conversation pretending to a shape it does not have, so they wait for the
 * agent service to emit them.
 *
 * Pointers are the load-bearing interaction: `✳ ask` on a panel turns
 * "explain this tile" into a resolved reference. The pointer serializes the
 * widget id, its binding, and the environment the user was looking at into
 * the message the agent actually receives — the scope, not just the widget.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardSpec } from 'chartroom-spec';
import { Markdown } from './markdown';
import type { ContractSummary, DashboardSummary, PatternSummary } from '../data';
import type { AnalystEnv } from '../bindings';

export interface Pointer {
  id: string;
  /** `{widget type} · {measure ref}` — the tooltip, and the agent's context. */
  detail: string;
}

interface ToolCall {
  name: string;
  input: unknown;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

interface Segment {
  kind: 'text' | 'tool' | 'thinking';
  text?: string;
  tool?: ToolCall;
}

interface AttachedFile {
  name: string;
  meta: string;
  text: string;
}

interface Turn {
  role: 'user' | 'assistant';
  segments: Segment[];
  pointers?: Pointer[];
  files?: Array<{ name: string; meta: string }>;
}

export type Phase = 'intake' | 'brief' | 'compose' | 'verify' | 'govern';

const PHASES: Array<{ id: Phase; label: string; hint: string }> = [
  { id: 'intake', label: 'Intake', hint: 'what decision, whose, how often' },
  { id: 'brief', label: 'Brief', hint: 'written, then approved by you' },
  { id: 'compose', label: 'Compose', hint: 'widgets bound to governed functions' },
  { id: 'verify', label: 'Verify', hint: 'guide lint and the data critic' },
  { id: 'govern', label: 'Govern', hint: 'sign-offs and promotion' },
];

const SLASH: Array<{ cmd: string; args: string; hint: string; phase: Phase }> = [
  { cmd: '/brief', args: '', hint: 'draft the design brief from this conversation', phase: 'brief' },
  { cmd: '/compose', args: '[pattern]', hint: 'lay out widgets against the approved brief', phase: 'compose' },
  { cmd: '/explain', args: '[@widget]', hint: 'trace a number to its components and query', phase: 'verify' },
  { cmd: '/lint', args: '', hint: 'run the guide linter and the data critic', phase: 'verify' },
  { cmd: '/registry', args: '[term]', hint: 'search governed functions', phase: 'intake' },
  { cmd: '/gate', args: '', hint: 'what stands between here and the next status', phase: 'govern' },
  { cmd: '/propose', args: '<metric>', hint: 'file a registry proposal for a missing measure', phase: 'brief' },
];

const STARTERS: Array<{ label: string; text: string }> = [
  { label: 'zero to one', text: 'Build a funding concentration board for the treasury committee' },
  { label: 'what is blocking promotion', text: '/gate' },
  { label: 'verify the open board', text: '/lint' },
  { label: 'search the registry', text: '/registry outflows' },
];

/**
 * Where in the workflow the last message points. Presentation only — the
 * spine orients, it gates nothing; the gates stay in the Brief and Govern
 * tabs where a human action clears them.
 */
export function phaseOf(msg: string): Phase {
  const m = msg.trim().toLowerCase();
  const hit = SLASH.find((s) => m.startsWith(s.cmd));
  if (hit) return hit.phase;
  if (/\bbrief\b/.test(m)) return 'brief';
  if (/compose|lay ?out|build the board|apply/.test(m)) return 'compose';
  if (/explain|trace|come from|lint|critic|verify|check/.test(m)) return 'verify';
  if (/promot|gate|sign.?off|\bstatus\b/.test(m)) return 'govern';
  return 'intake';
}

/** Files the composer will inline. Anything else is refused with the reason. */
const INLINE_LIMIT = 32_768;
const TEXTY = /\.(csv|json|txt|md|ya?ml|sql)$/i;

const textOf = (t: Turn): string =>
  t.segments.filter((s) => s.kind === 'text').map((s) => s.text ?? '').join('');

export function AgentRail({
  dashboardId, spec, contracts, boards, patterns, env, scopeLabel,
  pointers, onRemovePointer, onClearPointers, onClose,
}: {
  dashboardId: string | null;
  spec: DashboardSpec | null;
  contracts: ContractSummary[];
  boards: DashboardSummary[];
  patterns: PatternSummary[];
  env: AnalystEnv;
  scopeLabel: string;
  pointers: Pointer[];
  onRemovePointer(id: string): void;
  onClearPointers(): void;
  onClose(): void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('intake');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Auto-scroll keyed on streamed length, so a reader who scrolls up between
  // turns is not fought for the scrollbar on every render.
  const streamed = turns.reduce(
    (n, t) => n + t.segments.reduce((m, s) => m + (s.text?.length ?? 0), 0),
    0,
  );
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamed, turns.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn: (turn: Turn) => Turn) =>
    setTurns((ts) => [...ts.slice(0, -1), fn(ts[ts.length - 1])]);

  /**
   * What the agent receives: the message, then the scope it was typed under
   * and the pointers it names — resolved references, not prose the model has
   * to guess at. The transcript shows the typed text; the context block
   * travels only on the wire.
   */
  const wireText = (message: string): string => {
    const lines: string[] = [];
    if (dashboardId) {
      const scope = [
        `board: ${dashboardId}`,
        `as-of: ${env.asOf ?? 'latest close'}`,
        `basis: ${env.basis}`,
        ...(Object.keys(env.params).length
          ? [`scope: ${Object.entries(env.params).map(([k, v]) => `${k}=${v}`).join(' · ')}`]
          : []),
      ];
      lines.push(`[viewing] ${scope.join(' · ')}`);
    }
    pointers.forEach((p) => lines.push(`[pointer] @${p.id} — ${p.detail}`));
    files.forEach((f) => lines.push(`[attached ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``));
    return lines.length ? `${message}\n\n${lines.join('\n')}` : message;
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput('');
    setUnavailable(null);
    setFileProblem(null);
    setPhase(phaseOf(message));

    const history = turns
      .map((t) => ({ role: t.role, text: textOf(t) }))
      .filter((m) => m.text.trim() !== '');
    const sentPointers = pointers.slice();
    const sentFiles = files.map((f) => ({ name: f.name, meta: f.meta }));
    const payloadText = wireText(message);
    setTurns((ts) => [
      ...ts,
      { role: 'user', segments: [{ kind: 'text', text: message }], pointers: sentPointers, files: sentFiles },
      { role: 'assistant', segments: [] },
    ]);
    setStreaming(true);
    onClearPointers();
    setFiles([]);

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', text: payloadText }],
          dashboard_id: dashboardId,
          ...(threadId ? { thread_id: threadId } : {}),
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
          handleEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
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
      case 'thinking': {
        const kind = e.type as 'text' | 'thinking';
        patchLast((t) => {
          const last = t.segments[t.segments.length - 1];
          if (last?.kind === kind) {
            return {
              ...t,
              segments: [...t.segments.slice(0, -1), { kind, text: (last.text ?? '') + String(e.delta) }],
            };
          }
          return { ...t, segments: [...t.segments, { kind, text: String(e.delta) }] };
        });
        break;
      }
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
      case 'thread':
        setThreadId(String(e.thread_id));
        break;
      case 'unavailable':
        setUnavailable(String(e.message));
        setTurns((ts) => ts.slice(0, -2));
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

  // ---- composer completions ------------------------------------------------
  const menu = useMemo(() => {
    const trimmed = input.trimStart();
    if (trimmed.startsWith('/') && !/\s/.test(trimmed)) {
      const q = trimmed.slice(1).toLowerCase();
      return {
        title: 'Commands',
        items: SLASH.filter((s) => s.cmd.slice(1).startsWith(q)).map((s) => ({
          label: s.cmd, args: s.args, hint: s.hint, insert: `${s.cmd} `,
        })),
      };
    }
    const token = input.split(/\s/).pop() ?? '';
    if (token.startsWith('@')) {
      const q = token.slice(1).toLowerCase();
      const widgets = (spec?.widgets ?? []).map((w) => ({
        label: `@${w.id}`, args: 'widget', hint: w.title || w.id, insert: `@${w.id} `,
      }));
      const metrics = contracts.map((c) => ({
        label: `@${c.measure}`, args: `@${c.version}`, hint: `${c.doc} · ${c.status}`, insert: `@${c.measure} `,
      }));
      const ids = boards.map((b) => ({
        label: `@${b.id}`, args: 'board', hint: b.title, insert: `@${b.id} `,
      }));
      return {
        title: 'Widgets, functions, boards',
        items: [...widgets, ...metrics, ...ids]
          .filter((i) => i.label.slice(1).toLowerCase().startsWith(q))
          .slice(0, 7),
      };
    }
    if (token.startsWith('#')) {
      const q = token.slice(1).toLowerCase();
      return {
        title: 'Patterns and references',
        items: patterns
          .filter((p) => p.pattern.startsWith(q))
          .map((p) => ({ label: `#${p.pattern}`, args: `@${p.version}`, hint: p.title, insert: `#${p.pattern} ` })),
      };
    }
    return null;
  }, [input, spec, contracts, boards, patterns]);

  const menuOpen = !!menu && menu.items.length > 0;

  const insertToken = useCallback((insert: string) => {
    setInput((text) => {
      const parts = text.split(/(\s)/);
      let idx = parts.length - 1;
      while (idx > 0 && /^\s$/.test(parts[idx])) idx -= 1;
      parts[idx] = insert;
      return parts.join('');
    });
  }, []);

  // ---- files ---------------------------------------------------------------
  const takeFiles = (list: FileList | null) => {
    if (!list) return;
    Array.from(list).forEach((f) => {
      if (!TEXTY.test(f.name) || f.size > INLINE_LIMIT) {
        // The API carries text; pretending to attach what cannot travel would
        // be a chip that means nothing.
        setFileProblem(`${f.name} — only text files up to 32KB travel with a message`);
        return;
      }
      void f.text().then((text) => {
        setFiles((fs) => (fs.some((x) => x.name === f.name) ? fs : [
          ...fs, { name: f.name, meta: `${f.type || 'text'} · ${f.size}b`, text },
        ]));
      });
    });
  };

  const scopeChip = [
    dashboardId ?? 'no board',
    scopeLabel,
    env.asOf ?? 'latest close',
  ].join(' · ');

  const empty = turns.length === 0 && !unavailable;

  return (
    <aside
      className="cr-rail"
      data-testid="chat-pane"
      data-drag={dragOver || undefined}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFiles(e.dataTransfer.files); }}
    >
      <header className="cr-rail-head">
        <div className="cr-rail-head-row">
          <span className="cr-rail-dot" />
          <span className="cr-rail-title">Design agent</span>
          {threadId && (
            <span className="cr-rail-session" data-testid="session-label">{threadId.slice(0, 12)}</span>
          )}
          <span className="cr-header-spacer" />
          <button
            type="button"
            className="cr-rail-headlink"
            data-testid="chat-new"
            onClick={() => { setTurns([]); setThreadId(null); setPhase('intake'); setUnavailable(null); }}
          >
            new
          </button>
          <button type="button" className="cr-rail-headlink" data-testid="chat-close" onClick={onClose}>
            hide
          </button>
        </div>
        <div className="cr-rail-phases" data-testid="rail-phases">
          {PHASES.map((p, i) => {
            const at = PHASES.findIndex((x) => x.id === phase);
            const state = p.id === phase ? 'active' : i < at ? 'done' : 'ahead';
            return (
              <span key={p.id} className="cr-rail-phase" data-state={state} data-testid={`phase-${p.id}`} title={p.hint}>
                {p.label}
              </span>
            );
          })}
        </div>
      </header>

      {unavailable && (
        <div className="cr-chat-unavailable" data-testid="chat-unavailable">{unavailable}</div>
      )}

      <div className="cr-rail-thread" ref={scrollRef} data-testid="chat-conversation">
        {empty && (
          <div className="cr-rail-empty" data-testid="chat-suggestions">
            <h2 className="cr-rail-empty-head">What should this board decide?</h2>
            <p className="cr-hint">
              I interview, draft the brief, and compose against governed functions
              only. You approve the brief and the promotion — those two stay yours.
            </p>
            {STARTERS.map((s) => (
              <button key={s.label} type="button" className="cr-rail-starter" onClick={() => void send(s.text)}>
                <span className="cr-rail-starter-eyebrow">{s.label}</span>
                <span className="cr-rail-starter-text">{s.text}</span>
              </button>
            ))}
            {patterns.length > 0 && (
              <div className="cr-rail-refs">
                <span className="cr-rail-starter-eyebrow">references it can read</span>
                <div className="cr-rail-refrow">
                  {patterns.slice(0, 3).map((p) => (
                    <button
                      key={p.pattern}
                      type="button"
                      className="cr-rail-skill"
                      title={p.serves}
                      onClick={() => setInput((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}#${p.pattern} `)}
                    >
                      #{p.pattern}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="cr-chat-message" data-role={turn.role}>
            {turn.role === 'user'
              ? (
                <div className="cr-chat-user">
                  {(turn.pointers?.length ?? 0) > 0 && (
                    <div className="cr-rail-chiprow">
                      {turn.pointers!.map((p) => (
                        <span key={p.id} className="cr-rail-pointer" title={p.detail}>@{p.id}</span>
                      ))}
                    </div>
                  )}
                  {(turn.files?.length ?? 0) > 0 && (
                    <div className="cr-rail-chiprow">
                      {turn.files!.map((f) => (
                        <span key={f.name} className="cr-rail-filechip" title={f.meta}>{f.name}</span>
                      ))}
                    </div>
                  )}
                  {textOf(turn)}
                </div>
              )
              : (
                <div className="cr-chat-response">
                  {turn.segments.map((seg, j) => {
                    if (seg.kind === 'thinking') return <Thinking key={j} text={seg.text ?? ''} />;
                    if (seg.kind === 'tool') return <ToolCard key={j} tool={seg.tool!} />;
                    return <Markdown key={j} text={seg.text ?? ''} />;
                  })}
                  {streaming && i === turns.length - 1 && <span className="cr-chat-cursor" />}
                </div>
              )}
          </div>
        ))}
      </div>

      <div className="cr-rail-composer">
        {menuOpen && (
          <div className="cr-rail-menu" data-testid="composer-menu">
            <span className="cr-rail-menu-title">{menu!.title}</span>
            {menu!.items.map((m, i) => (
              <button
                key={m.label}
                type="button"
                className="cr-rail-menu-item"
                data-testid={`menu-item-${i}`}
                onClick={() => insertToken(m.insert)}
              >
                <span className="cr-rail-menu-label">{m.label}</span>
                <span className="cr-rail-menu-args">{m.args}</span>
                <span className="cr-rail-menu-hint">{m.hint}</span>
              </button>
            ))}
          </div>
        )}

        {pointers.length > 0 && (
          <div className="cr-rail-chiprow">
            {pointers.map((p) => (
              <span key={p.id} className="cr-rail-pointer" title={p.detail} data-testid={`pointer-chip-${p.id}`}>
                @{p.id}
                <button type="button" className="cr-rail-chip-x" onClick={() => onRemovePointer(p.id)}>×</button>
              </span>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="cr-rail-chiprow">
            {files.map((f) => (
              <span key={f.name} className="cr-rail-filechip" title={f.meta}>
                {f.name}
                <button
                  type="button"
                  className="cr-rail-chip-x"
                  onClick={() => setFiles((fs) => fs.filter((x) => x.name !== f.name))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {fileProblem && <span className="cr-rail-fileproblem" data-testid="file-problem">{fileProblem}</span>}

        <div className="cr-rail-input" data-drag={dragOver || undefined}>
          <textarea
            className="cr-chat-textarea"
            data-testid="chat-input"
            placeholder={unavailable ? 'no model configured' : 'Describe the decision this board should support…'}
            value={input}
            disabled={!!unavailable}
            rows={3}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === 'Tab' || e.key === 'Enter') && menuOpen && !e.shiftKey) {
                e.preventDefault();
                insertToken(menu!.items[0].insert);
                return;
              }
              if (e.key === 'Escape' && menuOpen) { e.preventDefault(); setInput((t) => `${t} `); return; }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <div className="cr-rail-input-row">
            <button type="button" className="cr-rail-filebtn" title="Attach a file" onClick={() => fileRef.current?.click()}>
              + file
            </button>
            <input
              type="file"
              multiple
              ref={fileRef}
              style={{ display: 'none' }}
              onChange={(e) => { takeFiles(e.target.files); e.target.value = ''; }}
            />
            <span className="cr-rail-scope" data-testid="scope-chip" title="the agent reads this scope with every message">
              {scopeChip}
            </span>
            <span className="cr-header-spacer" />
            {streaming
              ? (
                <button type="button" className="cr-fix" data-testid="chat-stop" onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              )
              : (
                <button
                  type="button"
                  className="cr-save"
                  data-testid="chat-send"
                  disabled={!!unavailable || !input.trim()}
                  onClick={() => void send(input)}
                >
                  Send
                </button>
              )}
          </div>
        </div>
        <span className="cr-rail-hint">
          {dragOver
            ? 'Drop to attach — CSV, spec JSON, up to 32KB'
            : 'Enter sends · ⇧Enter newline · / commands · @ widgets and functions · # patterns'}
        </span>
      </div>
    </aside>
  );
}

/**
 * A reasoning segment — collapsed to its first line by default, dimmer and
 * italic, because it is pre-verbal: the reader skims it, the answer is below.
 */
function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.length > 74 ? `${text.slice(0, 74)}…` : text;
  return (
    <div className="cr-rail-think" data-testid="chat-thinking">
      <button type="button" className="cr-rail-think-head" onClick={() => setOpen(!open)}>
        <span className="cr-rail-think-label">thinking</span>
        <span className="cr-rail-think-text" data-open={open || undefined}>
          {open ? text : preview}
        </span>
      </button>
    </div>
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
