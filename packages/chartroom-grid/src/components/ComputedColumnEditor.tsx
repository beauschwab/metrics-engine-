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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

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
      // Escape in an open list closes the list, not the editor: its events bubble here through the portal.
      onKeyDown={(e) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('[data-slot="select-content"]')) onClose(); }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-[0.06em] uppercase text-faint">Add calculated column</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close calculated column editor" onClick={onClose} type="button"><X /></Button>
      </div>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. MTM share" aria-label="Calculated column name" className="h-7 text-xs" maxLength={40} />
      <Select value={op} onValueChange={(v) => setOp(v as ComputedOp)}>
        <SelectTrigger aria-label="Operation" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {COMPUTED_OPS.map((o) => <SelectItem key={o} value={o}>{COMPUTED_OP_LABELS[o]}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        <span className="w-4 text-faint">A</span>
        <Select value={a} onValueChange={setA}>
          <SelectTrigger aria-label="Operand A" className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MEASURES.map((id) => <SelectItem key={id} value={id}>{schema.columns[id]!.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {arity === 2 ? (
        <div className="flex items-center gap-1">
          <span className="w-4 text-faint">B</span>
          <Select value={b} onValueChange={setB}>
            <SelectTrigger aria-label="Operand B" className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MEASURES.map((id) => <SelectItem key={id} value={id}>{schema.columns[id]!.label}</SelectItem>)}
            </SelectContent>
          </Select>
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
