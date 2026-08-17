/**
 * E1.5, the hard gate: the two dogfood dashboards exist, bind only measures
 * the registry really carries, lint with zero BLOCKs, and answer queries with
 * real numbers. If someone renames a measure or a dim, this is the test that
 * says the dogfood no longer describes the registry.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { migrate, openSqlite, type Db } from '../../../server/db';
import { chartroomDialect } from '../src/dialect';
import { fetchRegistryState, type RegistryState } from '../src/keel';
import { QueryService } from '../src/query';
import { ChartroomRepository } from '../src/repository';
import { seedDogfood } from '../src/seed';

let db: Db;
let repo: ChartroomRepository;
let state: RegistryState;

beforeAll(async () => {
  db = await openSqlite(':memory:', chartroomDialect('sqlite'));
  await migrate(db);
  repo = new ChartroomRepository(db);
  state = await fetchRegistryState();
});

afterAll(async () => db.close());

describe('the dogfood seed', () => {
  it('seeds both boards once, and never again', async () => {
    expect(await seedDogfood(repo, state)).toEqual(['lcr-monitor', 'limit-board']);
    expect(await seedDogfood(repo, state)).toEqual([]);
  });

  it('both lint clean of BLOCKs against fresh contracts', async () => {
    for (const id of ['lcr-monitor', 'limit-board']) {
      const v = await repo.latest(id);
      expect(v, id).toBeTruthy();
      const blocks = v!.lintReport.findings.filter((f) => f.severity === 'BLOCK');
      expect(blocks, `${id}: ${blocks.map((b) => `${b.rule} ${b.message}`).join(' | ')}`)
        .toEqual([]);
    }
  });

  it('every widget answers with real numbers', async () => {
    const service = new QueryService({ state });
    for (const id of ['lcr-monitor', 'limit-board']) {
      const v = await repo.latest(id);
      for (const w of v!.spec.widgets) {
        const r = await service.run({
          metric: w.bind.metric,
          ...(w.bind.dims ? { dims: w.bind.dims } : {}),
          ...(w.bind.window ? { window: w.bind.window } : {}),
          ...(w.bind.max_cells !== undefined ? { max_cells: w.bind.max_cells } : {}),
        });
        if (r.kind === 'scalar') expect(Number.isFinite(r.value), `${id}/${w.id}`).toBe(true);
        if (r.kind === 'groups') expect(r.rows.length, `${id}/${w.id}`).toBeGreaterThan(0);
        if (r.kind === 'series') {
          expect(r.series[0].points.some((p) => Number.isFinite(p.value)), `${id}/${w.id}`).toBe(true);
        }
      }
    }
  });
});
