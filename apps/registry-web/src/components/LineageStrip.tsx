/**
 * Where the open document sits in the chain.
 *
 * The workspace has always described a pipeline — positions in, a classified and
 * weighted view, a filed table, a monitor over it — and never drawn it. An
 * author opening `lcr_outflow_rates` could read every rate in it without
 * learning that changing one moves a number in `reg.fr2052a_daily` tonight.
 *
 * So: one line, source table to last consumer, the current step marked. It is
 * navigation as well as orientation — every document step is clickable, which
 * makes "what does this feed?" a thing you follow rather than a thing you
 * reconstruct from `using:` fields across four files.
 *
 * Two deliberate omissions. Real lineage is a DAG and drawing it as one produces
 * a picture nobody reads, so the spine is the path the data travels and rule
 * sets hang off a step as inputs. And a rule set is *not* drawn as a link:
 * `positions → product_id → outflows` is not what runs, and misdescribing the
 * pipeline to the person deciding whether an edit is safe is worse than drawing
 * nothing.
 */

import { useEffect, useRef, useState } from 'react';
import type { Chain, LineageGraph, Stage } from 'keel-engine/lineage';
import { STAGE_CAPTION, STAGE_LABEL } from 'keel-engine/lineage';

interface Props {
  chain: Chain;
  lineage: LineageGraph;
  /** Name of the open document, so the current position can be marked. */
  current: string;
  /** Navigate to a document by name; absent names are not rendered clickable. */
  onOpen(name: string): void;
}

const STAGE_HUE: Record<Stage, string> = {
  prepare: 'var(--mdl-dimension)',
  file: 'var(--mdl-signal)',
  publish: 'var(--mdl-measure)',
  watch: 'var(--mdl-func)',
};

export function LineageStrip({ chain, lineage, current, onOpen }: Props) {
  const rail = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  /**
   * The same treatment the tab strip needed, for the same reason.
   *
   * A chain clipped at the right edge with no affordance is worse than no chain:
   * standing on the report, the monitor that watches it was simply not there,
   * and the surface looked like it was telling you the whole story. Both edges
   * fade, and the current step is scrolled into view on arrival.
   */
  useEffect(() => {
    const el = rail.current;
    if (!el) return;

    const measure = () => {
      setOverflowing(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
      setScrolled(el.scrollLeft > 2);
    };

    el.querySelector<HTMLElement>('[data-here="true"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    measure();

    // Inter arrives after first paint and widens every label without changing
    // the rail's own box, so a ResizeObserver alone never re-fires.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });

    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      live = false;
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [chain]);

  // A document nothing connects to gets no strip rather than an empty rail —
  // a chrome element that is sometimes blank reads as broken.
  if (chain.steps.length < 2) return null;

  const here = lineage.byName[current];

  return (
    <div className="mdl-lineage" data-testid="mdl-lineage">
      <div
        className="mdl-lineage-wrap"
        data-overflowing={overflowing}
        data-scrolled={scrolled}
      >
      <div className="mdl-lineage-chain" ref={rail} role="list" aria-label="Pipeline chain">
        {chain.steps.map((step, i) => {
          const isHere = i === chain.at;
          // The step is the current one *and* the open document is the step,
          // rather than an input folded into it. Those look different because
          // they are different: one is a link, the other is what a link is
          // made of.
          const asSpine = isHere && chain.via === 'spine';
          const asInput = isHere && chain.via === 'input';

          return (
            <div className="mdl-lineage-step" key={`${step.label}-${i}`} role="listitem">
              {i > 0 ? (
                <span className="mdl-lineage-arrow" aria-hidden="true">›</span>
              ) : null}

              {step.kind === 'table' ? (
                <span className="mdl-lineage-table" title={`table ${step.label}`}>
                  {step.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="mdl-lineage-doc"
                  data-here={asSpine}
                  data-stage={step.stage}
                  style={{ '--step-hue': STAGE_HUE[step.stage!] } as React.CSSProperties}
                  aria-current={asSpine ? 'step' : undefined}
                  title={
                    step.docs.length > 1
                      ? step.docs.join(' · ')
                      : `${STAGE_LABEL[step.stage!]} — ${STAGE_CAPTION[step.stage!]}`
                  }
                  onClick={() => onOpen(step.docs[0])}
                >
                  {step.label}
                </button>
              )}

              {/* Rule sets and rate tables folded into this step — shown only
                  when you are standing on that step. Everywhere else they are
                  detail about a link you are not looking at, and carrying them
                  the length of the chain pushed the monitor off the right edge,
                  which is the one thing this strip exists to reveal. */}
              {isHere && step.uses.length ? (
                <span className="mdl-lineage-uses">
                  {step.uses.map((u) => (
                    <button
                      type="button"
                      key={u}
                      className="mdl-lineage-use"
                      data-here={asInput && u === current}
                      onClick={() => onOpen(u)}
                      title={`folded into ${step.label}`}
                    >
                      {u}
                    </button>
                  ))}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      </div>

      {/* The sentence the surface could not previously say: when this runs and
          what, if anything, it writes. `targets:` says which engines *could*
          run a plan; this says what actually happens tonight. */}
      {here ? (
        <span
          className="mdl-lineage-runtime"
          data-testid="mdl-runtime"
          title={here.runtimeDetail}
        >
          {here.runtime}
        </span>
      ) : null}
    </div>
  );
}
