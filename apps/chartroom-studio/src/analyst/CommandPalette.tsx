/**
 * ⌘K — every navigation and scope change the surface offers, as one list.
 *
 * The palette is built from live state rather than a static menu: the boards
 * are the boards the workspace actually has, and the dates are the dates the
 * engine can actually evaluate. It is the only place in the surface where
 * "open that board at last month-end" is one gesture instead of three.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  label: string;
  hint: string;
  run(): void;
}

export interface CommandPaletteProps {
  commands: Command[];
  onClose(): void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands
      .filter((c) => !q || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q))
      .slice(0, 9);
  }, [commands, query]);

  // A filtered list is a shorter list; keeping a stale cursor would run the
  // wrong command on Enter.
  useEffect(() => { setCursor(0); }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, matches.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = matches[cursor];
      if (hit) { hit.run(); onClose(); }
    }
  };

  return (
    <div className="cr-modal-scrim cr-palette-scrim" data-testid="command-palette" onClick={onClose}>
      <div className="cr-palette" onClick={(e) => e.stopPropagation()}>
        <div className="cr-palette-input">
          <input
            ref={input}
            className="cr-input"
            data-testid="palette-query"
            placeholder="Jump to a board, a date, a scope, an action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div className="cr-palette-list">
          {matches.length === 0 && <p className="cr-hint cr-palette-empty">nothing matches</p>}
          {matches.map((c, i) => (
            <button
              type="button"
              className="cr-palette-item"
              key={c.label}
              data-active={i === cursor || undefined}
              data-testid={`palette-item-${i}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => { c.run(); onClose(); }}
            >
              <span className="cr-palette-label">{c.label}</span>
              <span className="cr-palette-hint">{c.hint}</span>
            </button>
          ))}
        </div>
        <div className="cr-palette-foot">
          <span>↑↓ to move · enter runs the selection</span>
          <span>e exceptions · r read/author · l findings · a agent · d changes · ⌘S save · ⌘Z undo</span>
        </div>
      </div>
    </div>
  );
}
