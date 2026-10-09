import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { SessionExercise } from '../types';
import { Button } from './ui/Button';
import { useReducedMotion } from './ui/Motion';
import { useWindowTier } from '../lib/breakpoints';
import { previewOrder, useStripReorder } from './useStripReorder';

const RING = 2 * Math.PI * 11;

// Working sets decide an exercise's progress; an all-warm-up exercise counts its warm-ups.
function countedSets(exercise: SessionExercise) {
  const working = exercise.sets.filter(set => !set.warmup);
  return working.length ? working : exercise.sets;
}

function isComplete(exercise: SessionExercise) {
  const counted = countedSets(exercise);
  return counted.length > 0 && counted.every(set => set.done);
}

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
  const { drag, pressingIndex, itemProps, stripProps } = useStripReorder({ scrollerRef, count: exercises.length, onMove });
  // Exercises already complete when the strip first draws keep a still check; one finished while it
  // is on screen keeps a mark that plays its pop once, until it is no longer complete.
  const completedBefore = useRef<Set<string> | null>(null);
  const popped = useRef(new Set<string>());
  const completedNow = new Set(exercises.filter(isComplete).map(exercise => exercise.id));
  for (const id of completedNow) if (completedBefore.current && !completedBefore.current.has(id)) popped.current.add(id);
  for (const id of popped.current) if (!completedNow.has(id)) popped.current.delete(id);
  useEffect(() => { completedBefore.current = completedNow; });

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
    // Wider layouts float their arrows over the strip's ends, so the open tab clears them.
    const inset = arrows ? 56 : 16;
    const start = active.offsetLeft;
    const end = start + active.offsetWidth;
    const left = start < scroller.scrollLeft + inset
      ? start - inset
      : end > scroller.scrollLeft + scroller.clientWidth - inset ? end - scroller.clientWidth + inset : null;
    if (left !== null) scroller.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
  }, [activeIndex, reduced, arrows]);

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
      <div className={`workout-exercise-strip ${drag ? 'reordering' : ''}`.trim()} role="tablist" ref={scrollerRef} onScroll={arrows ? measure : undefined} {...stripProps}>
        {previewOrder(exercises.length, drag).map((index, shownAt) => {
          const exercise = exercises[index];
          const isSelected = index === activeIndex;
          const counted = countedSets(exercise);
          const doneCount = counted.filter(s => s.done).length;
          const completed = completedNow.has(exercise.id);
          const justCompleted = popped.current.has(exercise.id);
          const progress = counted.length ? doneCount / counted.length : 0;
          const isHeld = drag?.from === index;
          const isPressing = pressingIndex === index && !isHeld;

          return (
            <Button
              key={exercise.id}
              presentation="plain"
              role="tab"
              aria-selected={isSelected}
              aria-label={`${exercise.name}, ${doneCount} of ${counted.length} sets completed`}
              aria-describedby={exercises.length > 1 ? 'workout-strip-reorder-hint' : undefined}
              className={`workout-strip-item ${isSelected ? 'active' : ''} ${completed ? 'completed' : ''} ${justCompleted ? 'just-completed' : ''} ${isHeld ? 'held' : ''} ${isPressing ? 'pressing' : ''}`.replace(/\s+/g, ' ').trim()}
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
