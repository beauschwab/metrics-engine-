/**
 * spark-line@1, spark-band@1, spark-column@1, spark-range@1 (ADR-89) — one
 * number and the window it came from.
 *
 * The card is a KPI tile that shows its history: the latest value large, the
 * window said in words beneath it, and the sparkline under both. The words
 * come first because they are the reading; the chart is there to be pointed
 * at. Pointing at it — or tabbing to it and using the arrow keys — snaps a
 * crosshair to the nearest real day and says that day: the date, the value,
 * and what the value means in this style (`sparkTip`).
 *
 * The style is the widget type rather than an option, because the spec has
 * no options field and should not grow one for this: each style answers a
 * different question, and a lint rule (GAUGE-01 for the band) can only hold
 * a widget to its question if the question is in the type.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { parseMetricRef } from 'chartroom-spec';
import type { SeriesPoint, WidgetProps } from './types';
import { formatValue } from './format';
import {
  SPARK_LABELS, nearestMark, sparkJudgment, sparkScene, sparkStats, sparkSummary, sparkTip, stepMark,
  type SparkLimit, type SparkMark, type SparkStyle,
} from './spark';

/**
 * The box's measured size, so the marks are drawn in real pixels — circles
 * stay round, hairlines stay hairlines — and the chart takes the room the
 * card has rather than a fixed strip of it.
 */
function useSize(fallback: { width: number; height: number }, fixedHeight?: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      if (el.clientWidth <= 0) return;
      const width = Math.max(40, Math.round(el.clientWidth));
      const height = fixedHeight ?? Math.max(28, Math.round(el.clientHeight || fallback.height));
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedHeight]);
  return [ref, size] as const;
}

export interface SparklineProps {
  points: readonly SeriesPoint[];
  style: SparkStyle;
  format: string;
  decimals?: number;
  /** `band` only: the governed limit and its safe side. */
  limit?: SparkLimit;
  /** A fixed height in px; omitted, the chart fills its box's height. */
  height?: number;
  /** What the chart is of, for its accessible name. */
  label: string;
}

/** The sparkline itself: marks from `sparkScene`, a crosshair that snaps, a tooltip that says the day. */
export function Sparkline({ points, style, format, decimals, limit, height: fixed, label }: SparklineProps) {
  const [box, { width, height }] = useSize({ width: 240, height: fixed ?? 44 }, fixed);
  const scene = useMemo(() => sparkScene(points, style, { width, height, limit }), [points, style, width, height, limit]);
  const [active, setActive] = useState<SparkMark | null>(null);
  const tipId = useId();
  // A new window (or a resize) moves every mark: an index kept across it would point at the wrong day.
  useEffect(() => setActive(null), [scene]);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setActive(nearestMark(scene.marks, x));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const byDate = [...scene.marks].sort((a, b) => a.i - b.i);
    let next: SparkMark | null | undefined;
    if (e.key === 'ArrowLeft') next = stepMark(scene.marks, active, -1);
    else if (e.key === 'ArrowRight') next = stepMark(scene.marks, active, 1);
    else if (e.key === 'Home') next = byDate[0] ?? null;
    else if (e.key === 'End') next = byDate[byDate.length - 1] ?? null;
    else if (e.key === 'Escape') next = null;
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
  };
  const tip = active ? sparkTip(points, active, style, format, { decimals, limit }) : null;
  const last = scene.last;

  return (
    <div className="cr-spark" ref={box} data-style={style} data-fixed={fixed !== undefined || undefined} style={fixed !== undefined ? { height: fixed } : undefined}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        tabIndex={0}
        aria-label={`${label}, ${SPARK_LABELS[style].toLowerCase()}: ${sparkSummary(points, format, decimals)}`}
        aria-describedby={tip ? tipId : undefined}
        data-slot="sparkline"
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? last)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {scene.limit && (
          <>
            <rect className="cr-spark-zone" x={0} y={scene.limit.zone.y} width={width} height={scene.limit.zone.h} />
            <line className="cr-spark-limit" x1={0} x2={width} y1={scene.limit.y} y2={scene.limit.y} />
          </>
        )}
        {scene.strip && (
          <line className="cr-spark-track" x1={scene.strip.x0} x2={scene.strip.x1} y1={scene.strip.y} y2={scene.strip.y} />
        )}
        {scene.baseline !== undefined && (
          <line className="cr-spark-zero" x1={0} x2={width} y1={scene.baseline} y2={scene.baseline} />
        )}
        {scene.columns?.map((c) => (
          <rect
            key={c.i}
            className="cr-spark-col"
            data-negative={c.negative || undefined}
            data-current={c.i === last?.i || undefined}
            data-active={c.i === active?.i || undefined}
            x={c.x} y={c.y} width={c.w} height={c.h}
          />
        ))}
        {scene.line && <path className="cr-spark-line" d={scene.line} />}
        {style === 'band' && scene.marks.filter((m) => m.breach).map((m) => (
          <circle key={m.i} className="cr-spark-breach" cx={m.x} cy={m.y} r={2} />
        ))}
        {style === 'range' && scene.marks.map((m) => (
          <line
            key={m.i}
            className="cr-spark-tick"
            data-current={m.i === last?.i || undefined}
            data-active={m.i === active?.i || undefined}
            x1={m.x} x2={m.x}
            y1={m.y - (m.i === last?.i ? height / 2 - 4 : height / 5)}
            y2={m.y + (m.i === last?.i ? height / 2 - 4 : height / 5)}
          />
        ))}
        {/* The crosshair: a hairline at the day, the day's own point on it. */}
        {active && style !== 'range' && (
          <line className="cr-spark-crosshair" x1={active.x} x2={active.x} y1={0} y2={height} />
        )}
        {last && (style === 'line' || style === 'band') && (
          <circle className="cr-spark-dot" data-breach={last.breach || undefined} cx={last.x} cy={last.y} r={3} />
        )}
        {active && style !== 'column' && (
          <circle className="cr-spark-active" data-breach={active.breach || undefined} cx={active.x} cy={active.y} r={3.5} />
        )}
      </svg>
      {tip && active && (
        <div
          id={tipId}
          role="tooltip"
          className="cr-spark-tip"
          data-slot="spark-tip"
          // The anchor slides from the tooltip's left edge to its right as the
          // day moves across the chart, so the box never leaves the card.
          // Above the chart, over the headline it momentarily replaces: inside
          // the card, which clips anything that leaves it, and never over the point.
          style={{ left: active.x, bottom: height + 4, transform: `translateX(-${Math.round((active.x / width) * 100)}%)` }}
        >
          <span className="cr-spark-tip-date">{tip.date}</span>
          <span className="cr-spark-tip-value tnum">{tip.value}</span>
          {tip.note && <span className="cr-spark-tip-note tnum" data-state={tip.state}>{tip.note}</span>}
        </div>
      )}
    </div>
  );
}

