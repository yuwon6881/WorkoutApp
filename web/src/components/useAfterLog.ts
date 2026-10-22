import { useEffect, useState } from 'react';
import type { Session, Unit } from '../types';
import { haptic } from '../lib/platform';
import { checkLivePr } from '../lib/livePr';
import { advanceTarget, type AdvanceOptions } from '../lib/workoutLogging';
import { showWeight } from '../lib/training';
import { withSessionSystemLoads } from '../lib/workoutSystemLoads';
import type { Celebration } from './WorkoutCelebration';

const CELEBRATION_MS = 4500;

/// What happens the moment a set is logged: a pulse the lifter can feel (stronger once the
/// exercise is complete), a personal-best note when the set beats every finished session, and a
/// move to the next exercise, or the superset partner, when the next step is elsewhere.
export function useAfterLog({ unit, advance, onAdvance }: {
  unit: Unit;
  /** Which moves happen by themselves; both are on unless a device setting turns one off. */
  advance?: AdvanceOptions;
  onAdvance: (exerciseIndex: number) => void;
}) {
  const [celebration, setCelebration] = useState<Celebration | null>(null);

  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [celebration]);

  function afterLog(draft: Session, exerciseIndex: number, setIndex: number) {
    const logged = withSessionSystemLoads({
      ...draft,
      exercises: draft.exercises.map((item, i) => i !== exerciseIndex ? item : {
        ...item, sets: item.sets.map((row, j) => j === setIndex ? { ...row, done: true } : row)
      })
    });
    const exercise = logged.exercises[exerciseIndex];
    const pr = checkLivePr(exercise, setIndex);
    if (pr !== null) {
      const loadStr = pr.isRepsOnly || pr.loadKg === null ? '' : ` at ${showWeight(pr.loadKg, unit)}`;
      const strength = `est. 1RM ${showWeight(pr.e1rm, unit)}`;
      const reps = `${pr.reps} reps${loadStr}`;
      const [title, numbers] = pr.kind === 'both' ? ['New strength and rep best', `${strength} · ${reps}`]
        : pr.kind === 'e1rm' ? ['New estimated strength best', strength]
          : ['New rep best', reps];
      setCelebration({ id: Date.now(), title, detail: `${exercise.name} · ${numbers}` });
    }
    haptic(pr !== null || exercise.sets.every(set => set.done) ? 'success' : 'log');
    const target = advanceTarget(logged, exerciseIndex, setIndex, advance);
    if (target !== null) onAdvance(target);
  }

  return { celebration, afterLog };
}
