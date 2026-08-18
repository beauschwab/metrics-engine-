/**
 * Form mode — one measure, as controls.
 *
 * The point is not that YAML is hard. It is that a rule set filed with a
 * regulator is written by people who understand liquidity and read by people
 * who understand liquidity, and requiring both to also be fluent in a
 * serialisation format puts a translator between the expert and the artifact.
 * Every translation step is a place a rule can come out meaning something
 * slightly different from what was intended.
 *
 * So the card is prose-and-controls rather than a dense data form: a sentence
 * at the top restating the rule in English with its current value, then three
 * numbered sections. Labels are sentence case, not uppercase eyebrows, because
 * this surface is meant to read.
 *
 * Everything writes back into the same document the YAML editor shows. There is
 * no draft, no local model, no save button — the only exception is the name
 * field, and the comment there says why.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Diagnostic, Fix } from 'keel-engine/diagnostics';
import type { Evaluator } from 'keel-engine/evaluate';
import { fmt } from 'keel-engine/format';
import {
  COMPARISONS, KINDS, KIND_CHOICE, KIND_LABEL, PALETTE, appendToFormula, blockEndOf,
  filterRows, formulaTokens, kindOf, observedValues, renameMeasure, requiresOf,
  routeDiagnostics, sentenceFor, setExpression, setField, setRequires, tokenClass,
  tokenText, writeFormula, writeWhere, type ConditionRow,
} from 'keel-engine/form';
import type { Graph } from 'keel-engine/parse';
import { COLUMNS, ENUM_HELP, WINDOW_HELP, type FixtureName } from 'keel-engine/vocab';
import { Chip, DropZone, Field, Note, PaletteRow, Picker, TextBox } from './controls';

interface Props {
  graph: Graph;
  /** Offered when this kind of document has no form — see the empty state. */
  onUseYaml(): void;
  lines: string[];
  evaluator: Evaluator;
  diagnostics: Diagnostic[];
  fixture: FixtureName;
  /** The measure the card is showing — driven by the registry rail. */
  active: string;
  onDoc(next: string): void;
  onPickMeasure(name: string): void;
  onFix(fix: Fix, diagnostic: Diagnostic): void;
}

const AGGREGATES = ['sum', 'avg', 'last', 'first', 'max', 'min', 'count'];
const FORMATS = ['currency_usd', 'currency_usd_mm', 'number', 'percent_1dp', 'percent_2dp', 'bps'];
const TIERS = ['', '1', '2', '3'];
const WINDOW_OPS = ['delta', 'pct_change', 'stddev', 'variance', 'avg', 'sum', 'min', 'max'];
const WINDOWS = ['1d', '7d', '30d', '90d'];

const SECTIONS = [
  { index: '01', title: 'What it is', blurb: 'How this measure is named and explained.' },
  { index: '02', title: 'How it is calculated', blurb: 'The rule itself. Everything here changes the number.' },
  { index: '03', title: 'Shown and governed', blurb: 'Presentation, and how much scrutiny this carries.' },
];

const choices = (values: string[], help: Record<string, string> = ENUM_HELP) =>
  values.map((v) => ({ value: v, hint: help[v] }));

const dragPayload = (e: React.DragEvent, kind: string, name: string) => {
  e.dataTransfer.setData('application/x-mdl', `${kind}:${name}`);
  e.dataTransfer.setData('text/plain', name);
  e.dataTransfer.effectAllowed = 'copy';
};

/**
 * What each kind of document holds, for the kinds the form does not edit.
 *
 * Form mode was built for measures, and it is the *default* mode — so opening a
 * rule set lands on an empty card. Saying "no measures" and stopping is a dead
 * end: the reader is left to work out both what this document is and what to do
 * about it. Naming the contents and offering the door is the whole fix.
 */
const NO_FORM_YET: Record<string, string> = {
  classification: 'an ordered rule set — conditions tried in order, first match wins',
  parameter_set: 'a governed rate table — keys, values, and the citation behind each',
  report: 'a grain and a destination — what gets filed, and where',
  variance_monitor: 'thresholds that judge each day-over-day move',
  source_binding: 'a client system\u2019s column names and codes, mapped to the canonical source',
};