function SparkCard({ instance, data, status, error, style }: WidgetProps & { style: SparkStyle }) {
  if (status === 'loading') return <div className="cr-skeleton cr-skeleton-kpi" />;
  if (status === 'error') return <div className="cr-widget-error">{error || 'query failed'}</div>;
  const points = data?.series?.[0]?.points ?? [];
  const stats = sparkStats(points);
  if (!data || !stats.last) return <div className="cr-widget-empty">no points in the window</div>;

  const decimals = instance.format?.decimals;
  // The band's limit is the threshold the binding governs, on the side it
  // declares. Without both there is nothing honest to shade — GAUGE-01
  // blocks the spec, and the card says why rather than drawing a guess.
  const side = instance.bind.compare?.limit;
  const limit: SparkLimit | undefined = data.compare?.style === 'threshold' && side && Number.isFinite(data.compare.value)
    ? { value: data.compare.value, side, label: data.compare.label }
    : undefined;
  if (style === 'band' && !limit) {
    return <div className="cr-widget-empty">bind a governed limit with its safe side to draw this band</div>;
  }
  const judgment = sparkJudgment(points, style, data.format, { decimals, limit });
  const label = instance.title || parseMetricRef(instance.bind.metric)?.measure || 'value';

  return (
    <div className="cr-sparkcard" data-emphasis={instance.format?.emphasis || 'neutral'} data-style={style}>
      <div className="cr-sparkcard-head">
        <span className="cr-sparkcard-value tnum" title={formatValue(stats.last.value, data.format, decimals)}>
          {formatValue(stats.last.value, data.format, decimals)}
        </span>
        {judgment && (
          <span className="cr-kpi-judgment cr-sparkcard-judgment tnum" data-state={judgment.state}>{judgment.text}</span>
        )}
      </div>
      <Sparkline points={points} style={style} format={data.format} decimals={decimals} limit={limit} label={label} />
    </div>
  );
}

export const SparkLineCard = (p: WidgetProps) => <SparkCard {...p} style="line" />;
export const SparkBandCard = (p: WidgetProps) => <SparkCard {...p} style="band" />;
export const SparkColumnCard = (p: WidgetProps) => <SparkCard {...p} style="column" />;
export const SparkRangeCard = (p: WidgetProps) => <SparkCard {...p} style="range" />;
