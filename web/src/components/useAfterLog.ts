import { useEffect, useState } from 'react';
import type { Session, Unit } from '../types';
import { haptic } from '../lib/platform';
import { checkLivePr } from '../lib/livePr';
import { advanceTarget } from '../lib/workoutLogging';
import { showWeight } from '../lib/training';

const CELEBRATION_MS = 4500;

/// What happens the moment a set is logged: a pulse the lifter can feel (stronger once the
/// exercise is complete), a personal-best note when the set beats every finished session, and a
/// move to the next exercise, or the superset partner, when the next step is elsewhere.
export function useAfterLog({ unit, autoAdvance, focused, onAdvance }: {
  unit: Unit;
  autoAdvance: boolean;
  focused: boolean;
  onAdvance: (exerciseIndex: number) => void;
}) {
  const [celebration, setCelebration] = useState('');

  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(''), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [celebration]);

  function afterLog(draft: Session, exerciseIndex: number, setIndex: number) {
    const logged = {
      ...draft,
      exercises: draft.exercises.map((item, i) => i !== exerciseIndex ? item : {
        ...item, sets: item.sets.map((row, j) => j === setIndex ? { ...row, done: true } : row)
      })
    };
    const exercise = logged.exercises[exerciseIndex];
    const pr = checkLivePr(exercise, setIndex);
    if (pr !== null) {
      if (pr.kind === 'both') {
        const loadStr = pr.isRepsOnly || pr.loadKg === null ? '' : ` at ${showWeight(pr.loadKg, unit)}`;
        setCelebration(`New strength and rep best on ${exercise.name}: e1RM ${showWeight(pr.e1rm, unit)} · ${pr.reps} reps${loadStr}`);
      } else if (pr.kind === 'e1rm') {
        setCelebration(`New estimated strength best on ${exercise.name}: e1RM ${showWeight(pr.e1rm, unit)}`);
      } else {
        const loadStr = pr.isRepsOnly || pr.loadKg === null ? '' : ` at ${showWeight(pr.loadKg, unit)}`;
        setCelebration(`New rep best on ${exercise.name}: ${pr.reps} reps${loadStr}`);
      }
    }
    haptic(pr !== null || exercise.sets.every(set => set.done) ? 'success' : 'log');
    if (!autoAdvance || !focused) return;
    const target = advanceTarget(logged, exerciseIndex, setIndex);
    if (target !== null) onAdvance(target);
  }

  return { celebration, afterLog };
}