export function FormMode({
  graph, lines, evaluator, diagnostics, fixture, active, onDoc, onPickMeasure, onFix, onUseYaml,
}: Props) {
  /**
   * The name is the one field with a draft.
   *
   * Committing per keystroke would rewrite the document on every character,
   * re-resolve every dependent, and flash "unknown name" for `lcr_p`, `lcr_pc`,
   * `lcr_pct`… A rename is also a transaction across other measures; running it
   * seven times for one edit is both slow and wrong.
   */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  useEffect(() => setNameDraft(null), [active]);

  const index = graph.measures.findIndex((x) => x.name === active);
  const m = index >= 0 ? graph.measures[index] : graph.measures[0];

  const routed = useMemo(
    () => (m ? routeDiagnostics(diagnostics, m, blockEndOf(graph, Math.max(index, 0))) : null),
    [diagnostics, graph, m, index],
  );

  if (!m || !routed) {
    const holds = NO_FORM_YET[graph.kind];
    return (
      <div className="mdl-form" data-testid="mdl-form">
        <div className="mdl-form-empty" data-testid="mdl-form-no-form">
          <p className="mdl-form-empty-lead">
            {holds
              ? `This document holds ${holds}.`
              : 'This document holds nothing the form can edit.'}
          </p>
          {/* The form covers measures. Rather than leave the reader to discover
              that, say it and open the door — the other mode edits the same
              document, so nothing is lost by switching. */}
          <p className="mdl-form-empty-note">
            The form edits measures. Everything else is edited as YAML, on the
            same document — switch and back at any time.
          </p>
          <button type="button" className="mdl-fix" onClick={onUseYaml}>
            Edit as YAML
          </button>
        </div>
      </div>
    );
  }

  const kind = kindOf(m);
  const notes = (field: string) => routed.byField[field] || [];
  const write = (next: string[]) => onDoc(next.join('\n'));
  const set = (key: string, value: string | null) => write(setField(lines, m.name, key, value));

  const source = (graph.view.source || '').trim();
  const columns = COLUMNS[source] || [];
  const value = evaluator.value(m.name);
  const reqs = requiresOf(m);
  const others = graph.measures.filter((x) => x.name !== m.name).map((x) => x.name);

  // ---- the filter ---------------------------------------------------------

  const filter = filterRows(m.f.where || '');
  const writeRows = (rows: ConditionRow[]) => set('where', writeWhere(rows));

  // ---- the formula --------------------------------------------------------

  const tokens = formulaTokens(m.f.expression || '');
  const known = (n: string) => n in graph.byName;
  const setTokens = (next: string[]) =>
    write(setExpression(lines, m.name, writeFormula(next)));

  return (
    <div className="mdl-form" data-testid="mdl-form">
      <div className="mdl-form-card">
        {/* --- header ----------------------------------------------------- */}
        <header className="mdl-form-head">
          <div className="mdl-form-title">
            <span className="mdl-form-name mono">⟨{m.name}⟩</span>
            <span className="mdl-form-badge">{KIND_LABEL[kind]}</span>
            <span style={{ flex: 1 }} />
            {/* Clean is worth saying. A card with nothing under it reads as
                "not checked yet" unless it says otherwise. */}
            {!diagnostics.some((d) => d.line >= m.line && d.line < blockEndOf(graph, index)) ? (
              <span className="mdl-form-clean">✓ Nothing to fix</span>
            ) : null}
          </div>
          {/* The rule in English, rewritten on every edit. An author who reads
              "across every row" and expected a filter has just found their own
              mistake without running anything. */}
          <p className="mdl-form-sentence" data-testid="mdl-form-sentence">
            {sentenceFor(m, value.v, (m.f.format || '').trim())}
          </p>
        </header>

        {/* --- 01 what it is ---------------------------------------------- */}
        <Section {...SECTIONS[0]}>
          <Field
            label="Name"
            hint="lowercase, with underscores · renaming updates every reference"
            notes={notes('name')}
            onFix={onFix}
          >
            <TextBox
              ariaLabel="Name"
              mono
              value={nameDraft ?? m.name}
              invalid={notes('name').some((n) => n.sev === 'error')}
              onChange={setNameDraft}
              onRevert={() => setNameDraft(null)}
              onCommit={() => {
                const next = (nameDraft ?? '').trim();
                setNameDraft(null);
                if (!next || next === m.name) return;
                // One transaction: the name line and every reference to it.
                write(renameMeasure(lines, m.name, next));
                onPickMeasure(next);
              }}
            />
          </Field>

          <Field label="Display name" hint="what people see on a report" notes={notes('label')}>
            <TextBox
              ariaLabel="Display name"
              value={m.f.label || ''}
              onChange={(v) => set('label', v.trim() || null)}
            />
          </Field>

          <Field
            label="Description"
            hint="required once this is under oversight"
            notes={notes('description')}
            onFix={onFix}
          >
            <TextBox
              ariaLabel="Description"
              value={m.f.description || ''}
              invalid={notes('description').some((n) => n.sev === 'error')}
              onChange={(v) => set('description', v.trim() || null)}
            />
          </Field>
        </Section>

        {/* --- 02 how it is calculated ------------------------------------ */}
        <Section {...SECTIONS[1]}>
          <Field label="What kind of measure" hint="this decides which options appear below">
            <div className="mdl-kinds">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="mdl-kind"
                  data-selected={k === kind}
                  aria-pressed={k === kind}
                  onClick={() => set('type', k)}
                >
                  <span className="mdl-kind-title">{KIND_CHOICE[k].title}</span>
                  <span className="mdl-kind-help">{KIND_CHOICE[k].help}</span>
                </button>
              ))}
            </div>
          </Field>

          {kind === 'simple' ? (
            <SimpleFields
              m={m}
              columns={columns}
              source={source}
              fixture={fixture}
              filter={filter}
              notes={notes}
              onFix={onFix}
              set={set}
              writeRows={writeRows}
            />
          ) : null}

          {kind === 'windowed' ? (
            <>
              <Field
                label="Measure to look across"
                hint="drag a measure in"
                notes={notes('requires')}
                onFix={onFix}
              >
                <DropZone
                  accepts="measure"
                  placeholder="Drop a measure here"
                  chip={reqs[0] ? <Chip text={`⟨${reqs[0]}⟩`} kind="measure" /> : null}
                  onDrop={(name) => write(setRequires(lines, m.name, [name]))}
                />
                <Picker
                  ariaLabel="Measure to look across"
                  value={reqs[0] || ''}
                  choices={choices(others, {})}
                  onChange={(v) => write(setRequires(lines, m.name, v ? [v] : []))}
                />
              </Field>

              <Field label="Calculation" notes={notes('window.op')} onFix={onFix}>
                <Picker
                  ariaLabel="Calculation"
                  value={(m.f['window.op'] || '').trim()}
                  choices={choices(WINDOW_OPS, WINDOW_HELP)}
                  invalid={notes('window.op').some((n) => n.sev === 'error')}
                  onChange={(v) => set('window.op', v || null)}
                />
              </Field>

              <Field label="How far back" notes={notes('window.over')} onFix={onFix}>
                <Picker
                  ariaLabel="How far back"
                  value={(m.f['window.over'] || '').trim()}
                  choices={choices(WINDOWS)}
                  invalid={notes('window.over').some((n) => n.sev === 'error')}
                  onChange={(v) => set('window.over', v || null)}
                />
              </Field>
            </>
          ) : null}

          {kind === 'derived' ? (
            <>
              <Field
                label="Formula"
                hint="drag pieces in from below · click a piece to remove it"
                notes={notes('expression')}
                onFix={onFix}
              >
                <div
                  className="mdl-formula"
                  data-testid="mdl-formula"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const [dropKind, name] = (
                      e.dataTransfer.getData('application/x-mdl') || ''
                    ).split(':');
                    if (!name) return;
                    // Dropping a measure also adds it to `requires`, in one
                    // edit — so "used in the formula but missing from its
                    // dependency list" cannot be built here.
                    write(appendToFormula(lines, m.name, name, dropKind === 'measure'));
                  }}
                >
                  {tokens.length ? (
                    tokens.map((t, i) => (
                      <Chip
                        key={`${t}-${i}`}
                        text={tokenText(t, known)}
                        kind={tokenClass(t, known)}
                        title="Click to remove"
                        onClick={() => setTokens(tokens.filter((_, j) => j !== i))}
                      />
                    ))
                  ) : (
                    <span className="mdl-drop-hint">
                      Drag measures and operators here to build the formula
                    </span>
                  )}
                </div>

                <div className="mdl-palette">
                  {PALETTE.map((row) => (
                    <PaletteRow key={row.label} label={row.label}>
                      {row.items.map((item) => (
                        <Chip
                          key={item}
                          text={tokenText(item, known)}
                          kind={tokenClass(item, known)}
                          onClick={() => setTokens([...tokens, item])}
                          onDragStart={(e) => dragPayload(e, 'token', item)}
                        />
                      ))}
                    </PaletteRow>
                  ))}
                </div>
              </Field>

              <Field
                label="Measures used"
                hint="kept in step with the formula"
                notes={notes('requires')}
                onFix={onFix}
              >
                <div className="mdl-chips">
                  {reqs.length ? (
                    reqs.map((r) => (
                      <Chip
                        key={r}
                        text={`⟨${r}⟩ ✕`}
                        kind="measure"
                        title={`Remove ${r}`}
                        onClick={() =>
                          write(setRequires(lines, m.name, reqs.filter((x) => x !== r)))}
                      />
                    ))
                  ) : (
                    <span className="mdl-drop-hint">None yet</span>
                  )}
                </div>
              </Field>
            </>
          ) : null}
        </Section>

        {/* --- 03 shown and governed -------------------------------------- */}
        <Section {...SECTIONS[2]}>
          <Field
            label="How the number is shown"
            hint="previewed with this measure’s own value"
            notes={notes('format')}
            onFix={onFix}
          >
            <Picker
              ariaLabel="How the number is shown"
              value={(m.f.format || '').trim()}
              // Each option previews *this measure's* value in that format, so
              // the choice is made by looking at the answer rather than by
              // decoding a token name.
              choices={FORMATS.map((f) => ({ value: f, hint: fmt(value.v, f) }))}
              onChange={(v) => set('format', v || null)}
            />
          </Field>

          <Field
            label="Oversight level"
            hint="levels 1 and 2 need a description and a rule reference"
            notes={notes('sr_11_7_tier')}
            onFix={onFix}
          >
            <Picker
              ariaLabel="Oversight level"
              value={(m.f.sr_11_7_tier || '').trim()}
              choices={choices(TIERS)}
              onChange={(v) => set('sr_11_7_tier', v || null)}
            />
          </Field>

          {/* Only shown once the measure is under oversight — a citation field
              on an exploratory metric is a question nobody needs to answer. */}
          {parseInt((m.f.sr_11_7_tier || '0').trim(), 10) >= 1 ? (
            <Field label="Rule it comes from" notes={notes('citation')} onFix={onFix}>
              <TextBox
                ariaLabel="Rule it comes from"
                value={m.f.citation || ''}
                invalid={notes('citation').some((n) => n.sev === 'error')}
                onChange={(v) => set('citation', v.trim() || null)}
              />
            </Field>
          ) : null}
        </Section>

        {/* --- anything the routing table could not place ------------------ */}
        {routed.unrouted.length ? (
          <div className="mdl-form-spare">
            <span className="mdl-palette-label">Also on this measure</span>
            {routed.unrouted.map((d) => (
              <Note key={`${d.code}-${d.line}`} note={d} onFix={onFix} />
            ))}
          </div>
        ) : null}

        {/* --- drag sources ----------------------------------------------- */}
        <div className="mdl-form-footer">
          <span className="mdl-palette-label">Drag these in</span>
          <PaletteRow label="Columns">
            {columns.map((c) => (
              <Chip
                key={c}
                text={`·${c}`}
                kind="column"
                onDragStart={(e) => dragPayload(e, 'column', c)}
              />
            ))}
          </PaletteRow>
          <PaletteRow label="Measures">
            {others.map((name) => (
              <Chip
                key={name}
                text={`⟨${name}⟩`}
                kind="measure"
                ariaLabel={`measure ${name}, currently ${fmt(evaluator.value(name).v, graph.byName[name]?.f.format)}`}
                onDragStart={(e) => dragPayload(e, 'measure', name)}
              />
            ))}
          </PaletteRow>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({
  index, title, blurb, children,
}: {
  index: string; title: string; blurb: string; children: React.ReactNode;
}) {
  return (
    <section className="mdl-form-section">
      <div className="mdl-form-section-head">
        <span className="mdl-form-section-index mono">{index}</span>
        <span className="mdl-form-section-title">{title}</span>
        <span className="mdl-form-section-blurb">{blurb}</span>
      </div>
      {children}
    </section>
  );
}

