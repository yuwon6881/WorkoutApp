import { useRef } from 'react';
import { Check, Dumbbell, Plus } from 'lucide-react';
import type { SessionExercise } from '../types';
import { Button } from './ui/Button';

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

  return (
    <nav className="workout-exercise-strip-container" aria-label="Workout exercises">
      <div className="workout-exercise-strip" role="tablist" ref={scrollerRef}>
        {exercises.map((exercise, index) => {
          const isSelected = index === activeIndex;
          const completed = exercise.sets.length > 0 && exercise.sets.every(s => s.done);
          const hasLoggedSets = exercise.sets.some(s => s.done);
          const workingSetsDone = exercise.sets.filter(s => s.done && !s.warmup).length;
          const totalWorkingSets = exercise.sets.filter(s => !s.warmup).length || exercise.sets.length;

          return (
            <Button
              key={exercise.id}
              presentation="plain"
              role="tab"
              aria-selected={isSelected}
              aria-label={`${exercise.name}, ${workingSetsDone} of ${totalWorkingSets} sets completed`}
              className={`workout-strip-item ${isSelected ? 'active' : ''} ${completed ? 'completed' : ''}`}
              onClick={() => onSelect(index)}
            >
              <div className="workout-strip-thumb">
                <span className="workout-strip-icon" aria-hidden="true">
                  <Dumbbell size={18} />
                </span>
                <span className="workout-strip-name" title={exercise.name}>
                  {exercise.name}
                </span>

                {completed && (
                  <div className="workout-strip-badge completed" title="Exercise completed">
                    <Check size={16} strokeWidth={3} />
                  </div>
                )}
                {!completed && hasLoggedSets && (
                  <div className="workout-strip-progress-ring" title={`${workingSetsDone}/${totalWorkingSets} sets`}>
                    <span>{workingSetsDone}/{totalWorkingSets}</span>
                  </div>
                )}
              </div>
              <div className="workout-strip-indicator" aria-hidden="true" />
            </Button>
          );
        })}

        <Button
          presentation="plain"
          className="workout-strip-add-item"
          aria-label="Add another exercise to this workout"
          onClick={onAdd}
        >
          <div className="workout-strip-thumb add-thumb">
            <Plus size={20} />
          </div>
          <div className="workout-strip-indicator" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
