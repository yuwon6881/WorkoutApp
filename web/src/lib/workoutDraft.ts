import type { Exercise, LoggedSet, Session, SessionExercise } from '../types';

export type RemovedSet = {
  exerciseId: string;
  index: number;
  set: LoggedSet;
  prescription: SessionExercise['prescription'][number] | undefined;
};

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

// Adding, removing, or swapping exercises needs the server's catalog and swap rules. Adding or
// removing a set does not: it travels in an ordinary queued full save with stable set identities.
export function exerciseListChanged(current: Session, next: Session): boolean {
  const shape = (session: Session) => session.exercises.map(exercise => ({
    id: exercise.id, exerciseId: exercise.exerciseId, name: exercise.name,
    sequenceGroup: exercise.sequenceGroup, substitutions: exercise.substitutions, loadModel: exercise.loadModel
  }));
  return JSON.stringify(shape(current)) !== JSON.stringify(shape(next));
}

// A new set repeats the previous set's load and reps so the common "one more set" is one tap.
export function withSetAdded(draft: Session, exerciseIndex: number): Session {
  return mapExercise(draft, exerciseIndex, item => {
    const prevSet = item.sets.at(-1);
    const prevPlan = item.prescription.at(-1);
    const mode = prevSet?.resistanceMode ?? prevPlan?.resistanceMode;
    return {
      ...item,
      sets: [
        ...item.sets,
        {
          id: crypto.randomUUID(), position: item.sets.length,
          weightKg: prevSet?.weightKg ?? null, reps: prevSet?.reps ?? null, rpe: null,
          done: false, warmup: false, resistanceMode: mode
        }
      ],
      prescription: [
        ...item.prescription,
        {
          ...prevPlan,
          repMin: prevPlan ? prevPlan.repMin : 8, repMax: prevPlan ? prevPlan.repMax : 12, targetRpe: prevPlan?.targetRpe ?? 8,
          restSeconds: prevPlan?.restSeconds ?? 90, tempo: null, loadText: null, notes: null,
          repsText: null, restText: null, rir: null, warmup: false,
          repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', resistanceMode: mode
        }
      ]
    };
  });
}

export function withSetRemoved(draft: Session, exerciseIndex: number, setIndex: number): { next: Session; removed: RemovedSet } | null {
  const exercise = draft.exercises[exerciseIndex];
  const set = exercise?.sets[setIndex];
  if (!exercise || !set || exercise.sets.length <= 1) return null;
  const next = mapExercise(draft, exerciseIndex, item => ({
    ...item,
    sets: item.sets.filter((_, j) => j !== setIndex),
    prescription: item.prescription.filter((_, j) => j !== setIndex)
  }));
  return { next, removed: { exerciseId: exercise.id, index: setIndex, set, prescription: exercise.prescription[setIndex] } };
}

// Undo puts the same set back, with its identity and logged values, where it was taken from.
export function withSetRestored(draft: Session, removed: RemovedSet): Session | null {
  const exerciseIndex = draft.exercises.findIndex(item => item.id === removed.exerciseId);
  const exercise = draft.exercises[exerciseIndex];
  if (!exercise || exercise.sets.length >= 24 || exercise.sets.some(set => set.id === removed.set.id)) return null;
  const at = Math.min(removed.index, exercise.sets.length);
  return mapExercise(draft, exerciseIndex, item => ({
    ...item,
    sets: [...item.sets.slice(0, at), removed.set, ...item.sets.slice(at)],
    prescription: removed.prescription && item.prescription.length >= at
      ? [...item.prescription.slice(0, at), removed.prescription, ...item.prescription.slice(at)]
      : item.prescription
  }));
}

function mapExercise(draft: Session, exerciseIndex: number, update: (exercise: SessionExercise) => SessionExercise): Session {
  return { ...draft, exercises: draft.exercises.map((item, i) => (i === exerciseIndex ? update(item) : item)) };
}

function normalizeResistanceMode(loadModel?: Exercise['loadModel'], resistanceMode?: LoggedSet['resistanceMode']): LoggedSet['resistanceMode'] {
  if (loadModel === 'full_bodyweight')
    return resistanceMode === 'added' || resistanceMode === 'assistance' || resistanceMode === 'bodyweight' ? resistanceMode : 'bodyweight';
  return loadModel === 'bodyweight_context_only' || loadModel === 'reps_only' ? 'reps_only' : 'external';
}

// Sets are numbered the way the lifter counts them: warm-ups as W1, W2… and working sets from 1.
export function setNumberLabel(exercise: SessionExercise, setIndex: number): { label: string; warmup: boolean } {
  const isWarmup = (i: number) => Boolean(exercise.sets[i]?.warmup || exercise.prescription[i]?.warmup);
  const warmup = isWarmup(setIndex);
  let count = 0;
  for (let i = 0; i <= setIndex; i += 1) if (isWarmup(i) === warmup) count += 1;
  return { label: warmup ? `W${count}` : String(count), warmup };
}

export function nextPendingSet(exercise: SessionExercise | undefined): number {
  return exercise ? exercise.sets.findIndex(set => !set.done) : -1;
}

// Effort is recorded as RIR; RPE is kept alongside as 10 − RIR for sets below 5 RIR.
export function effortValue(set: LoggedSet): number | null {
  if (set.rir === '5+') return 5;
  return set.rpe !== null ? Math.round(10 - set.rpe) : null;
}

export function effortPatch(value: number | null): Pick<LoggedSet, 'rpe' | 'rir'> {
  if (value === null) return { rpe: null, rir: null };
  return value >= 5 ? { rpe: null, rir: '5+' } : { rpe: 10 - value, rir: String(value) };
}

export function loadIsEditable(exercise: SessionExercise, set: LoggedSet): boolean {
  const loadModel = exercise.loadModel ?? 'external';
  return loadModel === 'external' || (loadModel === 'full_bodyweight' && (set.resistanceMode ?? 'bodyweight') !== 'bodyweight');
}