/** The fields a column-reading measure needs, including the condition builder. */
function SimpleFields({
  m, columns, source, fixture, filter, notes, onFix, set, writeRows,
}: {
  m: Graph['measures'][number];
  columns: string[];
  source: string;
  fixture: FixtureName;
  filter: ReturnType<typeof filterRows>;
  notes(field: string): Diagnostic[];
  onFix(fix: Fix, d: Diagnostic): void;
  set(key: string, value: string | null): void;
  writeRows(rows: ConditionRow[]): void;
}) {
  const field = (m.f.field || '').trim();

  return (
    <>
      <Field label="How rows are combined" notes={notes('agg')} onFix={onFix}>
        <Picker
          ariaLabel="How rows are combined"
          value={(m.f.agg || 'sum').trim()}
          choices={choices(AGGREGATES)}
          onChange={(v) => set('agg', v)}
        />
      </Field>

      <Field
        label="Column to read"
        hint="drag a column in, or pick one"
        notes={notes('field')}
        onFix={onFix}
      >
        <DropZone
          accepts="column"
          placeholder="Drop a column here"
          chip={field ? <Chip text={`·${field}`} kind="column" /> : null}
          onDrop={(name) => set('field', name)}
        />
        <Picker
          ariaLabel="Column to read"
          value={field}
          choices={choices(columns, {})}
          invalid={notes('field').some((n) => n.sev === 'error')}
          onChange={(v) => set('field', v || null)}
        />
      </Field>

      <Field
        label="Only include rows where"
        hint={filter.advanced
          ? 'written by hand — switch to YAML to change it'
          : 'each line narrows the rows'}
        notes={notes('where')}
        onFix={onFix}
      >
        {filter.advanced ? (
          // Never rewritten. A clause with parentheses, `in` or `is null` has no
          // faithful row form, and approximating it would change what the
          // measure counts without saying so.
          <div className="mdl-advanced mono" data-testid="mdl-advanced-filter">{filter.raw}</div>
        ) : (
          <ConditionBuilder
            rows={filter.rows}
            columns={columns}
            source={source}
            fixture={fixture}
            onChange={writeRows}
          />
        )}
      </Field>
    </>
  );
}

