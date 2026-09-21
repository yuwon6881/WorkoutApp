import type { Exercise, LoggedSet, Session, SessionExercise } from '../types';

export function blankPrescription(
  restSeconds: number | null = 90,
  loadModel?: Exercise['loadModel'],
  resistanceMode?: LoggedSet['resistanceMode']
): SessionExercise['prescription'][number] {
  return {
    repMin: 8, repMax: 12, targetRpe: 8, restSeconds, tempo: null, loadText: null, notes: null,
    repsText: null, restText: null, rir: null, warmup: false,
    repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited',
    resistanceMode: normalizeResistanceMode(loadModel, resistanceMode)
  };
}

export function blankLoggedSet(
  loadModel?: Exercise['loadModel'],
  resistanceMode?: LoggedSet['resistanceMode']
): LoggedSet {
  return {
    id: crypto.randomUUID(), position: 0, weightKg: null, reps: null, rpe: null, done: false, warmup: false,
    resistanceMode: normalizeResistanceMode(loadModel, resistanceMode)
  };
}

export function structuralChanges(current: Session, next: Session): boolean {
  const shape = (session: Session) => session.exercises.map(exercise => ({
    id: exercise.id, exerciseId: exercise.exerciseId, name: exercise.name, prescription: exercise.prescription,
    sequenceGroup: exercise.sequenceGroup, substitutions: exercise.substitutions, loadModel: exercise.loadModel,
    sets: exercise.sets.map(set => set.id)
  }));
  return JSON.stringify(shape(current)) !== JSON.stringify(shape(next));
}

function normalizeResistanceMode(loadModel?: Exercise['loadModel'], resistanceMode?: LoggedSet['resistanceMode']): LoggedSet['resistanceMode'] {
  if (loadModel === 'full_bodyweight')
    return resistanceMode === 'added' || resistanceMode === 'assistance' || resistanceMode === 'bodyweight' ? resistanceMode : 'bodyweight';
  return loadModel === 'bodyweight_context_only' || loadModel === 'reps_only' ? 'reps_only' : 'external';
}
