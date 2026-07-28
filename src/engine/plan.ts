/**
 * The compiled plan and backend conformance.
 *
 * Only DuckDB executes in the authoring loop. Other backends are compiled but
 * not run — their plans appear here and their conformance arrives from CI, so
 * an author never waits on Spark to see a number.
 */

import { AS_OF } from './fixtures';
import { reqs, type Graph, type Measure } from './parse';
import { BACKENDS, FIXTURES, UNSUPPORTED, type FixtureName } from './vocab';

export function planLines(g: Graph, m: Measure | null, fixture: FixtureName): string[] {
  if (!m) return ['—'];

  const type = (m.f.type || '').trim();
  const head = [
    `-- runs on duckdb · ${(FIXTURES[fixture] || fixture).toLowerCase()}`,
    'WITH base AS (',
    `  SELECT * FROM ${g.view.source}`,
    `  WHERE as_of_date = DATE '${AS_OF}'`,
    ')',
  ];

  if (type === 'simple') {
    return head.concat(
      `SELECT ${m.f.agg || 'sum'}(${m.f.field}) AS ${m.name}\nFROM base` +
        (m.f.where ? `\nWHERE ${m.f.where}` : ''),
    );
  }

  if (type === 'windowed') {
    const input = reqs(m)[0] || '?';
    const over = parseInt(m.f['window.over'] || '1', 10) || 1;
    const op = m.f['window.op'] || '?';
    const body =
      op === 'delta'
        ? `${input} - lag(${input}, ${over}) OVER (ORDER BY as_of_date)`
        : `${op === 'stddev' ? 'stddev_samp' : op}(${input}) OVER (ORDER BY as_of_date\n` +
          `       ROWS BETWEEN ${over - 1} PRECEDING AND CURRENT ROW)`;
    return head.concat(`SELECT ${body} AS ${m.name}\nFROM measures`);
  }

  return head.concat(`SELECT ${(m.f.expression || '').trim()} AS ${m.name}\nFROM measures`);
}

export interface Conformance {
  name: string;
  ok: boolean;
}

/**
 * A backend is marked unsupported only where an operator the measure actually
 * uses is missing there. Offline, status would read `unknown` — never `pass`.
 */
export function conformance(m: Measure | null): Conformance[] {
  const text = m ? `${m.f.expression || ''} ${m.f['window.op'] || ''}` : '';
  const blocked: Record<string, true> = {};
  Object.keys(UNSUPPORTED).forEach((op) => {
    if (new RegExp(`\\b${op}\\b`).test(text)) blocked[UNSUPPORTED[op].toLowerCase()] = true;
  });
  return BACKENDS.map((name) => ({ name, ok: !blocked[name] }));
}