function ConditionBuilder({
  rows, columns, source, fixture, onChange,
}: {
  rows: ConditionRow[];
  columns: string[];
  source: string;
  fixture: FixtureName;
  onChange(rows: ConditionRow[]): void;
}) {
  const patch = (i: number, next: Partial<ConditionRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...next } : r)));

  return (
    <div className="mdl-conditions">
      {rows.map((row, i) => {
        const observed = observedValues(fixture, source, row.col);
        return (
          <div className="mdl-condition" key={i}>
            {i ? (
              <Picker
                ariaLabel="Join"
                width={72}
                value={row.join || 'and'}
                choices={choices(['and', 'or'], {})}
                onChange={(v) => patch(i, { join: v })}
              />
            ) : (
              <span className="mdl-condition-lead">where</span>
            )}

            <Picker
              ariaLabel="Column"
              value={row.col}
              choices={choices(columns, {})}
              onChange={(v) => {
                // A value from the old column is meaningless against the new
                // one, so it resets to something the new column actually holds.
                const next = observedValues(fixture, source, v);
                patch(i, { col: v, val: next[0] ?? "''" });
              }}
            />

            <Picker
              ariaLabel="Comparison"
              width={68}
              value={row.op}
              choices={choices(COMPARISONS, {})}
              onChange={(v) => patch(i, { op: v })}
            />

            {/* Only values the data actually holds. `segment = 'Retail'` against
                a book that says `RETAIL` is the commonest silent error in
                metric authoring, and it produces a confident zero. */}
            {observed.length ? (
              <Picker
                ariaLabel="Value"
                value={row.val}
                choices={choices(observed, {})}
                onChange={(v) => patch(i, { val: v })}
              />
            ) : (
              <TextBox
                ariaLabel="Value"
                mono
                value={row.val}
                onChange={(v) => patch(i, { val: v })}
              />
            )}

            <button
              type="button"
              className="mdl-icon-btn"
              aria-label="Remove condition"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className="mdl-fix mdl-add-condition"
        onClick={() => {
          const col = columns[0] || '';
          const observed = observedValues(fixture, source, col);
          onChange([
            ...rows,
            { join: rows.length ? 'and' : '', col, op: '=', val: observed[0] ?? "''" },
          ]);
        }}
      >
        + Add a condition
      </button>
    </div>
  );
}
