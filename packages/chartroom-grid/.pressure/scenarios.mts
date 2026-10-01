/**
 * Pressure test of the grid MCP server over real stdio: user use cases graded
 * against brute force over the same seeded book, and adversarial patches that
 * must be refused without touching the session.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { generatePositions, TENORS, type Position } from '../src/data/mock';

const PKG = '/home/user/metrics-engine-/packages/chartroom-grid';
const N = Number(process.env.ROWS ?? 5000);
const BOOK = generatePositions(N);

type Res = { isError: boolean; ms: number; bytes: number; body: any };
async function session(rows = N) {
  const transport = new StdioClientTransport({
    command: `${PKG}/../../node_modules/.bin/tsx`, args: ['mcp.ts'], cwd: PKG,
    env: { ...process.env, GRID_ROWS: String(rows) } as Record<string, string>, stderr: 'inherit',
  });
  const client = new Client({ name: 'pressure', version: '0' });
  await client.connect(transport);
  const call = async (tool: string, args: Record<string, unknown> = {}): Promise<Res> => {
    const t0 = performance.now();
    try {
      const r = await client.callTool({ name: tool, arguments: args });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
      let body: any = text;
      try { body = JSON.parse(text); } catch { /* raw */ }
      return { isError: !!r.isError, ms: Math.round(performance.now() - t0), bytes: text.length, body };
    } catch (e) {
      return { isError: true, ms: Math.round(performance.now() - t0), bytes: 0, body: { protocolError: String(e) } };
    }
  };
  return { call, close: () => client.close() };
}

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push({ name, ok, detail: ok ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 600) });
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const sum = (xs: Position[], k: keyof Position) => xs.reduce((s, p) => s + (p[k] as number), 0);
const wavg = (xs: Position[], k: keyof Position, w: keyof Position) => xs.reduce((s, p) => s + (p[k] as number) * (p[w] as number), 0) / sum(xs, w);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const by = <K extends keyof Position>(k: K) => { const m = new Map<string, Position[]>(); for (const p of BOOK) { const key = String(p[k]); m.set(key, [...(m.get(key) ?? []), p]); } return m; };

async function all(call: (t: string, a?: any) => Promise<Res>, extra: Record<string, unknown> = {}) {
  const out: any[] = [];
  let first: any;
  for (let offset = 0; ; offset += 1000) {
    const r = await call('query_view', { limit: 1000, offset, ...extra });
    if (r.isError) return { error: r.body };
    first ??= r.body;
    out.push(...r.body.rows);
    if (!r.body.truncated) break;
  }
  return { ...first, rows: out };
}

