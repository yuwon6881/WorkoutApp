import { useLayoutEffect, useRef, useState } from 'react';
import { fittingCount } from '../lib/fittingCount';

/// Shown before the row has been measured, and wherever layout cannot be measured at all.
const UNMEASURED_COUNT = 4;

/// A day's exercise names on exactly one line: as many as fit at the row's current width, then
/// "+N more". The names are measured once in a hidden copy, so a resize only recounts.
export function DayExercisePreview({ names }: { names: readonly string[] }) {
  const row = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(Math.min(names.length, UNMEASURED_COUNT));

  useLayoutEffect(() => {
    const element = row.current;
    const ruler = measure.current;
    if (!element || !ruler) return;
    const widths = [...ruler.querySelectorAll<HTMLElement>('.pdl-preview-name')].map(name => name.getBoundingClientRect().width);
    const moreWidth = ruler.querySelector<HTMLElement>('.pdl-preview-more')?.getBoundingClientRect().width ?? 0;
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const recount = () => {
      const available = element.getBoundingClientRect().width;
      // Nothing to measure against (a hidden tab or a test DOM): keep the unmeasured count.
      if (available <= 0 || widths.every(width => width === 0)) return;
      setShown(fittingCount(widths, available, gap, moreWidth));
    };
    recount();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(recount);
    observer.observe(element);
    return () => observer.disconnect();
  }, [names]);

  const hidden = names.length - shown;
  return (
    <span className="pdl-exercise-preview">
      <span className="pdl-preview-row" ref={row}>
        {names.slice(0, shown).map((name, position) => <span className="pdl-preview-name" key={position} title={name}>{name}</span>)}
        {hidden > 0 && <span className="pdl-preview-more">+{hidden} more</span>}
      </span>
      <span className="pdl-preview-ruler" ref={measure} aria-hidden="true">
        {names.map((name, position) => <span className="pdl-preview-name" key={position}>{name}</span>)}
        <span className="pdl-preview-more">+{names.length} more</span>
      </span>
    </span>
  );
}
