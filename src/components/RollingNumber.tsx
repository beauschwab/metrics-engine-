/**
 * The digit roll (§9) — the one indulgence in an otherwise restrained surface.
 *
 * Only the characters that actually changed animate, which is what makes it
 * informative rather than decorative: on a nine-figure value it tells you
 * *which part* of the number moved. Under `prefers-reduced-motion` the CSS
 * collapses it to an instant swap.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  className?: string;
  style?: React.CSSProperties;
  'aria-live'?: 'polite' | 'off';
}

export function RollingNumber({ value, className, style, ...rest }: Props) {
  const previous = useRef(value);
  const [changed, setChanged] = useState<boolean[]>([]);

  useEffect(() => {
    const before = previous.current;
    if (before === value) return;

    // Compare from the right: digits are place-valued, so aligning on the end
    // is what makes "the last three digits moved" read correctly.
    const next = value.split('').map((ch, i) => {
      const j = i - (value.length - before.length);
      return before[j] !== ch;
    });

    previous.current = value;
    setChanged(next);
    const t = window.setTimeout(() => setChanged([]), 200);
    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <span className={className} style={style} {...rest}>
      {value.split('').map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          className={changed[i] ? 'mdl-roll mdl-roll-changed' : 'mdl-roll'}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
