import type { LoggedSet, Session, SessionExercise, SetPrescription } from '../types';
import { applySetType, getSetType, setTypeOptions, type SetType } from './importSetTypes';
import { blankPrescription } from './workoutDraft';

const ALL_SET_TYPES = setTypeOptions.map(option => option.value as SetType);

/// What a set is in the active workout. The logged set carries the warm-up flag and the session's
/// prescription carries any technique, the same split the server reads with SetTechniques.
export function sessionSetType(set: Pick<LoggedSet, 'warmup'> | undefined, plan: SetPrescription | undefined): SetType {
  if (set?.warmup || plan?.warmup) return 'warmup';
  return plan ? getSetType(plan) : 'normal';
}

/// The history a set is compared with: warm-ups with warm-ups, each technique with the same
/// technique, and straight sets (including failure/AMRAP, which is full range) with straight sets.
export type SetKind = 'warmup' | 'straight' | Exclude<SetType, 'normal' | 'warmup' | 'amrap'>;

export function setKind(set: Pick<LoggedSet, 'warmup'> | undefined, plan: SetPrescription | undefined): SetKind {
  const type = sessionSetType(set, plan);
  return type === 'normal' || type === 'amrap' ? 'straight' : type;
}

/// Warm-ups stay a leading block: a set may become a warm-up only when every set before it is a
/// warm-up, and a warm-up may become a working set only when no warm-up follows it.
export function allowedSetTypes(exercise: Pick<SessionExercise, 'sets' | 'prescription'>, setIndex: number): SetType[] {
  const isWarmup = (index: number) => sessionSetType(exercise.sets[index], exercise.prescription[index]) === 'warmup';
  const before = exercise.sets.slice(0, setIndex).every((_, index) => isWarmup(index));
  if (isWarmup(setIndex)) {
    const after = exercise.sets.slice(setIndex + 1).every((_, offset) => !isWarmup(setIndex + 1 + offset));
    return after ? ALL_SET_TYPES : ['warmup'];
  }
  return before ? ALL_SET_TYPES : ALL_SET_TYPES.filter(type => type !== 'warmup');
}

/// Changes one set's type in the draft. The technique lives in the set's prescription notes and
/// the warm-up flag on both the plan and the logged set, so the ordinary save carries it; a set
/// turned into a warm-up drops its recorded effort, which warm-ups never keep.
export function withSetType(draft: Session, exerciseIndex: number, setIndex: number, type: SetType): Session {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise, index) => {
      if (index !== exerciseIndex || !exercise.sets[setIndex]) return exercise;
      if (sessionSetType(exercise.sets[setIndex], exercise.prescription[setIndex]) === type) return exercise;
      if (!allowedSetTypes(exercise, setIndex).includes(type)) return exercise;
      const prescription = [...exercise.prescription];
      while (prescription.length <= setIndex) {
        prescription.push({ ...(prescription.at(-1) ?? blankPrescription(exercise.restSeconds ?? null, exercise.loadModel)), warmup: false, notes: null });
      }
      prescription[setIndex] = { ...prescription[setIndex], ...applySetType(prescription[setIndex], type) };
      const warmup = type === 'warmup';
      const sets = exercise.sets.map((set, si) => si !== setIndex ? set
        : warmup ? { ...set, warmup, rpe: null, rir: null } : { ...set, warmup });
      return { ...exercise, prescription, sets };
    })
  };
}
