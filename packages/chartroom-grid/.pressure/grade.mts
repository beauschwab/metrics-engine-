/**
 * Grade the blind agents' final plans: re-run each against a fresh server,
 * read the session view it left and the rows it shows, and check them against
 * what the analyst asked — by brute force over the same seeded book.
 */
import { readFileSync, existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { generatePositions, type Position } from '../src/data/mock';

const PKG = '/home/user/metrics-engine-/packages/chartroom-grid';
const DIR = process.argv[2];
const BOOK = generatePositions(5000);
const sum = (xs: Position[], k: keyof Position) => xs.reduce((s, p) => s + (p[k] as number), 0);

async function run(plan: Array<{ tool: string; args?: any }>) {
  const t = new StdioClientTransport({ command: `${PKG}/../../node_modules/.bin/tsx`, args: ['mcp.ts'], cwd: PKG, env: { ...process.env, GRID_ROWS: '5000' } as Record<string, string> });
  const c = new Client({ name: 'grade', version: '0' });
  await c.connect(t);
  const body = async (tool: string, args: any = {}) => JSON.parse(((await c.callTool({ name: tool, arguments: args })).content as any)[0].text);
  for (const call of plan) await c.callTool({ name: call.tool, arguments: call.args ?? {} });
  const view = (await body('describe_view')).view;
  const rows: any[] = [];
  let first: any;
  for (let offset = 0; ; offset += 1000) {
    const q = await body('query_view', { limit: 1000, offset, expandAll: false });
    first ??= q;
    rows.push(...q.rows);
    if (!q.truncated) break;
  }
  const expanded = await body('query_view', { limit: 1000, expandAll: true });
  await c.close();
  return { view, q: { ...first, rows }, expanded };
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const set = (xs: unknown) => JSON.stringify([...(xs as string[] ?? [])].sort());
type G = (r: Awaited<ReturnType<typeof run>>) => Array<[string, boolean, unknown?]>;

const GRADERS: Record<string, G> = {
  A1: ({ view, q }) => {
    const want = BOOK.filter((p) => p.desk === 'Credit' && p.notional >= 1e9).sort((a, b) => a.mtm - b.mtm);
    const ids = q.rows.filter((r: any) => r.kind === 'leaf').map((r: any) => r.id);
    return [['rows are Credit with notional ≥ $1bn', q.total === want.length, { total: q.total, want: want.length }],
      ['biggest loss first (MTM ascending)', eq(ids, want.map((p) => p.tradeId)), { first: ids.slice(0, 3), want: want.slice(0, 3).map((p) => p.tradeId), sorting: view.sorting }]];
  },
  A2: ({ view }) => [['grouped desk then entity', eq(view.grouping, ['desk', 'legalEntity']), view.grouping],
    ['yield stays a notional-weighted average', !view.columnAggs?.yield || view.columnAggs.yield === 'wavg', view.columnAggs],
    ['yield not hidden', view.columnVisibility?.yield !== false, view.columnVisibility]],
  A3: ({ view }) => [['desks down the side', eq(view.grouping, ['desk']), view.grouping],
    ['currency across the top', view.pivot?.column === 'currency', view.pivot],
    ['notional only', eq(view.pivot?.values, ['notional']), view.pivot?.values],
    ['USD, EUR, GBP', set(view.pivot?.buckets) === set(['USD', 'EUR', 'GBP']), view.pivot?.buckets]],
  A4: ({ view }) => [['tenor ascending first', view.sorting?.[0]?.id === 'tenorBucket' && view.sorting[0].desc === false, view.sorting],
    ['no grouping', view.grouping.length === 0, view.grouping]],
  A5: ({ view }) => [['a ratio column mtm / notional', view.computedColumns?.some((c: any) => c.op === 'ratio' && eq(c.of, ['mtm', 'notional'])), view.computedColumns]],
  A6: ({ view }) => [['grouped by desk', eq(view.grouping, ['desk']), view.grouping], ['DV01 aggregated as median', view.columnAggs?.dv01 === 'median', view.columnAggs]],
  B1: ({ view }) => [['notional in billions, 2dp', view.columnFormats?.notional?.scale === 'bn' && view.columnFormats.notional.dp === 2, view.columnFormats],
    ['MTM negatives in brackets', view.columnFormats?.mtm?.negatives === 'parens', view.columnFormats]],
  B2: ({ view, q }) => [['trade id and as-of hidden', view.columnVisibility?.tradeId === false && view.columnVisibility?.asOf === false, view.columnVisibility],
    ['desk pinned to the start', view.columnPinning?.start?.includes('desk'), view.columnPinning],
    ['desk is the first column the answer lists', q.columns?.[0] === 'desk', q.columns]],
  B3: ({ view, q }) => [['grouped by desk', eq(view.grouping, ['desk']), view.grouping],
    ['only Rates open', eq(view.expanded, { 'desk:Rates': true }), view.expanded],
    ['Rates leaves shown', q.rows.filter((r: any) => r.kind === 'leaf').length === BOOK.filter((p) => p.desk === 'Rates').length, q.rows.length]],
  B4: ({ q }) => {
    const want = BOOK.filter((p) => p.tenorBucket === '5Y' || p.tenorBucket === '10Y+').sort((a, b) => b.dv01 - a.dv01).slice(0, 20).map((p) => p.tradeId);
    return [['top 20 DV01 in 5Y/10Y+', eq(q.rows.slice(0, 20).map((r: any) => r.id), want), q.rows.slice(0, 3).map((r: any) => r.id)]];
  },
  B5: ({ q }) => [['yield 3–4%', q.total === BOOK.filter((p) => p.yield >= 3 && p.yield <= 4).length, q.total]],
  B6: ({ q }) => {
    const want = BOOK.filter((p) => p.currency === 'EUR' && p.legalEntity !== 'WF-US');
    return [['EUR not WF-US', q.total === want.length, { total: q.total, want: want.length }], ['notional total', Math.abs(q.totals.values.notional - sum(want, 'notional')) < 1, q.totals.values.notional]];
  },
  C1: ({ view }) => [['bold rule notional > 2bn', view.columnFormats?.notional?.rules?.some((r: any) => (r.op === '>' || r.op === '>=') && r.value === 2e9 && r.emphasis === 'strong'), view.columnFormats]],
  C2: ({ view, q }) => [['grouped by product', eq(view.grouping, ['product']), view.grouping],
    ['counts right', q.rows.every((g: any) => g.group?.count === BOOK.filter((p) => p.product === g.group?.value).length), q.rows.slice(0, 2)]],
  C3: ({ view }) => [['DV01 trend against its limit', view.columnFormats?.dv01?.trend === 'band', view.columnFormats]],
  C4: ({ view, q }) => {
    const credit = BOOK.filter((p) => p.product === 'Bond' || p.product === 'CDS');
    return [['grouped by entity', eq(view.grouping, ['legalEntity']), view.grouping],
      ['bonds and CDS only', q.total === credit.length, q.total],
      ['CS01 per entity', q.rows.every((g: any) => Math.abs(g.values.cs01 - sum(credit.filter((p) => p.legalEntity === g.group.value), 'cs01')) < 1), q.rows.map((g: any) => g.values.cs01)]];
  },
  C5: () => [],
  D1: ({ q }) => {
    const want = BOOK.filter((p) => p.currency === 'EUR' && p.legalEntity !== 'WF-US');
    return [['EUR not WF-US', q.total === want.length, { total: q.total, want: want.length }], ['notional total', Math.abs(q.totals.values.notional - sum(want, 'notional')) < 1, q.totals.values.notional]];
  },
  D2: ({ view, q }) => [['grouped desk then entity', eq(view.grouping, ['desk', 'legalEntity']), view.grouping],
    ['entity subtotals visible', q.rows.filter((r: any) => r.kind === 'group' && r.depth === 1).length === 20, q.rows.length],
    ['no trades shown', q.rows.every((r: any) => r.kind === 'group'), q.rows.filter((r: any) => r.kind === 'leaf').length]],
  D3: ({ view }) => [['a ratio column mtm / notional', view.computedColumns?.some((c: any) => c.op === 'ratio' && eq(c.of, ['mtm', 'notional'])), view.computedColumns]],
  D4: ({ view }) => [['bold rule notional > 2bn', view.columnFormats?.notional?.rules?.some((r: any) => (r.op === '>' || r.op === '>=') && r.value === 2e9 && r.emphasis === 'strong'), view.columnFormats]],
  D5: ({ view, q }) => [['grouped by product', eq(view.grouping, ['product']), view.grouping],
    ['counts right', q.rows.every((g: any) => g.group?.count === BOOK.filter((p) => p.product === g.group?.value).length), q.rows.slice(0, 2)]],
  D6: ({ view }) => [['desks down the side', eq(view.grouping, ['desk']), view.grouping],
    ['pivot by counterparty with named buckets (unnamed is refused)', view.pivot?.column === 'counterparty' && view.pivot.buckets.length > 0 && view.pivot.buckets.length <= 50, view.pivot]],
  D7: ({ view, q }) => {
    const want = BOOK.filter((p) => p.desk === 'Rates' && p.tenorBucket === '1Y');
    const leaves = q.rows.filter((r: any) => r.kind === 'leaf');
    return [['Rates in 1Y', q.total === want.length, { total: q.total, want: want.length }],
      ['grouped by entity', view.grouping.at(-1) === 'legalEntity', view.grouping],
      ['only WF-US open', leaves.length === want.filter((p) => p.legalEntity === 'WF-US').length && leaves.every((r: any) => BOOK.find((p) => p.tradeId === r.id)?.legalEntity === 'WF-US'), { leaves: leaves.length, expanded: view.expanded }]];
  },
  C6: ({ view }) => [['only grouped by currency, everything else default', eq(view.grouping, ['currency']) && view.columnFilters.length === 0 && !view.globalFilter && view.sorting.length === 0 && Object.keys(view.columnFormats).length === 0 && view.computedColumns.length === 0 && !view.pivot.column, view]],
};

for (const id of Object.keys(GRADERS).filter((k) => !process.argv[3] || k.startsWith(process.argv[3]))) {
  const file = `${DIR}/agent${id[0]}/${id}.json`;
  if (!existsSync(file)) { console.log(`MISSING ${id}`); continue; }
  const r = await run(JSON.parse(readFileSync(file, 'utf8')));
  for (const [name, ok, detail] of GRADERS[id](r)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${name}${ok ? '' : `  ${JSON.stringify(detail).slice(0, 300)}`}`);
}
// Truth for the questions.
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const desks = [...new Set(BOOK.map((p) => p.desk))];
console.log('TRUTH A6', JSON.stringify(Object.fromEntries(desks.map((d) => [d, med(BOOK.filter((p) => p.desk === d).map((p) => p.dv01))]))));
console.log('TRUTH B5', BOOK.filter((p) => p.yield >= 3 && p.yield <= 4).length);
console.log('TRUTH B6', sum(BOOK.filter((p) => p.currency === 'EUR' && p.legalEntity !== 'WF-US'), 'notional'));
const cp = new Map<string, number>(); for (const p of BOOK) cp.set(p.counterparty, (cp.get(p.counterparty) ?? 0) + p.notional);
console.log('TRUTH C5', JSON.stringify([...cp].sort((a, b) => b[1] - a[1]).slice(0, 2)));
