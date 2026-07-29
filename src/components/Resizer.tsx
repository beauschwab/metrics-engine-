/**
 * Column resizing (§4).
 *
 * Panels are resizable and the layout persists per user. Resize follows the
 * pointer with no transition — an animated panel edge lags the hand and reads
 * as lag in the whole surface.
 *
 * The validation column is not collapsible by default. Hiding it defeats the
 * product's thesis, so an author can drag it closed but the interface never
 * suggests doing so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'mdl.layout.v1';

export interface Layout {
  registry: number;
  validation: number;
}

export const DEFAULT_LAYOUT: Layout = { registry: 244, validation: 380 };

const LIMITS = {
  registry: { min: 180, max: 420 },
  validation: { min: 260, max: 620 },
};

export function useLayout(): [Layout, (next: Layout) => void] {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_LAYOUT;
      const parsed = JSON.parse(raw) as Partial<Layout>;
      return {
        registry: clamp(parsed.registry ?? DEFAULT_LAYOUT.registry, LIMITS.registry),
        validation: clamp(parsed.validation ?? DEFAULT_LAYOUT.validation, LIMITS.validation),
      };
    } catch {
      return DEFAULT_LAYOUT;
    }
  });

  const persist = useCallback((next: Layout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A browser refusing storage is not a reason to break resizing.
    }
  }, []);

  return [layout, persist];
}

function clamp(v: number, { min, max }: { min: number; max: number }): number {
  return Math.max(min, Math.min(max, v));
}

interface Props {
  /** Which edge this handle drives. */
  panel: keyof Layout;
  layout: Layout;
  onChange(next: Layout): void;
  label: string;
}

export function Resizer({ panel, layout, onChange, label }: Props) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      // The registry grows rightward, the validation column leftward.
      const delta = panel === 'registry' ? e.clientX - startX.current : startX.current - e.clientX;
      onChange({ ...layout, [panel]: clamp(startWidth.current + delta, LIMITS[panel]) });
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [layout, onChange, panel]);

  const nudge = (by: number) =>
    onChange({ ...layout, [panel]: clamp(layout[panel] + by, LIMITS[panel]) });

  return (
    <div
      className="mdl-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={layout[panel]}
      aria-valuemin={LIMITS[panel].min}
      aria-valuemax={LIMITS[panel].max}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        startX.current = e.clientX;
        startWidth.current = layout[panel];
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onDoubleClick={() => onChange({ ...layout, [panel]: DEFAULT_LAYOUT[panel] })}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          nudge(panel === 'registry' ? -16 : 16);
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          nudge(panel === 'registry' ? 16 : -16);
        }
      }}
    />
  );
}
