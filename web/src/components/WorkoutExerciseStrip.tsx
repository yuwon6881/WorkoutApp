import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { SessionExercise } from '../types';
import { Button } from './ui/Button';
import { useReducedMotion } from './ui/Motion';
import { useWindowTier } from '../lib/breakpoints';
import { previewOrder, useStripReorder } from './useStripReorder';

const RING = 2 * Math.PI * 11;

export function WorkoutExerciseStrip({
  exercises,
  activeIndex,
  onSelect,
  onAdd,
  onMove
}: {
  exercises: SessionExercise[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  /** Moves an exercise to another place in the session: held and dragged, or Alt+arrow keys. */
  onMove: (from: number, to: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  // Phones scroll the strip by touch; wider layouts also get arrows for a mouse.
  const arrows = useWindowTier() !== 'compact';
  const [edges, setEdges] = useState({ start: true, end: true });
  const { drag, itemProps, stripProps } = useStripReorder({ scrollerRef, count: exercises.length, onMove });

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const start = scroller.scrollLeft <= 1;
    const end = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
    setEdges(previous => previous.start === start && previous.end === end ? previous : { start, end });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !arrows) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [arrows, measure, exercises.length]);

  // Keep the current exercise in view as the lifter moves through the session, including when
  // the next exercise is chosen from the set list rather than the strip itself.
  useEffect(() => {
    // Scroll the strip alone: scrollIntoView would also move the dialog when the strip is offscreen.
    const scroller = scrollerRef.current;
    const active = scroller?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!scroller || !active) return;
    const start = active.offsetLeft;
    const end = start + active.offsetWidth;
    const left = start < scroller.scrollLeft
      ? start - 16
      : end > scroller.scrollLeft + scroller.clientWidth ? end - scroller.clientWidth + 16 : null;
    if (left !== null) scroller.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
  }, [activeIndex, reduced]);

  function page(direction: 1 | -1) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' });
  }

  return (
    <nav className={`workout-exercise-strip-container ${arrows ? 'with-arrows' : ''}`.trim()} aria-label="Workout exercises" data-swipe-ignore="">
      {arrows && (
        <Button variant="tertiary" className="workout-strip-arrow" aria-label="Earlier exercises" disabled={edges.start} onClick={() => page(-1)}>
          <ChevronLeft size={18} />
        </Button>
      )}
      <span id="workout-strip-reorder-hint" className="sr-only">Press and hold, then drag to reorder, or use Alt with the arrow keys.</span>
      <div className="workout-exercise-strip" role="tablist" ref={scrollerRef} onScroll={arrows ? measure : undefined} {...stripProps}>
        {previewOrder(exercises.length, drag).map((index, shownAt) => {
          const exercise = exercises[index];
          const isSelected = index === activeIndex;
          const working = exercise.sets.filter(s => !s.warmup);
          const counted = working.length ? working : exercise.sets;
          const doneCount = counted.filter(s => s.done).length;
          const completed = counted.length > 0 && doneCount === counted.length;
          const progress = counted.length ? doneCount / counted.length : 0;

          return (
            <Button
              key={exercise.id}
              presentation="plain"
              role="tab"
              aria-selected={isSelected}
              aria-label={`${exercise.name}, ${doneCount} of ${counted.length} sets completed`}
              aria-describedby={exercises.length > 1 ? 'workout-strip-reorder-hint' : undefined}
              className={`workout-strip-item ${isSelected ? 'active' : ''} ${completed ? 'completed' : ''} ${drag?.from === index ? 'held' : ''}`}
              {...itemProps(index)}
              onClick={() => onSelect(index)}
            >
              <span className="workout-strip-ring" aria-hidden="true">
                <svg className="ring-svg" viewBox="0 0 28 28">
                  <circle className="ring-track" cx="14" cy="14" r="11" />
                  <circle
                    className="ring-value"
                    cx="14"
                    cy="14"
                    r="11"
                    strokeDasharray={RING}
                    strokeDashoffset={RING * (1 - progress)}
                  />
                </svg>
                {completed ? <Check size={13} strokeWidth={3} /> : <span>{shownAt + 1}</span>}
              </span>
              <span className="workout-strip-text">
                <span className="workout-strip-name">{exercise.name}</span>
                <span className="workout-strip-count">{doneCount}/{counted.length} sets</span>
              </span>
            </Button>
          );
        })}

        <Button
          variant="tertiary"
          className="workout-strip-add-item"
          aria-label="Add another exercise to this workout"
          onClick={onAdd}
        >
          <Plus size={18} />
          <span>Add</span>
        </Button>
      </div>
      {arrows && (
        <Button variant="tertiary" className="workout-strip-arrow" aria-label="Later exercises" disabled={edges.end} onClick={() => page(1)}>
          <ChevronRight size={18} />
        </Button>
      )}
    </nav>
  );
}
