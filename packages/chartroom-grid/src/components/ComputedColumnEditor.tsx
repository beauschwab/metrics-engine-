/**
 * The calculated-column editor (ADR-79): a label, an operation from the
 * closed vocabulary, one or two registry measures, and for a scaling the
 * factor. The unit the column will read in is shown as the reader chooses,
 * and a pair the vocabulary refuses — two units that differ — is refused
 * here with the same words the parser uses, before a column exists.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { idsOf, measuresOf } from '../grid/schema';
import { useSchema } from './SchemaContext';
import {
  COMPUTED_ARITY, COMPUTED_OPS, COMPUTED_OP_LABELS, MAX_COMPUTED, computedIdFor, computedIssues, computedUnit, type ComputedColumn, type ComputedOp,
} from '../grid/computed';
import type { ColumnMeta } from '../grid/meta';
import { parseSearchNumber } from '../grid/search';
import { Button } from './ui/button';
import { Input } from './ui/input';

const SELECT = 'h-7 min-w-0 flex-1 rounded-sm border border-input bg-transparent px-1.5 text-xs text-foreground';

export function ComputedColumnEditor({
  existing, onAdd, onClose,
}: {
  existing: readonly ComputedColumn[];
  onAdd: (spec: ComputedColumn) => void;
  onClose: () => void;
}) {
  const schema = useSchema();
  const MEASURES = measuresOf(schema);
  const metaOf = (id: string): ColumnMeta | undefined => schema.columns[id];
  const [label, setLabel] = useState('');
  const [op, setOp] = useState<ComputedOp>('ratio');
  const [a, setA] = useState<string>(MEASURES[0] ?? '');
  const [b, setB] = useState<string>(MEASURES[1] ?? MEASURES[0] ?? '');
  const [kText, setKText] = useState('100');
  const arity = COMPUTED_ARITY[op];
  const k = parseSearchNumber(kText);
  const draft: ComputedColumn = { id: computedIdFor(label || 'calc'), label: label.trim(), op, of: arity === 2 ? [a, b] : [a], ...(op === 'scaled' ? { k } : {}) };
  const taken = existing.some((c) => c.id === draft.id);
  const issues = label.trim() ? computedIssues(draft, metaOf, idsOf(schema)) : ['give the column a name'];
  if (taken) issues.push(`a column named ${draft.id} already exists`);
  if (existing.length >= MAX_COMPUTED) issues.push(`${MAX_COMPUTED} calculated columns is the most; a ninth is a model`);
  const unit = metaOf(a) ? computedUnit(op, metaOf(a)!, arity === 2 ? metaOf(b) : undefined) : { error: 'the source has no measures' };

  return (
    <form
      className="flex flex-col gap-1.5"
      data-slot="computed-editor"
      onSubmit={(e) => { e.preventDefault(); if (issues.length === 0) { onAdd(draft); onClose(); } }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-[0.06em] uppercase text-faint">Add calculated column</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close calculated column editor" onClick={onClose} type="button"><X /></Button>
      </div>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. MTM share" aria-label="Calculated column name" className="h-7 text-xs" maxLength={40} />
      <select aria-label="Operation" className={SELECT} value={op} onChange={(e) => setOp(e.target.value as ComputedOp)}>
        {COMPUTED_OPS.map((o) => <option key={o} value={o}>{COMPUTED_OP_LABELS[o]}</option>)}
      </select>
      <div className="flex items-center gap-1">
        <span className="w-4 text-faint">A</span>
        <select aria-label="Operand A" className={SELECT} value={a} onChange={(e) => setA(e.target.value)}>
          {MEASURES.map((id) => <option key={id} value={id}>{schema.columns[id]!.label}</option>)}
        </select>
      </div>
      {arity === 2 ? (
        <div className="flex items-center gap-1">
          <span className="w-4 text-faint">B</span>
          <select aria-label="Operand B" className={SELECT} value={b} onChange={(e) => setB(e.target.value)}>
            {MEASURES.map((id) => <option key={id} value={id}>{schema.columns[id]!.label}</option>)}
          </select>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <span className="w-4 text-faint">k</span>
          <Input value={kText} onChange={(e) => setKText(e.target.value)} aria-label="Factor k" inputMode="decimal" className="h-7 text-xs" />
        </div>
      )}
      <div className="text-faint" data-slot="computed-preview">
        {'error' in unit ? unit.error : `reads in ${unit.unit ?? 'plain numbers'} · a draft, not a governed metric`}
      </div>
      {label.trim() && issues.length > 0 && <div className="text-breach-text" data-slot="computed-issues">{issues[0]}</div>}
      <div className="flex justify-end">
        <Button type="submit" size="xs" disabled={issues.length > 0}>Add column</Button>
      </div>
    </form>
  );
}