// ---------------------------------------------------------------- use cases
async function useCases() {
  const { call, close } = await session();

  // U1 Credit desk, notional over $1bn, largest MTM first — via the quick filter.
  let r = await call('set_view', { patch: { globalFilter: 'desk:Credit notional>1bn', sorting: [{ id: 'mtm', desc: true }] }, replace: true });
  check('U1 set accepted', !r.isError, r.body);
  let q = await all(call);
  let want = BOOK.filter((p) => p.desk.includes('Credit') && p.notional > 1e9).sort((a, b) => b.mtm - a.mtm);
  check('U1 rows = Credit & notional>1bn, by MTM desc', JSON.stringify(q.rows.map((x: any) => x.id)) === JSON.stringify(want.map((p) => p.tradeId)), { got: q.rows.length, want: want.length, first: q.rows.slice(0, 3).map((x: any) => x.id) });
  check('U1 total', q.total === want.length, { total: q.total, want: want.length });
  check('U1 totals.notional', near(q.totals.values.notional, sum(want, 'notional')), q.totals.values);

  // U1b the same through columnFilters (inclusive range).
  r = await call('set_view', { patch: { columnFilters: [{ id: 'desk', value: ['Credit'] }, { id: 'notional', value: [1e9, null] }], sorting: [{ id: 'mtm', desc: true }] }, replace: true });
  q = await all(call);
  want = BOOK.filter((p) => p.desk === 'Credit' && p.notional >= 1e9).sort((a, b) => b.mtm - a.mtm);
  check('U1b columnFilters equivalent', !r.isError && q.total === want.length && q.rows[0]?.id === want[0]?.tradeId, { err: r.isError && r.body, total: q.total, want: want.length });

  // U2 by desk then entity, notional summed, yield and WAL weighted by notional.
  r = await call('set_view', { patch: { grouping: ['desk', 'legalEntity'] }, replace: true });
  q = await all(call, { expandAll: true });
  const groups = q.rows.filter((x: any) => x.kind === 'group');
  const desks = by('desk');
  let bad: any[] = [];
  for (const g of groups.filter((x: any) => x.depth === 0)) {
    const xs = desks.get(g.group.value)!;
    if (!near(g.values.notional, sum(xs, 'notional')) || !near(g.values.yield, wavg(xs, 'yield', 'notional')) || !near(g.values.wal, wavg(xs, 'wal', 'notional')) || g.group.count !== xs.length) bad.push({ desk: g.group.value, got: g.values, count: g.group.count });
  }
  check('U2 desk subtotals (sum, wavg yield/WAL, counts)', bad.length === 0 && groups.filter((x: any) => x.depth === 0).length === desks.size, bad);
  bad = [];
  for (const g of groups.filter((x: any) => x.depth === 1)) {
    const deskVal = String(g.id).split('>')[0].split(':')[1];
    const xs = BOOK.filter((p) => p.desk === deskVal && p.legalEntity === g.group.value);
    if (!near(g.values.yield, wavg(xs, 'yield', 'notional')) || g.group.count !== xs.length) bad.push({ id: g.id, got: g.values.yield, want: wavg(xs, 'yield', 'notional') });
  }
  check('U2 entity subtotals inside each desk', bad.length === 0 && groups.some((x: any) => x.depth === 1), bad);
  check('U2 leaves present under expandAll', q.rows.filter((x: any) => x.kind === 'leaf').length === N, { leaves: q.rows.filter((x: any) => x.kind === 'leaf').length });
  check('U2 group row id matches contract "column:value" joined by ">"', /^desk:[^>]+>legalEntity:.+$/.test(groups.find((x: any) => x.depth === 1)?.id ?? ''), groups.find((x: any) => x.depth === 1)?.id);

  // U3 pivot notional by currency, USD/EUR/GBP only, grouped by desk.
  r = await call('set_view', { patch: { grouping: ['desk'], pivot: { column: 'currency', values: ['notional'], buckets: ['USD', 'EUR', 'GBP'] } }, replace: true });
  check('U3 pivot accepted', !r.isError, r.body);
  q = await all(call);
  check('U3 pivot columns', ['p:notional:USD', 'p:notional:EUR', 'p:notional:GBP'].every((c) => q.columns?.includes(c)) && !q.columns?.includes('p:notional:JPY'), q.columns);
  bad = [];
  for (const g of q.rows.filter((x: any) => x.kind === 'group')) {
    for (const ccy of ['USD', 'EUR', 'GBP']) {
      const want = sum(BOOK.filter((p) => p.desk === g.group.value && p.currency === ccy), 'notional');
      if (!near(g.values[`p:notional:${ccy}`] ?? 0, want)) bad.push({ desk: g.group.value, ccy, got: g.values[`p:notional:${ccy}`], want });
    }
  }
  check('U3 pivot cells = Σ notional per desk × ccy', bad.length === 0, bad);
  check('U3 pivot grand total per bucket', near(q.totals.values['p:notional:USD'] ?? NaN, sum(BOOK.filter((p) => p.currency === 'USD'), 'notional')), q.totals.values);

  // U4 the tenor ladder in its own order, both ways.
  r = await call('set_view', { patch: { sorting: [{ id: 'tenorBucket', desc: false }] }, replace: true });
  q = await all(call);
  const ranks = q.rows.map((x: any) => (TENORS as readonly string[]).indexOf(x.values.tenorBucket));
  check('U4 tenor ascending by ladder', ranks.every((v: number, i: number) => i === 0 || v >= ranks[i - 1]), ranks.slice(0, 20));
  r = await call('set_view', { patch: { sorting: [{ id: 'tenorBucket', desc: true }] } });
  q = await call('query_view', { limit: 5 });
  check('U4 tenor descending starts at 10Y+', q.body.rows[0]?.values.tenorBucket === '10Y+', q.body.rows.map((x: any) => x.values.tenorBucket));

  // U5 MTM as a share of notional — a ratio column, rolled up as a ratio of sums.
  r = await call('set_view', { patch: { grouping: ['desk'], computedColumns: [{ id: 'c:mtm_share', label: 'MTM share', op: 'ratio', of: ['mtm', 'notional'] }] }, replace: true });
  check('U5 computed accepted', !r.isError, r.body);
  q = await all(call, { expandAll: true });
  const leaf = q.rows.find((x: any) => x.kind === 'leaf');
  const lp = BOOK.find((p) => p.tradeId === leaf?.id)!;
  check('U5 leaf ratio = 100·mtm/notional', near(leaf?.values['c:mtm_share'], (100 * lp.mtm) / lp.notional), { got: leaf?.values['c:mtm_share'], want: (100 * lp.mtm) / lp.notional });
  const g5 = q.rows.find((x: any) => x.kind === 'group');
  const x5 = desks.get(g5.group.value)!;
  check('U5 group ratio = 100·Σmtm/Σnotional (not mean of ratios)', near(g5.values['c:mtm_share'], (100 * sum(x5, 'mtm')) / sum(x5, 'notional')), { got: g5.values['c:mtm_share'], want: (100 * sum(x5, 'mtm')) / sum(x5, 'notional') });

  // U6 notional in billions to 2dp; MTM in accounting negatives.
  r = await call('set_view', { patch: { columnFormats: { notional: { scale: 'bn', dp: 2 }, mtm: { negatives: 'parens' } }, sorting: [{ id: 'mtm', desc: false }] }, replace: true });
  q = await call('query_view', { limit: 1 });
  const row6 = q.body.rows[0];
  check('U6 display reads $x.xxB and (…)', /^\$\d+\.\d{2}B$/.test(row6?.display.notional) && /^\(\$[\d.]+M\)$/.test(row6?.display.mtm), row6?.display);

  // U7 hide trade and as-of, pin desk to the start, counterparty first otherwise.
  r = await call('set_view', { patch: { columnVisibility: { tradeId: false, asOf: false }, columnPinning: { start: ['desk'], end: [] }, columnOrder: ['counterparty'] }, replace: true });
  q = await call('query_view', { limit: 1 });
  check('U7 columns: desk pinned first, counterparty next, trade/asOf hidden', q.body.columns?.[0] === 'desk' && q.body.columns?.[1] === 'counterparty' && !q.body.columns.includes('tradeId') && !q.body.columns.includes('asOf'), q.body.columns);

  // U8 median DV01 by desk.
  r = await call('set_view', { patch: { grouping: ['desk'], columnAggs: { dv01: 'median' } }, replace: true });
  q = await all(call);
  bad = q.rows.filter((g: any) => !near(g.values.dv01, median(desks.get(g.group.value)!.map((p) => p.dv01)))).map((g: any) => ({ desk: g.group.value, got: g.values.dv01 }));
  check('U8 median DV01 per desk', !r.isError && bad.length === 0, r.isError ? r.body : bad);
  check('U8 grand total is the median too', near(q.totals.values.dv01, median(BOOK.map((p) => p.dv01))), { got: q.totals.values.dv01, want: median(BOOK.map((p) => p.dv01)) });

  // U9 expand only Rates.
  r = await call('set_view', { patch: { grouping: ['desk'], expanded: { 'desk:Rates': true } }, replace: true });
  q = await all(call);
  const leaves9 = q.rows.filter((x: any) => x.kind === 'leaf');
  check('U9 only Rates expanded', leaves9.length === desks.get('Rates')!.length && leaves9.every((x: any) => BOOK.find((p) => p.tradeId === x.id)?.desk === 'Rates'), { leaves: leaves9.length });

  // U10 top 20 DV01 in the 5Y and 10Y+ buckets.
  r = await call('set_view', { patch: { columnFilters: [{ id: 'tenorBucket', value: ['5Y', '10Y+'] }], sorting: [{ id: 'dv01', desc: true }] }, replace: true });
  q = await call('query_view', { limit: 20 });
  want = BOOK.filter((p) => p.tenorBucket === '5Y' || p.tenorBucket === '10Y+').sort((a, b) => b.dv01 - a.dv01).slice(0, 20);
  check('U10 top 20 DV01 in 5Y/10Y+', JSON.stringify(q.body.rows.map((x: any) => x.id)) === JSON.stringify(want.map((p) => p.tradeId)), q.body.rows.map((x: any) => x.id).slice(0, 5));

  // U11 paging covers every row once.
  r = await call('set_view', { patch: {}, replace: true });
  q = await all(call);
  check('U11 pages cover all rows exactly once', q.rows.length === N && new Set(q.rows.map((x: any) => x.id)).size === N, { rows: q.rows.length });

  // U12 yield between 3% and 4% (pct units).
  r = await call('set_view', { patch: { columnFilters: [{ id: 'yield', value: [3, 4] }] }, replace: true });
  q = await call('query_view', { limit: 1 });
  check('U12 yield 3–4 (percent units)', q.body.total === BOOK.filter((p) => p.yield >= 3 && p.yield <= 4).length, { total: q.body.total });

  // U13 labels as names in the quick filter.
  r = await call('set_view', { patch: { globalFilter: 'ccy=EUR entity!=WF-US' }, replace: true });
  q = await call('query_view', { limit: 1 });
  check('U13 ccy=EUR entity!=WF-US', q.body.total === BOOK.filter((p) => p.currency === 'EUR' && p.legalEntity !== 'WF-US').length, { total: q.body.total, want: BOOK.filter((p) => p.currency === 'EUR' && p.legalEntity !== 'WF-US').length });

  // U14 patches merge slice by slice; replace starts over.
  await call('set_view', { patch: { grouping: ['desk'] }, replace: true });
  r = await call('set_view', { patch: { sorting: [{ id: 'notional', desc: true }] } });
  check('U14 a later patch keeps earlier slices', JSON.stringify(r.body.view?.grouping) === '["desk"]', r.body.view?.grouping);
  r = await call('set_view', { patch: { columnFilters: [{ id: 'desk', value: ['Rates'] }] } });
  r = await call('set_view', { patch: { columnFilters: [{ id: 'currency', value: ['USD'] }] } });
  check('U14 a slice is replaced, not appended (columnFilters keeps only the last)', r.body.view?.columnFilters?.length === 1, r.body.view?.columnFilters);
  r = await call('set_view', { patch: { sorting: [] }, replace: true });
  check('U14 replace resets every other slice', JSON.stringify(r.body.view?.grouping) === '[]', r.body.view);

  // U15 a query with its own view leaves the session view alone.
  await call('set_view', { patch: { grouping: ['desk'] }, replace: true });
  q = await call('query_view', { view: { grouping: ['currency'] }, limit: 2 });
  const d = await call('describe_view');
  check('U15 override answers its own view', q.body.rows?.[0]?.group?.column === 'currency', q.body);
  check('U15 session view untouched by override', JSON.stringify(d.body.view.grouping) === '["desk"]', d.body.view.grouping);

  // U16 count per desk.
  r = await call('set_view', { patch: { grouping: ['desk'], columnAggs: { notional: 'count' } }, replace: true });
  q = await all(call);
  check('U16 count aggregation', q.rows.every((g: any) => g.values.notional === desks.get(g.group.value)!.length) && /^\d[\d,]*$/.test(q.rows[0]?.display.notional), q.rows.slice(0, 2));

  // U17 trends: band on DV01 (declared limit) yes, on MTM no.
  r = await call('set_view', { patch: { columnFormats: { dv01: { trend: 'band' }, mtm: { trend: 'line' } } }, replace: true });
  check('U17 trend band on DV01 accepted', !r.isError, r.body);

  // U18 groups ordered by their aggregate when sorting by a measure.
  r = await call('set_view', { patch: { grouping: ['desk'], sorting: [{ id: 'notional', desc: true }] }, replace: true });
  q = await all(call);
  const deskOrder = [...desks].map(([k, xs]) => [k, sum(xs, 'notional')] as const).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  check('U18 groups sorted by Σ notional desc', JSON.stringify(q.rows.map((g: any) => g.group.value)) === JSON.stringify(deskOrder), { got: q.rows.map((g: any) => g.group.value), want: deskOrder });

  // U19 filter + group: counts and totals over what the filter keeps.
  r = await call('set_view', { patch: { grouping: ['desk'], columnFilters: [{ id: 'currency', value: ['USD'] }] }, replace: true });
  q = await all(call);
  const usd = BOOK.filter((p) => p.currency === 'USD');
  check('U19 grouped counts respect the filter', q.rows.every((g: any) => g.group.count === usd.filter((p) => p.desk === g.group.value).length) && q.total === usd.length, { total: q.total });
  check('U19 grand total respects the filter', near(q.totals.values.notional, sum(usd, 'notional')) && near(q.totals.values.yield, wavg(usd, 'yield', 'notional')), q.totals.values);

  // U20 pivot of measures [] means every measure.
  r = await call('set_view', { patch: { grouping: ['desk'], pivot: { column: 'product', values: [], buckets: ['Bond'] } }, replace: true });
  q = await call('query_view', { limit: 1 });
  check('U20 pivot values [] spreads every measure', ['notional', 'mtm', 'dv01', 'cs01', 'yield', 'wal'].every((m) => q.body.columns?.includes(`p:${m}:Bond`)), q.body.columns);
  const bondCredit = BOOK.filter((p) => p.product === 'Bond' && p.desk === q.body.rows[0]?.group.value);
  check('U20 pivoted yield is wavg within the bucket', near(q.body.rows[0]?.values['p:yield:Bond'], wavg(bondCredit, 'yield', 'notional')), { got: q.body.rows[0]?.values['p:yield:Bond'], want: wavg(bondCredit, 'yield', 'notional') });

  await close();
}

