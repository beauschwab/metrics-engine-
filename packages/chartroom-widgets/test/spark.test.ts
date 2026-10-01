/**
 * Sparklines (ADR-89): the marks are where the numbers say, the crosshair
 * snaps to a real day, and the words — tooltip, judgment, summary — say what
 * each style is for. Rendering is the studio's e2e; this is the arithmetic.
 */

import { describe, expect, it } from 'vitest';
import {
  breaches, limitInReach, nearestMark, rangePosition, sparkExtent, sparkJudgment, sparkScene, sparkStats, sparkSummary, sparkTip, stepMark,
  type SparkLimit,
} from '../src/spark';

const day = (i: number) => `2026-09-${String(i + 1).padStart(2, '0')}`;
const series = (values: number[]) => values.map((value, i) => ({ date: day(i), value }));
const FLOOR: SparkLimit = { value: 100, side: 'floor', label: 'lcr_floor' };

describe('the scene', () => {
  it('draws a line through every finite point, the last one current, inside the pad', () => {
    const pts = series([110, 104, 98, 102, 107]);
    const s = sparkScene(pts, 'line', { width: 100, height: 40 });
    expect(s.marks).toHaveLength(5);
    expect(s.last?.i).toBe(4);
    expect(s.line?.match(/M/g)).toHaveLength(1);
    for (const m of s.marks) {
      expect(m.x).toBeGreaterThanOrEqual(3);
      expect(m.x).toBeLessThanOrEqual(97);
      expect(m.y).toBeGreaterThanOrEqual(3);
      expect(m.y).toBeLessThanOrEqual(37);
    }
    // The high is at the top and the low at the bottom — the extent is the data's own.
    expect(s.marks[0].y).toBeCloseTo(3);
    expect(s.marks[2].y).toBeCloseTo(37);
  });

  it('lifts the pen at a missing day rather than drawing a straight line across it', () => {
    const s = sparkScene(series([1, 2, NaN, 4, 5]), 'line', { width: 100, height: 40 });
    expect(s.line?.match(/M/g)).toHaveLength(2);
    expect(s.marks.map((m) => m.i)).toEqual([0, 1, 3, 4]);
  });

  it('puts the limit on the chart and shades its breach side — below a floor, above a ceiling', () => {
    const pts = series([110, 104, 98, 102, 107]);
    const floor = sparkScene(pts, 'band', { width: 100, height: 40, limit: FLOOR });
    expect(floor.limit).toBeDefined();
    expect(floor.limit!.zone.y).toBeCloseTo(floor.limit!.y);
    expect(floor.limit!.zone.y + floor.limit!.zone.h).toBeCloseTo(40);
    expect(floor.marks.filter((m) => m.breach).map((m) => m.i)).toEqual([2]);

    const ceiling = sparkScene(pts, 'band', { width: 100, height: 40, limit: { ...FLOOR, side: 'ceiling' } });
    expect(ceiling.limit!.zone.y).toBe(0);
    expect(ceiling.limit!.zone.h).toBeCloseTo(ceiling.limit!.y);
    expect(ceiling.marks.filter((m) => m.breach).map((m) => m.i)).toEqual([0, 1, 3, 4]);
  });

  it('keeps a limit just outside the data on the chart', () => {
    const s = sparkScene(series([110, 115, 120]), 'band', { width: 100, height: 40, limit: FLOOR });
    expect(s.limitOff).toBeUndefined();
    expect(s.limit!.y).toBeCloseTo(37);
    expect(s.limit!.y).toBeGreaterThan(s.marks[0].y);
  });

  it('leaves a far limit off the chart rather than flatten the line against it, and says which side', () => {
    const far = sparkScene(series([2800, 2900, 2750]), 'band', { width: 100, height: 40, limit: { value: 250_000, side: 'ceiling', label: 'dv01' } });
    expect(far.limit).toBeUndefined();
    expect(far.limitOff).toBe('above');
    // The line keeps its own shape: the high is at the top, the low at the bottom.
    expect(far.marks[1].y).toBeCloseTo(3);
    expect(far.marks[2].y).toBeCloseTo(37);
    expect(sparkScene(series([120, 125, 130]), 'band', { width: 100, height: 40, limit: { ...FLOOR, value: 50 } }).limitOff).toBe('below');
    expect(limitInReach([120, 130], 100)).toBe(false);
    expect(limitInReach([120, 130], 105)).toBe(true);
    expect(limitInReach([100, 100], 95)).toBe(true);
  });

  it('draws columns from zero, so a negative day hangs below the line and a zero day is a hairline', () => {
    const s = sparkScene(series([2, -1, 0, 3]), 'column', { width: 100, height: 40 });
    const [up, down, flat] = s.columns!;
    expect(up.y + up.h).toBeCloseTo(s.baseline!);
    expect(down.negative).toBe(true);
    expect(down.y).toBeCloseTo(s.baseline!);
    expect(flat.h).toBe(1);
    // Every bar stays inside the chart.
    for (const c of s.columns!) {
      expect(c.x).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(97 + 1e-9);
    }
  });

  it('includes zero in a column chart of all-positive values, and not in a line', () => {
    const pts = series([50, 60, 55]);
    expect(sparkScene(pts, 'column', { width: 100, height: 40 }).baseline).toBeCloseTo(37);
    expect(sparkExtent([50, 60, 55])).toEqual({ min: 50, max: 60 });
  });

  it('lays a range strip out by value, low at the left and high at the right', () => {
    const s = sparkScene(series([5, 9, 1, 7]), 'range', { width: 100, height: 20 });
    const byI = new Map(s.marks.map((m) => [m.i, m]));
    expect(byI.get(2)!.x).toBeCloseTo(3);
    expect(byI.get(1)!.x).toBeCloseTo(97);
    expect(s.strip).toEqual({ x0: 3, x1: 97, y: 10 });
    expect(s.last?.i).toBe(3);
  });

  it('spaces days by time, so a weekend reads as a gap', () => {
    const pts = [
      { date: '2026-09-03', value: 1 }, { date: '2026-09-04', value: 2 }, { date: '2026-09-07', value: 3 },
    ];
    const s = sparkScene(pts, 'line', { width: 104, height: 40 });
    const gap1 = s.marks[1].x - s.marks[0].x;
    const gap2 = s.marks[2].x - s.marks[1].x;
    expect(gap2).toBeCloseTo(gap1 * 3);
  });

  it('draws nothing for an empty series, and a flat one in the middle', () => {
    expect(sparkScene([], 'line', { width: 100, height: 40 }).marks).toEqual([]);
    const flat = sparkScene(series([7, 7, 7]), 'line', { width: 100, height: 40 });
    expect(flat.marks.every((m) => Math.abs(m.y - 20) < 1e-9)).toBe(true);
  });
});

