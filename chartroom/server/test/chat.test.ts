/**
 * The embedded chat, minus the model: the tools execute against the real
 * governed API under the chat's agent identity (so the entitlements are
 * tested for real), and the loop degrades honestly without a key. The live
 * model path follows the critics' posture — exercised only when
 * ANTHROPIC_API_KEY is present, skipped loudly otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, openSqlite, type Db } from '../../../server/db';
import { ContractCache, handle, type ApiDeps } from '../src/api';
import { CHAT_TOOLS, TOOLS_BY_NAME, SYSTEM_PROMPT, runChatTurn, type ChatEvent } from '../src/chat';
import { chartroomDialect } from '../src/dialect';
import { fetchRegistryState } from '../src/keel';
import { QueryService } from '../src/query';
import { ChartroomRepository } from '../src/repository';

let db: Db;
let deps: ApiDeps;
let ref: (m: string) => string;

beforeAll(async () => {
  db = await openSqlite(':memory:', chartroomDialect('sqlite'));
  await migrate(db);
  const state = await fetchRegistryState();
  const rev = state.docs.find((d) => d.name === 'liquidity_pit')!.revision;
  ref = (m: string) => `keel://liquidity_pit.${m}@${rev}`;
  deps = {
    repo: new ChartroomRepository(db),
    contracts: new ContractCache(60_000),
    queries: new QueryService({ state }),
  };
});

afterAll(async () => {
  await db.close();
});

describe('the toolset', () => {
  it('holds no approve, decide, or promote tool — the third surface keeps the seam', () => {
    const names = CHAT_TOOLS.map((t) => t.def.name);
    expect(names.filter((n) => n.includes('approve') || n.includes('decide')
      || n === 'promote_dashboard')).toEqual([]);
    // And the instructions say so, plainly.
    expect(SYSTEM_PROMPT).toContain('You cannot approve');
  });

  it('describes each tool beyond a stub', () => {
    for (const t of CHAT_TOOLS) {
      expect(t.def.description!.length, t.def.name).toBeGreaterThan(60);
    }
  });

  it('searches metrics and previews numbers through the governed routes', async () => {
    const found = await TOOLS_BY_NAME.get('search_metrics')!.run({ query: 'lcr_pct' }, deps) as {
      count: number;
    };
    expect(found.count).toBeGreaterThan(0);

    const preview = await TOOLS_BY_NAME.get('preview_query')!.run(
      { metric: ref('lcr_pct') }, deps,
    ) as { kind: string; value: number };
    expect(preview.kind).toBe('scalar');
    expect(Number.isFinite(preview.value)).toBe(true);
  });

  it('runs as an agent: composition before an approved brief is refused, and the refusal is a result', async () => {
    await TOOLS_BY_NAME.get('create_dashboard')!.run({ id: 'chat-board', title: 'Chat board' }, deps);
    const spec = {
      chartroom: '0.1',
      dashboard: {
        id: 'chat-board', title: 'Chat board', pattern: { none: { justification: 'chat test dashboard' } },
        audience: 'alm-analyst', cadence: 'eod', status: 'draft',
      },
      context: {},
      layout: { grid: { cols: 12, row_height: 96 } },
      widgets: [{
        id: 'tile', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
        bind: { metric: ref('lcr_pct') },
      }],
      interactions: [],
    };
    await expect(TOOLS_BY_NAME.get('save_dashboard')!.run(
      { dashboard_id: 'chat-board', spec }, deps,
    )).rejects.toThrow(/approval|brief/i);
  });

  it('cannot approve even by talking to the API directly — identity, not tool absence', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/chat-board/brief/approve',
      identity: 'agent:chat-direct',
    }, deps);
    expect(r.status).toBe(403);
  });
});

describe('the loop without a model', () => {
  it('degrades to an honest unavailable event, not an error', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const events: ChatEvent[] = [];
      await runChatTurn({ messages: [{ role: 'user', text: 'hello' }] }, deps, (e) => events.push(e));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('unavailable');
      expect(String(events[0].message)).toContain('deterministic');
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('the loop with a model (needs ANTHROPIC_API_KEY)', () => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  it.skipIf(!hasKey)('answers a registry question by actually using a tool', async () => {
    const events: ChatEvent[] = [];
    await runChatTurn({
      messages: [{ role: 'user', text: 'What LCR metrics exist in the registry? Use your tools.' }],
    }, deps, (e) => events.push(e));
    expect(events.some((e) => e.type === 'tool_start')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  }, 120_000);
  if (!hasKey) {
    it('skipped the live-model checks — set ANTHROPIC_API_KEY to run them', () => {
      expect(hasKey).toBe(false);
    });
  }
});
