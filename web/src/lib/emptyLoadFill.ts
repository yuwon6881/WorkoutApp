import type { LoggedSet, Session } from '../types';
import { loadEntryFor } from './resistanceVariant';
import { loadIsEditable } from './workoutDraft';
import { setKind } from './workoutSetTypes';

/// The loads this feature copied into later sets, by set id, so a later change to the source set can
/// move them again while a load the lifter typed over them is left alone.
export type CopiedLoadsLog = Map<string, number>;

const sameLoad = (left: number, right: number) => Math.abs(left - right) < 1e-4;

/**
 * Entering or logging a load on a working set copies it into the later unlogged sets of the same
 * kind whose load is still empty, so a movement with no history (whose sets start blank) needs its
 * weight typed once. Straight sets fill straight sets and each technique its own kind, warm-ups
 * neither give nor take, and a load the lifter typed, the server prefilled, or a set already logged
 * is never replaced: only empty loads, or ones this copied and nobody has changed since.
 */
export function withEmptyLoadsFilled(draft: Session, exerciseIndex: number, setIndex: number, copied: CopiedLoadsLog): Session {
  const exercise = draft.exercises[exerciseIndex];
  const source = exercise?.sets[setIndex];
  if (!exercise || !source || source.weightKg === null || !loadIsEditable(exercise) || loadEntryFor(exercise) === 'none') return draft;
  const sourcePlan = exercise.prescription[setIndex];
  if (source.warmup || sourcePlan?.warmup) return draft;
  const kind = setKind(source, sourcePlan);
  const load = source.weightKg;
  copied.delete(source.id);

  let changed = false;
  const sets: LoggedSet[] = exercise.sets.map((set, index) => {
    if (index <= setIndex || set.done || set.warmup || setKind(set, exercise.prescription[index]) !== kind) return set;
    const previous = copied.get(set.id);
    const ours = set.weightKg === null || (previous !== undefined && sameLoad(previous, set.weightKg));
    if (!ours || (set.weightKg !== null && sameLoad(set.weightKg, load))) return set;
    copied.set(set.id, load);
    changed = true;
    return { ...set, weightKg: load };
  });
  if (!changed) return draft;
  return { ...draft, exercises: draft.exercises.map((item, index) => index === exerciseIndex ? { ...item, sets } : item) };
}
