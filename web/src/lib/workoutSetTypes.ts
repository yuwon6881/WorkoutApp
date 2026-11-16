import type { LoggedSet, Session, SessionExercise, SetPrescription } from '../types';
import { applySetType, getSetType, setTypeOptions, type SetType } from './importSetTypes';
import { blankPrescription } from './workoutDraft';

const ALL_SET_TYPES = setTypeOptions.map(option => option.value as SetType);
const WARMUP_ONLY: SetType[] = ['warmup'];
const WORKING_SET_TYPES = ALL_SET_TYPES.filter(type => type !== 'warmup');

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

type TypedExercise = Pick<SessionExercise, 'sets' | 'prescription'>;
/// The set that changes type and where it ends up once warm-ups are kept as a leading block.
type Placement = { from: number; to: number };

const typeAt = (exercise: TypedExercise, index: number) => sessionSetType(exercise.sets[index], exercise.prescription[index]);

function leadingWarmupCount(exercise: TypedExercise): number {
  const firstWorking = exercise.sets.findIndex((_, index) => typeAt(exercise, index) !== 'warmup');
  return firstWorking === -1 ? exercise.sets.length : firstWorking;
}

/// Sets are logged in order, so a move may never leave a logged set behind one still to log.
function keepsLogOrder(exercise: TypedExercise, { from, to }: Placement): boolean {
  const done = exercise.sets.map(set => set.done);
  const [moved] = done.splice(from, 1);
  done.splice(to, 0, moved);
  return done.every((value, index) => index === 0 || value <= done[index - 1]);
}

/// Where a set lands when it becomes `type`, or null when that would break the logging order.
///
/// Warm-ups stay a leading block, so a set becoming a warm-up joins the end of that block and the
/// working sets after it slide down with their targets, notes and progression. A warm-up becoming a
/// working set drops to the start of the working block. When the first working set is the one turned
/// into a warm-up, the last unlogged set of its kind (typically the "one more set" just added) stands
/// in for it, so the first working set keeps the real prescription instead of handing it to a warm-up.
function placementFor(exercise: TypedExercise, setIndex: number, type: SetType): Placement | null {
  const warmupNow = typeAt(exercise, setIndex) === 'warmup';
  if (warmupNow === (type === 'warmup')) return { from: setIndex, to: setIndex };
  const lead = leadingWarmupCount(exercise);
  if (warmupNow) {
    const placement = { from: setIndex, to: Math.max(setIndex, lead - 1) };
    return keepsLogOrder(exercise, placement) ? placement : null;
  }
  if (setIndex < lead) return null;
  if (setIndex === lead) {
    const kind = typeAt(exercise, setIndex);
    let standIn = -1;
    exercise.sets.forEach((set, index) => {
      if (index > setIndex && !set.done && typeAt(exercise, index) === kind) standIn = index;
    });
    const placement = { from: standIn === -1 ? setIndex : standIn, to: lead };
    if (keepsLogOrder(exercise, placement)) return placement;
    return { from: setIndex, to: setIndex };
  }
  const placement = { from: setIndex, to: lead };
  return keepsLogOrder(exercise, placement) ? placement : null;
}

/// A warm-up can be added anywhere among the working sets and a warm-up can be turned back into a
/// working set; the set moves so that warm-ups stay first. It is offered unless a logged set is in the way.
export function allowedSetTypes(exercise: TypedExercise, setIndex: number): SetType[] {
  if (typeAt(exercise, setIndex) === 'warmup') return placementFor(exercise, setIndex, 'normal') ? ALL_SET_TYPES : WARMUP_ONLY;
  return placementFor(exercise, setIndex, 'warmup') ? ALL_SET_TYPES : WORKING_SET_TYPES;
}

/// The set's prescription as `type` writes it. Only a failure/AMRAP set is a statement about effort;
/// every other change leaves the printed effort target and where it came from as they were, so
/// switching a set to another type and back is not a change to the program and finishing the workout
/// does not offer to carry one forward.
function livePrescriptionFor(plan: SetPrescription, type: SetType): SetPrescription {
  const written = { ...plan, ...applySetType(plan, type) };
  if (type === 'amrap') return written;
  return { ...written, targetRpe: plan.targetRpe, rir: plan.rir, rpeSource: plan.rpeSource };
}

/// Changes one set's type in the draft. The technique lives in the set's prescription notes and
/// the warm-up flag on both the plan and the logged set, so the ordinary save carries it; a set
/// turned into a warm-up drops its recorded effort, which warm-ups never keep. A change between
/// warm-up and working moves the set to keep the warm-up block leading (see `placementFor`).
export function withSetType(draft: Session, exerciseIndex: number, setIndex: number, type: SetType): Session {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise, index) => {
      if (index !== exerciseIndex || !exercise.sets[setIndex]) return exercise;
      if (typeAt(exercise, setIndex) === type) return exercise;
      if (!allowedSetTypes(exercise, setIndex).includes(type)) return exercise;
      const placement = placementFor(exercise, setIndex, type);
      if (!placement) return exercise;
      const { from, to } = placement;
      const prescription = [...exercise.prescription];
      while (prescription.length < exercise.sets.length) {
        prescription.push({ ...(prescription.at(-1) ?? blankPrescription(exercise.restSeconds ?? null, exercise.loadModel, exercise.name)), warmup: false, notes: null });
      }
      prescription[from] = livePrescriptionFor(prescription[from], type);
      const warmup = type === 'warmup';
      const sets = exercise.sets.map((set, si) => si !== from ? set
        : warmup ? { ...set, warmup, rpe: null, rir: null } : { ...set, warmup });
      if (from === to) return { ...exercise, prescription, sets };
      sets.splice(to, 0, ...sets.splice(from, 1));
      prescription.splice(to, 0, ...prescription.splice(from, 1));
      return { ...exercise, prescription, sets: sets.map((set, position) => ({ ...set, position })) };
    })
  };
}
