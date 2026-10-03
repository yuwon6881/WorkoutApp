import type { DraftSet, DraftWorkout, ImportDraft, Program, ProgramSummary, SetPrescription, Template } from '../types';

/// The active slot holds one program or one standalone workout. Library items carry no run
/// state: leaving the slot forgets progress, so only the active holder is ever "in progress".
export type SlotItem = { kind: 'program'; program: ProgramSummary } | { kind: 'template'; template: Template };

export function slotItemId(item: SlotItem): string {
  return item.kind === 'program' ? item.program.id : item.template.id;
}

export function slotItemName(item: SlotItem): string {
  return item.kind === 'program' ? item.program.name : item.template.name;
}

export function isProgramFinished(program: ProgramSummary): boolean {
  return program.active && program.lifecycleStatus === 'completed';
}

export function isTemplateFinished(template: Template): boolean {
  return Boolean(template.active && template.activeCompletedAt);
}

export function isSlotItemFinished(item: SlotItem): boolean {
  return item.kind === 'program' ? isProgramFinished(item.program) : isTemplateFinished(item.template);
}

/// Whether moving this item out of the active slot would throw away anything the lifter did,
/// which is what decides if the move needs a confirmation.
export function hasSlotProgress(item: SlotItem): boolean {
  if (item.kind === 'template') return isTemplateFinished(item.template);
  const { program } = item;
  if (!program.active) return false;
  if (isProgramFinished(program)) return true;
  const progress = program.progress;
  if (!progress) return false;
  const firstWeek = program.days.length ? Math.min(...program.days.map(day => day.week)) : progress.currentWeek;
  return progress.passedDays > 0 || progress.currentWeek > firstWeek || progress.currentAttempt > 1;
}

/// The resistance mode rides along although the editor never shows it: a saved day sends its sets
/// back whole, and the server reads a missing mode as external load, which would quietly turn a
/// bodyweight set into a loaded one.
export function toDraftSet(set: SetPrescription): DraftSet {
  return {
    repMin: set.repMin, repMax: set.repMax, targetRpe: set.targetRpe, restSeconds: set.restSeconds, tempo: set.tempo,
    loadText: set.loadText, notes: set.notes, repsSource: set.repsSource, rpeSource: set.rpeSource, restSource: set.restSource,
    repsText: set.repsText, restText: set.restText, rir: set.rir, warmup: set.warmup, sourcePage: set.sourcePage ?? null,
    ...(set.resistanceMode ? { resistanceMode: set.resistanceMode } : {})
  };
}

/// A saved program read back into the editor's document shape so the library can show it in
/// the same timeline the builder and import review use. Ids are stable so expanding a day and
/// re-rendering keep the same rows.
export function programToDraft(program: Program): ImportDraft {
  const workouts: DraftWorkout[] = [...program.workouts]
    .sort((left, right) => left.week - right.week || left.position - right.position)
    .map(day => ({
      lineId: day.id,
      week: day.week,
      name: day.name,
      focus: day.focus || null,
      notes: day.note || null,
      block: day.block || null,
      phase: day.phase || null,
      phaseWeek: day.phaseWeek,
      isRestDay: day.isRestDay,
      sourcePage: day.sourcePage ?? null,
      exercises: [...day.exercises]
        .sort((left, right) => left.position - right.position)
        .map(exercise => ({
          lineId: exercise.id,
          sourceName: exercise.name,
          exerciseId: exercise.exerciseId,
          notes: exercise.note || null,
          sets: exercise.sets.map(toDraftSet),
          sequenceGroup: exercise.sequenceGroup,
          substitutions: exercise.substitutions,
          sourcePage: exercise.sourcePage ?? null,
          slotKey: exercise.slotKey ?? null,
          restSeconds: exercise.restSeconds ?? null,
          demoUrl: exercise.demoUrl ?? null,
          demoLinks: exercise.demoLinks ?? null
        }))
    }));
  return { programName: program.name, workouts };
}

/// The template update that saves one edited program day, keeping its revision check.
export function dayTemplateInput(day: DraftWorkout, revision: number) {
  return {
    name: day.name.trim(),
    focus: day.focus?.trim() || null,
    note: day.notes || null,
    block: day.block || null,
    phase: day.phase || null,
    phaseWeek: day.phaseWeek,
    isRestDay: day.isRestDay,
    revision,
    idempotencyId: crypto.randomUUID(),
    exercises: day.exercises.map(exercise => ({
      exerciseId: exercise.exerciseId,
      sourceName: exercise.sourceName,
      note: exercise.notes || null,
      sets: exercise.sets,
      sequenceGroup: exercise.sequenceGroup || null,
      substitutions: exercise.substitutions ?? [],
      sourcePage: exercise.sourcePage ?? null,
      slotKey: exercise.slotKey ?? null,
      restSeconds: exercise.restSeconds ?? null,
      demoUrl: exercise.demoUrl ?? null,
      demoLinks: exercise.demoLinks ?? null
    }))
  };
}

/// The days an edit actually changed, so only those are saved.
export function changedDayIds(before: ImportDraft, after: ImportDraft): string[] {
  const previous = new Map(before.workouts.map(workout => [workout.lineId, JSON.stringify(workout)]));
  return after.workouts.filter(workout => previous.get(workout.lineId) !== JSON.stringify(workout)).map(workout => workout.lineId);
}
