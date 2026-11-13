import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './Motion';

const DURATION_MS = 380;

/// A whole number that rolls to its new value instead of jumping, for totals that change while the
/// lifter watches (the week's workouts, sets and minutes as the calendar moves). The first value
/// shows at once, so nothing on a page that just opened is held back, and reduced motion always
/// shows the new value straight away. The roll lasts a third of a second, so a screen reader lands
/// on the settled number.
export function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (reduced || start === value || typeof window.requestAnimationFrame !== 'function') {
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [value, reduced]);

  return <>{shown.toLocaleString()}</>;
}
