import { describe, expect, it } from 'vitest';
import { diffSpecs } from '../src/index';
import { baseSpec } from './fixtures';

describe('diffSpecs speaks reviewer vocabulary', () => {
  it('reports identical specs as identical', () => {
    expect(diffSpecs(baseSpec(), baseSpec()).identical).toBe(true);
  });

  it('sees adds, removes, moves and resizes', () => {
    const a = baseSpec();
    const b = baseSpec();
    b.widgets.push({ ...b.widgets[0], id: 'extra', pos: { x: 0, y: 4, w: 3, h: 2 } });
    b.widgets[0] = { ...b.widgets[0], pos: { ...b.widgets[0].pos, x: 6 } };
    b.widgets[1] = { ...b.widgets[1], pos: { ...b.widgets[1].pos, h: 6 } };
    const d = diffSpecs(a, b);
    expect(d.added).toEqual(['extra']);
    expect(d.moved).toEqual(['lcr-tile']);
    expect(d.resized).toEqual(['lcr-trend']);
    expect(d.identical).toBe(false);
  });

  it('tells a version bump apart from a rebind', () => {
    const a = baseSpec();
    const bumped = baseSpec();
    bumped.widgets[0].bind.metric = 'keel://liquidity_pit.lcr_pct@5';
    const d1 = diffSpecs(a, bumped);
    expect(d1.versionBumped).toEqual([
      { id: 'lcr-tile', metric: 'liquidity_pit.lcr_pct', from: 4, to: 5 },
    ]);
    expect(d1.rebound).toEqual([]);

    const rebound = baseSpec();
    rebound.widgets[0].bind.metric = 'keel://liquidity_pit.hqla_total@4';
    const d2 = diffSpecs(a, rebound);
    expect(d2.rebound).toHaveLength(1);
    expect(d2.versionBumped).toEqual([]);
  });

  it('a bump that also changes the rest of the binding reports both', () => {
    const a = baseSpec();
    const b = baseSpec();
    b.widgets[1].bind.metric = 'keel://liquidity_pit.lcr_pct@5';
    b.widgets[1].bind.window = { trailing: '30d' };
    const d = diffSpecs(a, b);
    expect(d.versionBumped).toHaveLength(1);
    expect(d.rebound).toHaveLength(1);
  });

  it('sees context and dashboard-level changes', () => {
    const a = baseSpec();
    const b = baseSpec();
    b.context = { entity: { dim: 'entity_id', default: 'WF-EMEA' } };
    b.dashboard = { ...b.dashboard, status: 'team' };
    const d = diffSpecs(a, b);
    expect(d.contextChanged).toEqual(['entity']);
    expect(d.dashboardChanged).toEqual(['status']);
  });
});
