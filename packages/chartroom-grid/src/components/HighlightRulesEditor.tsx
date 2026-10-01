/**
 * The highlight rules editor (ADR-78): the rules a column carries, one
 * line each, and a row to add one — a comparison, a number the search
 * grammar reads (`1bn`, `-2.5m`), and the emphasis it earns. Emphasis is
 * highlight, bold or fade; a colour that says good or bad is a governed
 * threshold's to say (COL-03), and this editor has no such option.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { formatValue, type ColumnMeta, type Emphasis, type HighlightRule, type RuleOp, EMPHASES, EMPHASIS_LABELS, MAX_RULES, RULE_OPS } from '../grid/meta';
import { parseSearchNumber } from '../grid/search';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function HighlightRulesEditor({
  label, meta, rules, onChange, onClose,
}: {
  label: string;
  meta: ColumnMeta;
  rules: HighlightRule[];
  onChange: (rules: HighlightRule[]) => void;
  onClose: () => void;
}) {
  const [op, setOp] = useState<RuleOp>('>');
  const [text, setText] = useState('');
  const [emphasis, setEmphasis] = useState<Emphasis>('accent');
  const value = parseSearchNumber(text);
  const full = rules.length >= MAX_RULES;
  const add = () => {
    if (value === undefined || full) return;
    onChange([...rules, { op, value, emphasis }]);
    setText('');
  };
  return (
    <div
      className="flex flex-col gap-1.5"
      // Escape in an open list closes the list, not the editor: its events bubble here through the portal.
      onKeyDown={(e) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('[data-slot="select-content"]')) onClose(); }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-[0.06em] uppercase text-faint">Highlight {label} where</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close highlight rules" onClick={onClose}><X /></Button>
      </div>
      {rules.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-slot="highlight-rule-list">
          {rules.map((r, i) => (
            <li key={i} className="flex h-6 items-center gap-2 px-1" data-slot="highlight-rule" data-emphasis={r.emphasis}>
              <span className="tabular-nums">{r.op} {formatValue(r.value, meta)}</span>
              <span className="flex-1 text-faint">{EMPHASIS_LABELS[r.emphasis]}</span>
              <button
                type="button"
                aria-label={`Remove rule ${i + 1}`}
                className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onChange(rules.filter((_, j) => j !== i))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => { e.preventDefault(); add(); }}
      >
        <Select value={op} onValueChange={(v) => setOp(v as RuleOp)}>
          <SelectTrigger aria-label="Comparison" className="w-12 tabular-nums"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RULE_OPS.map((o) => <SelectItem key={o} value={o} className="tabular-nums">{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="1bn"
          aria-label={`${label} threshold`}
          inputMode="decimal"
          className="h-7 w-20 text-xs"
        />
        <Select value={emphasis} onValueChange={(v) => setEmphasis(v as Emphasis)}>
          <SelectTrigger aria-label="Emphasis" className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            {EMPHASES.map((em) => <SelectItem key={em} value={em}>{EMPHASIS_LABELS[em]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="submit" size="xs" disabled={value === undefined || full}>Add</Button>
      </form>
      <div className="flex items-center justify-between text-faint">
        <span>{full ? `${MAX_RULES} rules is the most; a threshold belongs in the registry` : 'first matching rule wins'}</span>
        {rules.length > 0 && <Button variant="ghost" size="xs" onClick={() => onChange([])}>Clear rules</Button>}
      </div>
    </div>
  );
}
