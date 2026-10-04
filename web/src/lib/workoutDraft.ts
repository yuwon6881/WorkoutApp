import type { Exercise, LoggedSet, Session, SessionExercise } from '../types';
import { loadEntryFor, resistanceModeFor } from './resistanceVariant';

export type RemovedSet = {
  exerciseId: string;
  index: number;
  set: LoggedSet;
  prescription: SessionExercise['prescription'][number] | undefined;
};

export function blankPrescription(
  restSeconds: number | null = 90,
  loadModel?: Exercise['loadModel'],
  name = ''
): SessionExercise['prescription'][number] {
  return {
    repMin: 8, repMax: 12, targetRpe: 8, restSeconds, tempo: null, loadText: null, notes: null,
    repsText: null, restText: null, rir: null, warmup: false,
    repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited',
    resistanceMode: resistanceModeFor(loadModel, name)
  };
}

/// An exercise added during a workout has no plan behind it, so its targets stay empty rather than
/// an invented rep range and effort; the lifter's own entries are the only numbers it shows.
export function unplannedPrescription(loadModel?: Exercise['loadModel'], name = ''): SessionExercise['prescription'][number] {
  return { ...blankPrescription(90, loadModel, name), repMin: null, repMax: null, targetRpe: null };
}

/// The session row for a library exercise added mid-workout: one empty set, in the catalog's own
/// tracking mode so a hold logs seconds from its first set.
export function addedSessionExercise(chosen: Exercise, position: number): SessionExercise {
  return {
    id: crypto.randomUUID(), exerciseId: chosen.id, name: chosen.name, position,
    note: '', sequenceGroup: '', substitutions: [], prescription: [unplannedPrescription(chosen.loadModel, chosen.name)],
    sets: [blankLoggedSet(chosen.loadModel, chosen.name)],
    progression: null, loadModel: chosen.loadModel, trackingMode: chosen.trackingMode
  };
}

export function blankLoggedSet(loadModel?: Exercise['loadModel'], name = ''): LoggedSet {
  return {
    id: crypto.randomUUID(), position: 0, weightKg: null, reps: null, rpe: null, done: false, warmup: false,
    resistanceMode: resistanceModeFor(loadModel, name)
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

// The lifter's order for what is left of the session. Superset pairings travel with each exercise.
export function withExerciseMoved(draft: Session, from: number, to: number): Session {
  const count = draft.exercises.length;
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return draft;
  const exercises = [...draft.exercises];
  const [moved] = exercises.splice(from, 1);
  exercises.splice(to, 0, moved);
  return { ...draft, exercises: exercises.map((exercise, position) => ({ ...exercise, position })) };
}

/// Where the exercise on screen sits after a move, so reordering never changes which one is open.
export function indexAfterMove(active: number, from: number, to: number): number {
  if (active === from) return to;
  if (from < active && to >= active) return active - 1;
  if (from > active && to <= active) return active + 1;
  return active;
}

function mapExercise(draft: Session, exerciseIndex: number, update: (exercise: SessionExercise) => SessionExercise): Session {
  return { ...draft, exercises: draft.exercises.map((item, i) => (i === exerciseIndex ? update(item) : item)) };
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

// The exercise, not the set, decides whether there is a load to enter: a plain pull-up is bodyweight.
export function loadIsEditable(exercise: Pick<SessionExercise, 'name' | 'loadModel'>): boolean {
  const entry = loadEntryFor(exercise);
  return entry !== 'bodyweight' && entry !== 'none';
}

/// What the server works out about each exercise (whether Restore default would change anything)
/// follows its answers, while every value the lifter edits stays as this screen holds it.
export function withServerFlags(draft: Session, saved: Session): Session {
  if (draft.id !== saved.id) return draft;
  const flags = new Map(saved.exercises.map(exercise => [exercise.id, Boolean(exercise.canRestore)]));
  let changed = false;
  const exercises = draft.exercises.map(exercise => {
    const canRestore = flags.get(exercise.id);
    if (canRestore === undefined || canRestore === Boolean(exercise.canRestore)) return exercise;
    changed = true;
    return { ...exercise, canRestore };
  });
  return changed ? { ...draft, exercises } : draft;
}