describe('the crosshair', () => {
  const s = sparkScene(series([1, 2, 3, 4, 5]), 'line', { width: 100, height: 40 });

  it('snaps to the nearest day and never between two', () => {
    expect(nearestMark(s.marks, 0)?.i).toBe(0);
    expect(nearestMark(s.marks, 100)?.i).toBe(4);
    expect(nearestMark(s.marks, s.marks[2].x + 3)?.i).toBe(2);
  });

  it('steps by day from the keyboard, clamped at the ends, starting from now', () => {
    expect(stepMark(s.marks, null, -1)?.i).toBe(4);
    expect(stepMark(s.marks, s.marks[4], 1)?.i).toBe(4);
    expect(stepMark(s.marks, s.marks[4], -1)?.i).toBe(3);
    expect(stepMark(s.marks, s.marks[0], -1)?.i).toBe(0);
  });

  it('steps by date on a range strip, whose marks are laid out by value', () => {
    const r = sparkScene(series([5, 9, 1]), 'range', { width: 100, height: 20 });
    expect(stepMark(r.marks, r.marks.find((m) => m.i === 1)!, 1)?.i).toBe(2);
  });
});

describe('the words', () => {
  const pts = series([110, 104, 98, 102, 107]);

  it('says the move since the window opened on a line', () => {
    const s = sparkScene(pts, 'line', { width: 100, height: 40 });
    const tip = sparkTip(pts, s.marks[2], 'line', 'percent_1dp');
    expect(tip).toEqual({ date: '2026-09-03', value: '98.0%', note: '-12.0pp since 09-01' });
    expect(sparkTip(pts, s.marks[0], 'line', 'percent_1dp').note).toBeUndefined();
  });

  it('names the side of the limit on a band, and calls a breach a breach', () => {
    const s = sparkScene(pts, 'band', { width: 100, height: 40, limit: FLOOR });
    expect(sparkTip(pts, s.marks[2], 'band', 'percent_1dp', { limit: FLOOR }))
      .toEqual({ date: '2026-09-03', value: '98.0%', note: 'below floor lcr_floor 100.0% — breach', state: 'breach' });
    expect(sparkTip(pts, s.marks[4], 'band', 'percent_1dp', { limit: FLOOR }).state).toBe('ok');
  });

  it('says the move from the prior day on a column', () => {
    const s = sparkScene(pts, 'column', { width: 100, height: 40 });
    expect(sparkTip(pts, s.marks[1], 'column', 'percent_1dp').note).toBe('-6.0pp vs 09-01');
  });

  it('places a day in its range on a strip', () => {
    const s = sparkScene(pts, 'range', { width: 100, height: 40 });
    const at = (i: number) => s.marks.find((m) => m.i === i)!;
    expect(sparkTip(pts, at(0), 'range', 'percent_1dp').note).toBe("the window's high");
    expect(sparkTip(pts, at(2), 'range', 'percent_1dp').note).toBe("the window's low");
    expect(sparkTip(pts, at(4), 'range', 'percent_1dp').note).toBe('75% of the way from low 98.0% to high 110.0%');
  });

  it('judges the window in words for the card', () => {
    expect(sparkJudgment(pts, 'line', 'percent_1dp')).toEqual({ text: '-3.0pp since 09-01', state: 'down' });
    expect(sparkJudgment(pts, 'band', 'percent_1dp', { limit: FLOOR }))
      .toEqual({ text: 'above floor 100.0% · 1 breach since 09-01', state: 'ok' });
    expect(sparkJudgment(series([101, 99]), 'band', 'percent_1dp', { limit: FLOOR })?.state).toBe('breach');
    expect(sparkJudgment(pts, 'range', 'percent_1dp')?.text).toBe('75% of its range since 09-01 · low 98.0%, high 110.0%');
    expect(sparkJudgment([], 'line', 'percent_1dp')).toBeNull();
  });

  it('summarises the window with the dates of its low and high', () => {
    expect(sparkSummary(pts, 'percent_1dp'))
      .toBe('5 points, 09-01 to 09-05: latest 107.0%, low 98.0% on 09-03, high 110.0% on 09-01');
    expect(sparkSummary([], 'percent_1dp')).toBe('no points in the window');
  });

  it('says numbers in the host’s own readings when it brings them', () => {
    const grid = { value: (v: number) => `${v.toFixed(1)} bps`, delta: (v: number, from: number) => `${v - from >= 0 ? '+' : ''}${(v - from).toFixed(1)} bps` };
    const s = sparkScene(pts, 'line', { width: 100, height: 40 });
    expect(sparkTip(pts, s.marks[4], 'line', grid)).toEqual({ date: '2026-09-05', value: '107.0 bps', note: '-3.0 bps since 09-01' });
    expect(sparkJudgment(pts, 'range', grid)?.text).toBe('75% of its range since 09-01 · low 98.0 bps, high 110.0 bps');
    expect(sparkSummary(pts, grid)).toContain('latest 107.0 bps');
  });

  it('treats a value on the limit as safe', () => {
    expect(breaches(100, FLOOR)).toBe(false);
    expect(breaches(100, { ...FLOOR, side: 'ceiling' })).toBe(false);
    expect(rangePosition(5, sparkStats(series([5, 5])))).toBe(50);
  });
});
