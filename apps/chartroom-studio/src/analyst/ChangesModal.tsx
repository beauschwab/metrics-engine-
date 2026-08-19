/**
 * "Changes" — what the draft has done since the version on record.
 *
 * The prototype flattens both specs to dotted paths and diffs the strings.
 * This uses `diffSpecs`, which the platform already has and which the API
 * already serves from `/diff`: it reports a rebinding as a rebinding and a
 * pin bump as a pin bump, in the vocabulary review reads. A path-level diff
 * would report `widgets.3.bind.metric` changing and leave the reader to work
 * out that a widget was repointed at an ungoverned measure.
 */

import { diffSpecs, type DashboardSpec } from 'chartroom-spec';
import { useEffect } from 'react';

export interface ChangesModalProps {
  spec: DashboardSpec;
  saved: DashboardSpec | null;
  version: number;
  canUndo: boolean;
  saveDisabled: boolean;
  onUndo(): void;
  onSave(): void;
  onClose(): void;
}

/** One line per change class, skipping the classes with nothing in them. */
function lines(diff: ReturnType<typeof diffSpecs>): Array<{ kind: string; detail: string }> {
  const out: Array<{ kind: string; detail: string }> = [];
  const list = (kind: string, ids: string[]) => {
    if (ids.length) out.push({ kind, detail: ids.join(', ') });
  };
  list('added', diff.added);
  list('removed', diff.removed);
  list('moved', diff.moved);
  list('resized', diff.resized);
  list('retitled', diff.retitled);
  list('reformatted', diff.reformatted);
  list('annotated', diff.annotated);
  list('context changed', diff.contextChanged);
  list('dashboard changed', diff.dashboardChanged);
  for (const r of diff.rebound) out.push({ kind: 'rebound', detail: `${r.id}: ${r.from} → ${r.to}` });
  for (const v of diff.versionBumped) {
    out.push({ kind: 'pin bumped', detail: `${v.id}: ${v.metric} @${v.from} → @${v.to}` });
  }
  return out;
}

export function ChangesModal({
  spec, saved, version, canUndo, saveDisabled, onUndo, onSave, onClose,
}: ChangesModalProps) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [onClose]);

  const rows = saved ? lines(diffSpecs(saved, spec)) : [];

  return (
    <div className="cr-modal-scrim" data-testid="changes-modal" onClick={onClose}>
      <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
        <header className="cr-modal-head">
          <span className="cr-modal-title">
            {version ? `Changes against v${version}` : 'Changes against the unsaved board'}
          </span>
          <span className="cr-modal-count" data-testid="changes-count">
            {rows.length} change{rows.length === 1 ? '' : 's'}
          </span>
          <span className="cr-context-spacer" />
          <button type="button" className="cr-drawer-close" data-testid="changes-close" onClick={onClose}>
            close · esc
          </button>
        </header>

        <div className="cr-modal-body">
          {!saved && (
            <p className="cr-hint">
              This board has no saved version yet, so there is nothing to compare against.
            </p>
          )}
          {saved && rows.length === 0 && (
            <p className="cr-hint" data-testid="changes-empty">
              Nothing has changed since the saved version.
            </p>
          )}
          {rows.map((r) => (
            <div className="cr-change-row" key={`${r.kind}:${r.detail}`}>
              <span className="cr-change-kind">{r.kind}</span>
              <span className="cr-change-detail">{r.detail}</span>
            </div>
          ))}
        </div>

        <footer className="cr-modal-foot">
          <span className="cr-hint">
            Saving writes a new version; the lint report is recomputed against it.
          </span>
          <span className="cr-context-spacer" />
          {canUndo && (
            <button type="button" className="cr-fix" data-testid="changes-undo" onClick={onUndo}>
              Undo last edit
            </button>
          )}
          <button
            type="button"
            className="cr-save"
            data-testid="changes-save"
            disabled={saveDisabled}
            onClick={onSave}
          >
            Save version
          </button>
        </footer>
      </div>
    </div>
  );
}
