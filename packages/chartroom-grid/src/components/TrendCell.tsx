/**
 * A trend cell (ADR-89): the row's history as a sparkline, then the number.
 *
 * The marks are the sparkline cards' (`sparkScene`), drawn small; the words
 * are the cards' too (`sparkTip`), said through the column's own meta. The
 * tooltip is portalled to the page: a table body is a scroll box, and a tip
 * drawn inside it would be clipped by the very row it describes. Pointing
 * snaps to the nearest day; focusing the sparkline and using the arrow keys
 * reads the same days, so the history is not a pointer-only reading.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  SPARK_LABELS, nearestMark, sparkScene, sparkSummary, sparkTip, stepMark,
  type SeriesPoint, type SparkMark, type SparkStyle,
} from 'chartroom-widgets/spark';
import type { ColumnMeta } from '../grid/meta';
import { TREND_SIZE, trendReadings } from '../grid/trend';
import { cn } from '../lib/utils';

const { width: W, height: H } = TREND_SIZE;

export function TrendCell({ points, style, meta, label, children }: {
  points: readonly SeriesPoint[];
  style: SparkStyle;
  meta: ColumnMeta;
  /** The row and column, for the chart's accessible name. */
  label: string;
  /** The value, as the plain cell would say it. */
  children: ReactNode;
}) {
  const scene = useMemo(() => sparkScene(points, style, { width: W, height: H, limit: meta.limit, pad: 2 }), [points, style, meta.limit]);
  const readings = useMemo(() => trendReadings(meta), [meta]);
  const [active, setActive] = useState<SparkMark | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tipId = useId();
  useEffect(() => setActive(null), [scene]);

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    let next: SparkMark | null | undefined;
    if (e.key === 'ArrowLeft') next = stepMark(scene.marks, active, -1);
    else if (e.key === 'ArrowRight') next = stepMark(scene.marks, active, 1);
    else if (e.key === 'Escape') next = null;
    if (next === undefined) return;
    // The grid's own arrow keys move a selection; inside a trend they move the day.
    e.preventDefault();
    e.stopPropagation();
    setActive(next);
  };
  const tip = active ? sparkTip(points, active, style, readings, { limit: meta.limit }) : null;
  const rect = active ? svg.current?.getBoundingClientRect() : undefined;
  const last = scene.last;

  return (
    <span className="flex min-w-0 items-center gap-2.5" data-slot="trend" data-style={style}>
      <svg
        ref={svg}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`${label}, ${SPARK_LABELS[style].toLowerCase()}: ${sparkSummary(points, readings)}`}
        aria-describedby={tip ? tipId : undefined}
        data-slot="trend-spark"
        className="flex-none cursor-crosshair overflow-visible rounded-[2px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        // The cell starts a range selection on mouse-down; reading a trend is not selecting.
        onMouseDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => setActive(nearestMark(scene.marks, e.clientX - e.currentTarget.getBoundingClientRect().left))}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? last)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {scene.limit && (
          <>
            <rect x={0} y={scene.limit.zone.y} width={W} height={scene.limit.zone.h} fill="color-mix(in srgb, var(--cr-breach) 12%, transparent)" data-mark="zone" />
            <line x1={0} x2={W} y1={scene.limit.y} y2={scene.limit.y} stroke="var(--cr-text-faint)" strokeDasharray="2 2" data-mark="limit" />
          </>
        )}
        {scene.strip && (
          <line x1={scene.strip.x0} x2={scene.strip.x1} y1={scene.strip.y} y2={scene.strip.y} stroke="var(--cr-border)" strokeWidth={3} strokeLinecap="round" data-mark="track" />
        )}
        {scene.baseline !== undefined && (
          <line x1={0} x2={W} y1={scene.baseline} y2={scene.baseline} stroke="var(--cr-border)" data-mark="zero" />
        )}
        {scene.columns?.map((c) => (
          <rect
            key={c.i}
            x={c.x} y={c.y} width={c.w} height={c.h}
            data-mark="column"
            fill={c.i === active?.i ? 'var(--cr-text)' : c.i === last?.i ? 'var(--cr-accent)' : `color-mix(in srgb, var(--cr-text) ${c.negative ? 24 : 42}%, transparent)`}
          />
        ))}
        {scene.line && (
          <path d={scene.line} fill="none" stroke="color-mix(in srgb, var(--cr-text) 50%, transparent)" strokeWidth={1.25} strokeLinejoin="round" data-mark="line" />
        )}
        {style === 'band' && scene.marks.filter((m) => m.breach).map((m) => (
          <circle key={m.i} cx={m.x} cy={m.y} r={1.5} fill="var(--cr-breach)" data-mark="breach" />
        ))}
        {style === 'range' && scene.marks.map((m) => (
          <line
            key={m.i}
            x1={m.x} x2={m.x}
            y1={m.i === last?.i ? 1 : m.y - 4} y2={m.i === last?.i ? H - 1 : m.y + 4}
            stroke={m.i === active?.i ? 'var(--cr-text)' : m.i === last?.i ? 'var(--cr-accent)' : 'color-mix(in srgb, var(--cr-text) 38%, transparent)'}
            strokeWidth={m.i === last?.i ? 2 : 1}
            data-mark="tick"
          />
        ))}
        {active && style !== 'range' && (
          <line x1={active.x} x2={active.x} y1={0} y2={H} stroke="var(--cr-text-faint)" strokeDasharray="1 1" data-mark="crosshair" />
        )}
        {last && (style === 'line' || style === 'band') && (
          <circle cx={last.x} cy={last.y} r={2} fill={last.breach ? 'var(--cr-breach)' : 'var(--cr-accent)'} data-mark="current" />
        )}
        {active && style !== 'column' && (
          <circle cx={active.x} cy={active.y} r={2.5} fill="var(--cr-panel)" stroke={active.breach ? 'var(--cr-breach)' : 'var(--cr-accent)'} strokeWidth={1.5} data-mark="active" />
        )}
      </svg>
      {children}
      {tip && active && rect && typeof document !== 'undefined' && createPortal(
        <div
          id={tipId}
          role="tooltip"
          data-slot="trend-tip"
          className="pointer-events-none fixed z-50 flex w-max max-w-64 -translate-x-1/2 -translate-y-full flex-col gap-px rounded-sm border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
          style={{ left: rect.left + active.x, top: rect.top - 6 }}
        >
          <span className="text-[10px] text-faint">{tip.date}</span>
          <span className="font-semibold tabular-nums">{tip.value}</span>
          {tip.note && (
            <span className={cn('tabular-nums text-muted-foreground', tip.state === 'breach' && 'font-semibold text-breach-text')} data-state={tip.state}>
              {tip.note}
            </span>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}
