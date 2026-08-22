/**
 * The definition agent, as a left rail on the authoring surface (ADR-56).
 *
 * The shape is ADR-55's design agent rail with the registry's vocabulary in
 * every slot: the phase spine is the authoring journey (intake → draft →
 * prove → hand over), `/` completes the propose-and-prove commands, `@`
 * completes documents and measures that actually exist in the workspace, and
 * a pointer is a *diagnostic* — the strip's `✳ ask` turns "why is this
 * failing" into a resolved reference carrying the code, the line and the
 * message. The transport is the same frozen SSE contract (ADR-37), read by
 * the same parser, degrading to the same honest banner (ADR-35).
 *
 * What deliberately is not here: a save button. The agent's half of the seam
 * ends at a proven document body in a code block; the copy button on that
 * block is the hand-over, and the save happens in the editor under the
 * author's own name, where the same diagnostics hold them too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface RailPointer {
  id: string;
  /** `{code} · line {n} · {message}` — the tooltip, and the agent's context. */
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
  pointers?: RailPointer[];
  files?: Array<{ name: string; meta: string }>;
}

export type RailPhase = 'intake' | 'draft' | 'prove' | 'handover';

const PHASES: Array<{ id: RailPhase; label: string; hint: string }> = [
  { id: 'intake', label: 'Intake', hint: 'what the definition must decide, and what breaks' },
  { id: 'draft', label: 'Draft', hint: 'the full document body, composed against what exists' },
  { id: 'prove', label: 'Prove', hint: 'validate, test_rules, preview, assess_change' },
  { id: 'handover', label: 'Hand over', hint: 'you save it in the editor, under your name' },
];

const SLASH: Array<{ cmd: string; args: string; hint: string; phase: RailPhase }> = [
  { cmd: '/draft', args: '<change>', hint: 'write the full document body for a change', phase: 'draft' },
  { cmd: '/test', args: '[@doc]', hint: 'run the rules over the test book', phase: 'prove' },
  { cmd: '/assess', args: '[@doc]', hint: 'what a proposed change would do', phase: 'prove' },
  { cmd: '/preview', args: '[@report]', hint: 'the rows a report would file', phase: 'prove' },
  { cmd: '/lineage', args: '[@doc]', hint: 'what feeds this, and what breaks', phase: 'intake' },
  { cmd: '/history', args: '[@doc]', hint: 'who tuned this document, and why', phase: 'intake' },
];

const STARTERS: Array<{ label: string; text: string }> = [
  { label: 'what breaks first', text: '/lineage' },
  { label: 'prove the open rules', text: '/test' },
  { label: 'draft a change', text: '/draft tighten the maturity bucket boundaries and show what moves' },
  { label: 'who touched this', text: '/history' },
];

/**
 * Where in the journey the last message points. Presentation only — the spine
 * orients, it gates nothing; the save stays in the editor where a person does
 * it (ADR-56).
 */
export function railPhaseOf(msg: string): RailPhase {
  const m = msg.trim().toLowerCase();
  const hit = SLASH.find((s) => m.startsWith(s.cmd));
  if (hit) return hit.phase;
  if (/\bdraft\b|write|compose|tighten|loosen|add a rule/.test(m)) return 'draft';
  if (/test|assess|preview|validate|prove|coverage|check/.test(m)) return 'prove';
  if (/save|hand|final|ready/.test(m)) return 'handover';
  return 'intake';
}

/** Files the composer will inline. Anything else is refused with the reason. */
const INLINE_LIMIT = 32_768;
const TEXTY = /\.(csv|json|txt|md|ya?ml|sql)$/i;

const textOf = (t: Turn): string =>
  t.segments.filter((s) => s.kind === 'text').map((s) => s.text ?? '').join('');

