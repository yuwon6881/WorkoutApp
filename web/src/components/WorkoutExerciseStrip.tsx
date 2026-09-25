import { useEffect, useRef } from 'react';
import { Check, Plus } from 'lucide-react';
import type { SessionExercise } from '../types';
import { Button } from './ui/Button';
import { useReducedMotion } from './ui/Motion';

const RING = 2 * Math.PI * 11;

export function WorkoutExerciseStrip({
  exercises,
  activeIndex,
  onSelect,
  onAdd
}: {
  exercises: SessionExercise[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

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

  return (
    <nav className="workout-exercise-strip-container" aria-label="Workout exercises">
      <div className="workout-exercise-strip" role="tablist" ref={scrollerRef}>
        {exercises.map((exercise, index) => {
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
              className={`workout-strip-item ${isSelected ? 'active' : ''} ${completed ? 'completed' : ''}`}
              onClick={() => onSelect(index)}
            >
              <span className="workout-strip-ring" aria-hidden="true">
                <svg viewBox="0 0 28 28">
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
                {completed ? <Check size={13} strokeWidth={3} /> : <span>{index + 1}</span>}
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
    </nav>
  );
}
