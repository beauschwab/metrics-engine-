/**
 * A deliberately small, position-preserving YAML reader.
 *
 * This is a CST-shaped read, not a general YAML parse: every line keeps its
 * index and every key keeps the line it was written on, because pills, gutter
 * marks and diagnostics all need to point back at source ranges. Comments and
 * blank lines round-trip untouched — a quick-fix must never silently drop an
 * author's annotation.
 */

export interface Measure {
  name: string;
  /**
   * The key that opened this block — `name` for a measure, `id` for a
   * classification rule, the first field for a parameter entry. Blocks are
   * structurally identical; only the discriminator differs.
   */
  blockKey: string;
  /** Index of the line that opened the block. */
  line: number;
  /** Which document-root list this block sits under: measures, rules, entries… */
  section: string | null;
  /** Field values, block scalars already folded onto one string. */
  f: Record<string, string>;
  /** Line index each field's key was written on. */
  lineOf: Record<string, number>;
  /**
   * Line index where each field's *text* lives. For an inline scalar that is
   * the key's own line; for a folded block (`expression: >`) it is the first
   * continuation line. Diagnostics and fixes must point here — pointing at the
   * key line puts the squiggle above the code and makes a rename rewrite a
   * line that does not contain the name.
   */
  contentOf: Record<string, number>;
}

/** What sort of document this is. Defaults to a metrics view. */
export type DocKind =
  | 'metrics_view'
  | 'classification'
  | 'parameter_set'
  | 'report'
  /** Day-over-day variance on a rollup, and the thresholds that judge it. */
  | 'variance_monitor'
  /** A client system's columns, mapped to a canonical source. */
  | 'source_binding';

export interface ViewHeader {
  source: string;
  view?: string;
  version?: string;
  kind?: string;
  [key: string]: string | undefined;
}

/** What a single source line is, structurally. */
export interface LineInfo {
  /** The YAML key in force on this line — carried onto block-scalar continuations. */
  key: string | null;
  /** `    - name: ` / `    agg: ` — everything up to and including the colon and its space. */
  head: string;
  /** Column at which the scalar starts. */
  valueFrom: number;
  /** Measure this line belongs to, if any. */
  owner: string | null;
  /** True inside the `measures:` list, false in the file header / `grain:` block. */
  inMeasure: boolean;
  /** True when this line is a folded continuation of the key above it. */
  continuation: boolean;
}

export interface Graph {
  lines: string[];
  kind: DocKind;
  /** Every block in the document, whatever section it belongs to. */
  blocks: Measure[];
  /** `name:` at the document root — how other documents refer to this one. */
  docName: string;
  view: ViewHeader;
  /** Blocks in document order: measures, rules, or parameter entries. */
  measures: Measure[];
  byName: Record<string, Measure>;
  info: LineInfo[];
}

/** Any `- key: value` list item opens a block, whatever the key. */
const BLOCK_RE = /^-\s*([a-z_0-9.]+):\s*(.*)$/;
const KV_RE = /^([a-z_0-9.]+):\s*(.*)$/;
const HEAD_RE = /^(\s*(?:-\s*)?[a-z_0-9.]+:\s*)(.*)$/;

export function parse(lines: string[]): Graph {
  const view: ViewHeader = { source: '' };
  const blocks: Measure[] = [];
  const info: LineInfo[] = [];
  let cur: Measure | null = null;
  let key: string | null = null;
  /** The document-root list currently open, e.g. `measures` or `rules`. */
  let section: string | null = null;
  /** The document-root mapping currently open, e.g. `grain` or `governance`. */
  let rootKey: string | null = null;

  lines.forEach((raw, i) => {
    const t = raw.trim();
    const head = HEAD_RE.exec(raw);

    if (!t || t.charAt(0) === '#') {
      info.push({
        key: null, head: '', valueFrom: 0,
        owner: cur ? cur.name : null, inMeasure: !!cur, continuation: false,
      });
      return;
    }

    const nm = BLOCK_RE.exec(t);
    if (nm) {
      const blockKey = nm[1];
      const value = nm[2].trim();
      cur = {
        name: value || `${blockKey}@${i}`,
        blockKey,
        section,
        line: i,
        f: { [blockKey]: value },
        lineOf: { [blockKey]: i },
        contentOf: { [blockKey]: i },
      };
      blocks.push(cur);
      key = blockKey;
      info.push({
        key: blockKey, head: head ? head[1] : '', valueFrom: head ? head[1].length : 0,
        owner: cur.name, inMeasure: true, continuation: false,
      });
      return;
    }

    const kv = KV_RE.exec(t);
    if (kv) {
      key = kv[1];
      const indent = raw.length - raw.trimStart().length;
      // A key at column zero closes whatever block was open and starts a new
      // document-root section. Without this, `measures:` following a
      // `derivations:` list would be swallowed as a field of the last block.
      if (indent === 0) {
        cur = null;
        section = kv[2].trim() ? null : key;
        rootKey = kv[2].trim() ? null : key;
      }
      // `>` and `|` open a block scalar; the value arrives on the lines below.
      const folded = kv[2] === '>' || kv[2] === '|';
      const v = folded ? '' : kv[2];
      if (cur) {
        cur.f[key] = v;
        cur.lineOf[key] = i;
        // A folded key has no content yet; the first continuation line claims it.
        if (!folded) cur.contentOf[key] = i;
        else delete cur.contentOf[key];
      } else if (key === 'source') {
        view.source = v;
      } else {
        view[key] = v;
        // Also record the qualified path, so `governance.citation` and a rule's
        // own `citation` never collide in the header map.
        if (indent > 0 && rootKey) view[`${rootKey}.${key}`] = v;
      }
      info.push({
        key, head: head ? head[1] : '', valueFrom: head ? head[1].length : 0,
        owner: cur ? (cur as Measure).name : null, inMeasure: !!cur, continuation: false,
      });
      return;
    }

    // Folded continuation — append to whatever key is in force.
    if (cur && key) {
      cur.f[key] = (cur.f[key] ? cur.f[key] + ' ' : '') + t;
      if (cur.contentOf[key] === undefined) cur.contentOf[key] = i;
    }
    info.push({
      key, head: '', valueFrom: raw.length - raw.trimStart().length,
      owner: cur ? (cur as Measure).name : null, inMeasure: !!cur, continuation: true,
    });
  });

  // `measures` stays the metrics-view view of the document, so every existing
  // consumer keeps working; `blocks` is the whole thing.
  const measures = blocks.filter((b) => b.section === 'measures' || b.section === null);
  const byName: Record<string, Measure> = {};
  measures.forEach((m) => {
    byName[m.name] = m;
  });

  const kind = (view.kind || 'metrics_view').trim() as DocKind;
  const docName = (view.name || view.view || '').trim();

  return { lines, kind, docName, view, blocks, measures, byName, info };
}

export function parseDoc(doc: string): Graph {
  return parse(doc.split('\n'));
}

/** Names listed in `requires:`. */
export function reqs(m: Measure): string[] {
  const r = m.f.requires || '';
  return r.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Every identifier mentioned in `expression:`, functions and literals included. */
export function exprNames(m: Measure): string[] {
  return (m.f.expression || '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
}

/** Blocks under a given document-root list. */
export function sectionBlocks(g: Graph, section: string): Measure[] {
  return g.blocks.filter((b) => b.section === section);
}

/** The block containing a given line. */
export function ownerAt(g: Graph, line: number): Measure | null {
  let owner: Measure | null = null;
  g.blocks.forEach((m) => {
    if (m.line <= line) owner = m;
  });
  return owner;
}