// ---------------------------------------------------------------- adversarial
async function adversarial() {
  const { call, close } = await session();
  await call('set_view', { patch: { grouping: ['desk'], sorting: [{ id: 'notional', desc: true }] }, replace: true });
  const before = JSON.stringify((await call('describe_view')).body.view);
  const refuse = async (name: string, patch: unknown, mention: RegExp) => {
    const r = await call('set_view', { patch });
    const text = JSON.stringify(r.body);
    check(`A ${name}: refused`, r.isError, r.body);
    check(`A ${name}: issue says why (${mention})`, mention.test(text), text.slice(0, 300));
  };
  await refuse('unknown grouping column', { grouping: ['region'] }, /region/);
  await refuse('non-groupable grouping', { grouping: ['tradeId'] }, /not groupable/);
  await refuse('wavg where no weight', { columnAggs: { dv01: 'wavg' } }, /wavg/);
  await refuse('ratio of mixed units', { computedColumns: [{ id: 'c:bad', label: 'Bad', op: 'ratio', of: ['mtm', 'yield'] }] }, /unit/);
  await refuse('set value on a measure', { columnFilters: [{ id: 'notional', value: ['big'] }] }, /range filter/);
  await refuse('range value on a dimension', { columnFilters: [{ id: 'desk', value: [0, 10] }] }, /set filter/);
  await refuse('string numbers in a range', { columnFilters: [{ id: 'notional', value: ['1e9', null] }] }, /range filter/);
  await refuse('pivot on a measure', { pivot: { column: 'notional', values: [], buckets: [] } }, /notional/);
  await refuse('pivot values naming a dimension', { pivot: { column: 'currency', values: ['desk'], buckets: [] } }, /not a measure/);
  await refuse('trend band without a limit', { columnFormats: { mtm: { trend: 'band' } } }, /limit/);
  await refuse('trend on a column with no history', { columnFormats: { yield: { trend: 'line' } } }, /history/);
  await refuse('scale on a percent', { columnFormats: { yield: { scale: 'bn' } } }, /scale/);
  await refuse('7 decimals', { columnFormats: { notional: { dp: 7 } } }, /decimals/);
  await refuse('five highlight rules', { columnFormats: { notional: { rules: Array.from({ length: 5 }, () => ({ op: '>', value: 1, emphasis: 'accent' })) } } }, /4 rules/);
  await refuse('nine calculated columns', { computedColumns: Array.from({ length: 9 }, (_, i) => ({ id: `c:x${i}`, label: `X${i}`, op: 'sum', of: ['mtm', 'notional'] })) }, /8 calculated/);
  await refuse('sorting an unknown column', { sorting: [{ id: 'region', desc: false }] }, /region/);
  await refuse('negative width', { columnSizing: { notional: -5 } }, /columnSizing/);
  await refuse('an unknown slice', { colour: 'red' }, /colour|Unrecognized/);
  await refuse('a format on a dimension', { columnFormats: { desk: { dp: 2 } } }, /dimension/);
  await refuse('calculated column over a calculated one', { computedColumns: [{ id: 'c:a', label: 'A', op: 'sum', of: ['mtm', 'notional'] }, { id: 'c:b', label: 'B', op: 'sum', of: ['c:a', 'notional'] }] }, /calculated column/);
  await refuse('rule value not a number', { columnFormats: { notional: { rules: [{ op: '>', value: '1bn', emphasis: 'accent' }] } } }, /value/);
  await refuse('semantic colour as emphasis', { columnFormats: { notional: { rules: [{ op: '>', value: 1, emphasis: 'red' }] } } }, /emphasis/);
  await refuse('aggregation on a dimension', { columnAggs: { desk: 'count' } }, /desk/);
  const after = JSON.stringify((await call('describe_view')).body.view);
  check('A session view unchanged by every refusal', before === after, { before: before.slice(0, 200), after: after.slice(0, 200) });

  // Protocol-level garbage.
  let r = await call('set_view', { patch: ['grouping'] });
  check('A patch as an array: refused', r.isError, r.body);
  r = await call('set_view', {});
  check('A no patch at all: refused', r.isError, r.body);
  r = await call('query_view', { limit: 5000 });
  check('A limit over 1000: refused', r.isError, r.body);
  r = await call('query_view', { offset: 10_000_000 });
  check('A offset past the end: empty, not an error', !r.isError && r.body.rows?.length === 0 && r.body.truncated === false, r.body);

  // Things an agent gets wrong that are accepted — do they at least do no harm, or say something?
  // Accepted-but-wrong is the failure: each must be refused, or accepted with a warning that names the slip.
  const soft = async (name: string, patch: unknown, verify: (body: any, q: any) => [boolean, unknown]) => {
    const s = await call('set_view', { patch, replace: true });
    const q = s.isError ? null : await call('query_view', { limit: 50 });
    const [ok, detail] = s.isError ? [true, 'refused'] : s.body.warnings?.length ? [true, 'warned'] : verify(s.body, q?.body);
    check(`S ${name}`, ok, detail);
  };
  let w = await call('set_view', { patch: { columnFilters: [{ id: 'currency', value: ['EUR'] }], globalFilter: 'book!=WF-US' }, replace: true });
  check('S book!=WF-US warns that WF-US is an entity', !w.isError && /legalEntity/.test(JSON.stringify(w.body.warnings ?? [])), w.body.warnings ?? w.body);
  w = await call('query_view', { limit: 1 });
  check('S the warning rides on query_view too', /WF-US/.test(JSON.stringify(w.body.warnings ?? [])), Object.keys(w.body));
  w = await call('set_view', { patch: { columnFilters: [{ id: 'desk', value: ['rates'] }] }, replace: true });
  check('S a wrongly-cased set value warns with the real values', /Rates/.test(JSON.stringify(w.body.warnings ?? [])), w.body.warnings);
  const dsc = await call('describe_view');
  const deskCol = dsc.body.contract.columns.find((c: any) => c.id === 'desk');
  const cpCol = dsc.body.contract.columns.find((c: any) => c.id === 'counterparty');
  check('S describe_view lists a small dimension’s values', JSON.stringify([...deskCol.values].sort()) === JSON.stringify(['Credit', 'FX', 'Funding', 'Mortgages', 'Rates']), deskCol);
  check('S describe_view gives a large dimension’s count, not its values', cpCol.distinct === 320 && !cpCol.values, cpCol);
  w = await call('set_view', { patch: { grouping: ['desk'], expanded: { 'legalEntity:WF-US': true } }, replace: true });
  check('S expanded key off the grouping is refused', w.isError && /level 1 must be/.test(JSON.stringify(w.body)), w.body);
  w = await call('set_view', { patch: { computedColumns: [{ id: 'c:mtm-pct', label: 'X', op: 'ratio', of: ['mtm', 'notional'] }] }, replace: true });
  check('S a bad slug says what a slug is', w.isError && /lowercase letters, digits or underscores/.test(JSON.stringify(w.body)), w.body);
  w = await call('set_view', { patch: { columnFormats: { notional: { rules: [{ op: '>', value: 2e9, emphasis: 'strong' }] } }, sorting: [{ id: 'notional', desc: true }] }, replace: true });
  w = await call('query_view', { limit: 2 });
  check('S query_view reports a rule’s emphasis per cell', w.body.rows?.[0]?.emphasis?.notional === 'strong', w.body.rows?.[0]);
  await soft('duplicate grouping column is refused or collapsed', { grouping: ['desk', 'desk'] }, (b) => [JSON.stringify(b.view.grouping) === '["desk"]', b.view.grouping]);
  await soft('duplicate sort keys refused or collapsed', { sorting: [{ id: 'desk', desc: false }, { id: 'desk', desc: true }] }, (b) => [b.view.sorting.length === 1, b.view.sorting]);
  await soft('expanded naming no group is refused', { grouping: ['desk'], expanded: { 'desk:Nonesuch': true } }, (b) => [false, b.view.expanded]);
  await soft('pivot bucket the data never has is refused or flagged', { grouping: ['desk'], pivot: { column: 'currency', values: ['notional'], buckets: ['ZZZ'] } }, (b, q) => [false, q?.columns]);
  await soft('quick filter on an unknown column is refused or flagged', { globalFilter: 'region:EMEA' }, (b, q) => [q?.total !== 0, { total: q?.total }]);
  await soft('quick filter with a non-number on a measure is refused or flagged', { globalFilter: 'notional>abc' }, (b, q) => [false, { total: q?.total }]);
  await soft('grouping a hidden column', { grouping: ['desk'], columnVisibility: { desk: false } }, (b, q) => [q?.rows?.[0]?.group?.column === 'desk', q?.rows?.[0]]);
  await soft('columnOrder with an id twice', { columnOrder: ['desk', 'desk'] }, (b) => [false, b.view.columnOrder]);
  await soft('pinning a column at both ends', { columnPinning: { start: ['desk'], end: ['desk'] } }, (b) => [false, b.view.columnPinning]);
  await soft('filter on the same column twice', { columnFilters: [{ id: 'desk', value: ['Rates'] }, { id: 'desk', value: ['FX'] }] }, (b, q) => [false, { total: q?.total, filters: b.view.columnFilters }]);
  await close();
}