export function DefinitionRail({
  file, kind, fixture, active, online, documents, measures,
  pointers, onRemovePointer, onClearPointers, onClose,
}: {
  /** The open document, its kind, and the measure the cursor is on. */
  file: string;
  kind: string;
  fixture: string;
  active: string;
  online: boolean;
  documents: Array<{ name: string; kind: string }>;
  measures: string[];
  pointers: RailPointer[];
  onRemovePointer(id: string): void;
  onClearPointers(): void;
  onClose(): void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [phase, setPhase] = useState<RailPhase>('intake');
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
   * and the diagnostics it names — resolved references, not prose the model
   * has to guess at. The transcript shows the typed text; the context block
   * travels only on the wire.
   */
  const wireText = (message: string): string => {
    const lines: string[] = [
      `[viewing] document: ${file} · kind: ${kind} · test data: ${fixture} · measure: ${active}`,
    ];
    pointers.forEach((p) => lines.push(`[pointer] ${p.id} — ${p.detail}`));
    files.forEach((f) => lines.push(`[attached ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``));
    return `${message}\n\n${lines.join('\n')}`;
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput('');
    setUnavailable(null);
    setFileProblem(null);
    setPhase(railPhaseOf(message));

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
          document_id: file,
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
        const kindOf = e.type as 'text' | 'thinking';
        patchLast((t) => {
          const last = t.segments[t.segments.length - 1];
          if (last?.kind === kindOf) {
            return {
              ...t,
              segments: [...t.segments.slice(0, -1), { kind: kindOf, text: (last.text ?? '') + String(e.delta) }],
            };
          }
          return { ...t, segments: [...t.segments, { kind: kindOf, text: String(e.delta) }] };
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
      const docs = documents.map((d) => ({
        label: `@${d.name}`, args: d.kind, hint: `${d.name}.yaml`, insert: `@${d.name} `,
      }));
      const ms = measures.map((m) => ({
        label: `@${m}`, args: 'measure', hint: `in ${file}`, insert: `@${m} `,
      }));
      return {
        title: 'Documents and measures',
        items: [...docs, ...ms]
          .filter((i) => i.label.slice(1).toLowerCase().startsWith(q))
          .slice(0, 7),
      };
    }
    return null;
  }, [input, documents, measures, file]);

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

  const scopeChip = `${file} · ${fixture} · ${online ? 'registry' : 'local only'}`;
  const empty = turns.length === 0 && !unavailable;

  return (
    <aside
      className="mdl-rail"
      data-testid="chat-pane"
      data-drag={dragOver || undefined}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFiles(e.dataTransfer.files); }}
    >
      <header className="mdl-rail-head">
        <div className="mdl-rail-head-row">
          <span className="mdl-rail-dot" />
          <span className="mdl-rail-title">Definition agent</span>
          {threadId && (
            <span className="mdl-rail-session" data-testid="session-label">{threadId.slice(0, 12)}</span>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="mdl-rail-headlink"
            data-testid="chat-new"
            onClick={() => { setTurns([]); setThreadId(null); setPhase('intake'); setUnavailable(null); }}
          >
            new
          </button>
          <button type="button" className="mdl-rail-headlink" data-testid="chat-close" onClick={onClose}>
            hide
          </button>
        </div>
        <div className="mdl-rail-phases" data-testid="rail-phases">
          {PHASES.map((p, i) => {
            const at = PHASES.findIndex((x) => x.id === phase);
            const state = p.id === phase ? 'active' : i < at ? 'done' : 'ahead';
            return (
              <span key={p.id} className="mdl-rail-phase" data-state={state} data-testid={`phase-${p.id}`} title={p.hint}>
                {p.label}
              </span>
            );
          })}
        </div>
      </header>

      {unavailable && (
        <div className="mdl-rail-unavailable" data-testid="chat-unavailable">{unavailable}</div>
      )}

      <div className="mdl-rail-thread mdl-scroll" ref={scrollRef} data-testid="chat-conversation">
        {empty && (
          <div className="mdl-rail-empty" data-testid="chat-suggestions">
            <h2 className="mdl-rail-empty-head">What should this definition decide?</h2>
            <p className="mdl-rail-hint-p">
              I read the lineage, draft rule sets against the citations, and prove
              every change with the test book before you see it. The save stays
              yours — it happens in the editor, under your name.
            </p>
            {STARTERS.map((s) => (
              <button key={s.label} type="button" className="mdl-rail-starter" onClick={() => void send(s.text)}>
                <span className="mdl-rail-starter-eyebrow">{s.label}</span>
                <span className="mdl-rail-starter-text">{s.text}</span>
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="mdl-rail-message" data-role={turn.role}>
            {turn.role === 'user'
              ? (
                <div className="mdl-rail-user">
                  {(turn.pointers?.length ?? 0) > 0 && (
                    <div className="mdl-rail-chiprow">
                      {turn.pointers!.map((p) => (
                        <span key={p.id} className="mdl-rail-pointer" title={p.detail}>{p.id}</span>
                      ))}
                    </div>
                  )}
                  {(turn.files?.length ?? 0) > 0 && (
                    <div className="mdl-rail-chiprow">
                      {turn.files!.map((f) => (
                        <span key={f.name} className="mdl-rail-filechip" title={f.meta}>{f.name}</span>
                      ))}
                    </div>
                  )}
                  {textOf(turn)}
                </div>
              )
              : (
                <div className="mdl-rail-response">
                  {turn.segments.map((seg, j) => {
                    if (seg.kind === 'thinking') return <Thinking key={j} text={seg.text ?? ''} />;
                    if (seg.kind === 'tool') return <ToolCard key={j} tool={seg.tool!} />;
                    return <Fenced key={j} text={seg.text ?? ''} />;
                  })}
                  {streaming && i === turns.length - 1 && <span className="mdl-rail-cursor" />}
                </div>
              )}
          </div>
        ))}
      </div>

      <div className="mdl-rail-composer">
        {menuOpen && (
          <div className="mdl-rail-menu" data-testid="composer-menu">
            <span className="mdl-rail-menu-title">{menu!.title}</span>
            {menu!.items.map((m, i) => (
              <button
                key={m.label}
                type="button"
                className="mdl-rail-menu-item"
                data-testid={`menu-item-${i}`}
                onClick={() => insertToken(m.insert)}
              >
                <span className="mdl-rail-menu-label">{m.label}</span>
                <span className="mdl-rail-menu-args">{m.args}</span>
                <span className="mdl-rail-menu-hint">{m.hint}</span>
              </button>
            ))}
          </div>
        )}

        {pointers.length > 0 && (
          <div className="mdl-rail-chiprow">
            {pointers.map((p) => (
              <span key={p.id} className="mdl-rail-pointer" title={p.detail} data-testid={`pointer-chip-${p.id}`}>
                {p.id}
                <button type="button" className="mdl-rail-chip-x" onClick={() => onRemovePointer(p.id)}>×</button>
              </span>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="mdl-rail-chiprow">
            {files.map((f) => (
              <span key={f.name} className="mdl-rail-filechip" title={f.meta}>
                {f.name}
                <button
                  type="button"
                  className="mdl-rail-chip-x"
                  onClick={() => setFiles((fs) => fs.filter((x) => x.name !== f.name))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {fileProblem && <span className="mdl-rail-fileproblem" data-testid="file-problem">{fileProblem}</span>}

        <div className="mdl-rail-input" data-drag={dragOver || undefined}>
          <textarea
            className="mdl-rail-textarea"
            data-testid="chat-input"
            placeholder={unavailable ? 'no model configured' : 'Describe the change this definition needs…'}
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
          <div className="mdl-rail-input-row">
            <button type="button" className="mdl-rail-filebtn" title="Attach a file" onClick={() => fileRef.current?.click()}>
              + file
            </button>
            <input
              type="file"
              multiple
              ref={fileRef}
              style={{ display: 'none' }}
              onChange={(e) => { takeFiles(e.target.files); e.target.value = ''; }}
            />
            <span className="mdl-rail-scope" data-testid="scope-chip" title="the agent reads this scope with every message">
              {scopeChip}
            </span>
            <span style={{ flex: 1 }} />
            {streaming
              ? (
                <button type="button" className="mdl-fix" data-testid="chat-stop" onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              )
              : (
                <button
                  type="button"
                  className="mdl-rail-send"
                  data-testid="chat-send"
                  disabled={!!unavailable || !input.trim()}
                  onClick={() => void send(input)}
                >
                  Send
                </button>
              )}
          </div>
        </div>
        <span className="mdl-rail-foothint">
          {dragOver
            ? 'Drop to attach — CSV, YAML, up to 32KB'
            : 'Enter sends · ⇧Enter newline · / commands · @ documents and measures'}
        </span>
      </div>
    </aside>
  );
}

/**
 * Assistant text with fenced code blocks made real.
 *
 * The hand-over moment is a full document body in a ```yaml fence; rendering
 * it as a block with a copy button *is* the seam — the agent presents, the
 * human carries it into the editor and saves under their own name. Everything
 * outside a fence renders as plain pre-wrapped text: honest, and no markdown
 * engine to disagree with the model about.
 */
function Fenced({ text }: { text: string }) {
  const parts = text.split(/```(\w*)\n?/);
  // split() yields [prose, lang, code, prose, lang, code, …]
  const out: Array<{ code: boolean; lang?: string; body: string }> = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 3 === 0) {
      if (parts[i]) out.push({ code: false, body: parts[i] });
    } else if (i % 3 === 1) {
      out.push({ code: true, lang: parts[i] || 'text', body: parts[i + 1] ?? '' });
      i += 1;
    }
  }
  return (
    <>
      {out.map((p, i) =>
        p.code
          ? <CodeBlock key={i} lang={p.lang!} body={p.body} />
          : <div key={i} className="mdl-rail-prose">{p.body}</div>)}
    </>
  );
}

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mdl-rail-code" data-testid="rail-code">
      <div className="mdl-rail-code-head">
        <span className="mdl-rail-code-lang">{lang}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="mdl-rail-headlink"
          data-testid="rail-copy"
          onClick={() => {
            navigator.clipboard?.writeText(body).catch(() => {});
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre>{body}</pre>
    </div>
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
    <div className="mdl-rail-think" data-testid="chat-thinking">
      <button type="button" className="mdl-rail-think-head" onClick={() => setOpen(!open)}>
        <span className="mdl-rail-think-label">thinking</span>
        <span className="mdl-rail-think-text" data-open={open || undefined}>
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
    <div className="mdl-rail-tool" data-state={state} data-testid={`chat-tool-${tool.name}`}>
      <button type="button" className="mdl-rail-tool-head" onClick={() => setOpen(!open)}>
        <span className="mdl-rail-tool-dot" />
        <span className="mdl-rail-tool-name">{tool.name}</span>
        <span className="mdl-rail-tool-state">
          {state === 'running' ? 'running…' : state === 'error' ? 'refused' : 'done'}
        </span>
      </button>
      {open && (
        <div className="mdl-rail-tool-body">
          <div className="mdl-rail-tool-label">input</div>
          <pre className="mdl-rail-pre">{JSON.stringify(tool.input, null, 1)}</pre>
          {tool.error && (
            <>
              <div className="mdl-rail-tool-label">refusal</div>
              <pre className="mdl-rail-pre" data-error>{tool.error}</pre>
            </>
          )}
          {tool.ok && (
            <>
              <div className="mdl-rail-tool-label">result</div>
              <pre className="mdl-rail-pre">{clip(JSON.stringify(tool.result, null, 1))}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const clip = (s: string) => (s.length > 4000 ? `${s.slice(0, 4000)} …` : s);
