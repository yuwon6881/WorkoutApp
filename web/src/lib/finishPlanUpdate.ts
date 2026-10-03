import type { DraftExercise, Exercise, ImportDraft, Session, SessionExercise } from '../types';
import { toDraftSet } from './activeSlot';
import {
  applyExerciseEdit, countOccurrences, describeChange, diffExercise,
  type EditScope, type ExerciseChange
} from './exerciseEditScope';

/// Finishing a program workout can carry what was changed during it (sets, set types, notes, rest,
/// a swapped exercise) back into the program, through the same rules the program editor uses when
/// an exercise is saved: only the changed fields travel, and they reach the same written movement
/// in the same block or across the whole program. The workout's own day is part of either scope.
export type FinishPlanScope = Extract<EditScope, 'block' | 'program'>;

export type FinishPlanEdit = {
  sessionExerciseId: string;
  name: string;
  base: DraftExercise;
  edited: DraftExercise;
  change: ExerciseChange;
  /** Other occurrences, outside the workout's own day slot. */
  counts: { block: number; program: number };
};

export type FinishPlanSummary = {
  edits: FinishPlanEdit[];
  /** Other occurrences the block or program choice would reach, summed over the edits. */
  counts: { block: number; program: number };
  changes: string[];
};

/// A cheap, local sign that the workout's plan may differ from its program, so the program is read
/// only when there is something to compare. The server marks an exercise restorable once its plan
/// changed, and a swap is a replacement.
export function mayHavePlanEdits(session: Session): boolean {
  return Boolean(session.programId) && session.exercises.some(exercise =>
    Boolean(exercise.sourceTemplateExerciseId) && (exercise.canRestore || exercise.isReplacement));
}

function locate(draft: ImportDraft, lineId: string): DraftExercise | undefined {
  for (const workout of draft.workouts) {
    const found = workout.exercises.find(exercise => exercise.lineId === lineId);
    if (found) return found;
  }
  return undefined;
}

/// The program exercise as the workout left it. A name is only carried when the exercise itself
/// changed: a library exercise is shown under its catalog name, which is not a rename of the
/// written movement.
function asPlanned(base: DraftExercise, exercise: SessionExercise): DraftExercise {
  const swapped = (exercise.exerciseId ?? null) !== (base.exerciseId ?? null);
  return {
    ...base,
    ...(swapped ? { exerciseId: exercise.exerciseId, sourceName: exercise.name } : {}),
    notes: exercise.note?.trim() ? exercise.note.trim() : null,
    restSeconds: exercise.restSeconds ?? null,
    sets: exercise.prescription.map(toDraftSet)
  };
}

export function finishPlanEdits(session: Session, draft: ImportDraft): FinishPlanSummary {
  const edits: FinishPlanEdit[] = [];
  for (const exercise of session.exercises) {
    if (!exercise.sourceTemplateExerciseId) continue;
    const base = locate(draft, exercise.sourceTemplateExerciseId);
    if (!base) continue;
    const edited = asPlanned(base, exercise);
    const change = diffExercise(base, edited);
    if (!change) continue;
    edits.push({ sessionExerciseId: exercise.id, name: exercise.name, base, edited, change, counts: countOccurrences(draft, base) });
  }
  return {
    edits,
    counts: edits.reduce((total, edit) => ({
      block: total.block + edit.counts.block,
      program: total.program + edit.counts.program
    }), { block: 0, program: 0 }),
    changes: [...new Set(edits.flatMap(edit => describeChange(edit.change)))]
  };
}

/// The program with every edit applied at the chosen scope. Each edit is located again in the
/// running document, so two edits to one day both survive.
export function applyFinishPlan(draft: ImportDraft, edits: FinishPlanEdit[], scope: FinishPlanScope, library: Exercise[]): ImportDraft {
  return edits.reduce((current, edit) => {
    const base = locate(current, edit.base.lineId);
    if (!base) return current;
    return applyExerciseEdit(current, base, asEditedFrom(base, edit), scope, library);
  }, draft);
}

/// Re-applies one edit's changed fields onto the exercise as the running document now holds it.
function asEditedFrom(base: DraftExercise, edit: FinishPlanEdit): DraftExercise {
  const { change, edited } = edit;
  return {
    ...base,
    ...(change.library ? { exerciseId: edited.exerciseId, sourceName: edited.sourceName } : {}),
    ...(change.rest ? { restSeconds: edited.restSeconds } : {}),
    ...(change.notes ? { notes: edited.notes } : {}),
    ...(change.sets ? { sets: edited.sets } : {})
  };
}