// ---------------------------------------------------------------- scale
async function scale() {
  const { call, close } = await session(50_000);
  const t: Record<string, number> = {};
  let r = await call('describe_view'); t.describe = r.ms;
  r = await call('set_view', { patch: { grouping: ['desk', 'legalEntity', 'currency'] }, replace: true });
  r = await call('query_view', { limit: 1000, expandAll: true }); t.group3_expandAll_1000 = r.ms;
  const bytes = r.bytes;
  r = await call('set_view', { patch: { grouping: ['desk'], pivot: { column: 'counterparty', values: ['notional'], buckets: [] } }, replace: true });
  r = await call('query_view', { limit: 10 }); t.pivot_320_buckets = r.ms; const pivotCols = r.body.columns?.length; const pivotBytes = r.bytes;
  r = await call('set_view', { patch: { globalFilter: 'credit 5y', sorting: [{ id: 'dv01', desc: true }] }, replace: true });
  r = await call('query_view', { limit: 1000 }); t.search_sort_1000 = r.ms;
  check('P 50k rows: grouped expandAll page under 5s', t.group3_expandAll_1000 < 5000, t);
  check('P 50k rows: a 1000-row answer stays under 2MB', bytes < 2_000_000, { bytes });
  check('P pivot by a 320-value dimension is bounded or refused', pivotCols === undefined || pivotCols < 200, { pivotCols, pivotBytes, ms: t.pivot_320_buckets });
  console.error('TIMINGS', JSON.stringify({ ...t, bytes, pivotCols, pivotBytes }));
  await close();
}

await useCases();
await adversarial();
await scale();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
