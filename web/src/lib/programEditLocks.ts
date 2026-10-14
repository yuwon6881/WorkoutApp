import type { DraftWorkout, ImportDraft, Program, ProgramEditInput } from '../types';
import { templateExerciseInput } from './activeSlot';

/// What the active run has already used up. Weeks before the current week and the days passed in
/// the current week are history: they stay as they are. The server enforces the same rules; this
/// copy lets the editor disable what cannot work and refuse the rest with a reason.
export type ProgramEditLocks = {
  /// The week the run is in, or 0 when the program has no run to protect.
  currentWeek: number;
  /// Days that can no longer be edited, moved, or removed.
  lockedDayIds: ReadonlySet<string>;
  /// Days with an open workout: editable, but they cannot be removed or moved to another week.
  pinnedDayIds: ReadonlySet<string>;
  /// Weeks that hold at least one locked day, so they cannot be deleted or moved.
  historyWeeks: ReadonlySet<number>;
  /// What to call each locked day: Done, Skipped, Rest done, or Past.
  labels: ReadonlyMap<string, string>;
};

export const NO_LOCKS: ProgramEditLocks = {
  currentWeek: 0, lockedDayIds: new Set(), pinnedDayIds: new Set(), historyWeeks: new Set(), labels: new Map()
};

export const hasLocks = (locks: ProgramEditLocks) => locks.currentWeek > 0;

export function programEditLocks(program: Program, activeTemplateId: string | null): ProgramEditLocks {
  const progress = program.progress;
  if (!program.active || !progress) return NO_LOCKS;
  const finished = program.lifecycleStatus === 'completed';
  const currentWeek = progress.currentWeek;
  const completed = new Set(program.completedTemplateIds);
  const skipped = new Set(program.skippedTemplateIds ?? []);
  const locked = new Set<string>();
  const labels = new Map<string, string>();
  const lock = (id: string, label: string) => {
    locked.add(id);
    labels.set(id, label);
  };
  for (const day of program.workouts) {
    if (!finished && day.week >= currentWeek) continue;
    lock(day.id, completed.has(day.id) ? 'Done' : skipped.has(day.id) ? 'Skipped' : day.isRestDay ? 'Rest done' : 'Past');
  }
  for (const day of progress.days) {
    if (day.status === 'pending') continue;
    lock(day.templateId, day.status === 'completed' ? 'Done' : day.status === 'skipped' ? 'Skipped' : 'Rest done');
  }
  const weekOf = new Map(program.workouts.map(day => [day.id, day.week]));
  const history = new Set<number>();
  for (const id of locked) {
    const week = weekOf.get(id);
    if (week !== undefined) history.add(week);
  }
  const pinned = new Set<string>();
  if (activeTemplateId && weekOf.has(activeTemplateId) && !locked.has(activeTemplateId)) pinned.add(activeTemplateId);
  return { currentWeek, lockedDayIds: locked, pinnedDayIds: pinned, historyWeeks: history, labels };
}

const text = (value: string | null | undefined) => value?.trim() ?? '';
/// Blank and the default "Program" label name the same unnamed block.
const blockLabel = (value: string | null | undefined) => {
  const label = text(value);
  return label.toLowerCase() === 'program' ? '' : label;
};

/// A day as a lifter sees and trains with it, so provenance the editor never touches cannot make
/// an untouched past day look edited.
export function daySignature(day: DraftWorkout): string {
  return JSON.stringify([
    text(day.name), text(day.focus), text(day.notes), blockLabel(day.block), text(day.phase), day.isRestDay,
    day.exercises.map(exercise => [
      exercise.exerciseId, text(exercise.sourceName), text(exercise.notes), text(exercise.sequenceGroup),
      exercise.restSeconds ?? null, exercise.slotKey ?? null,
      exercise.sets.map(set => [
        set.repMin, set.repMax, set.targetRpe, set.restSeconds, text(set.tempo), text(set.loadText), text(set.notes),
        text(set.repsText), text(set.restText), text(set.rir), set.warmup, set.resistanceMode ?? 'external'
      ])
    ])
  ]);
}

const describe = (day: DraftWorkout) => `Week ${day.week} "${day.name}"`;

/// Why an edited program would break what the run already did, or null when it respects it.
/// Mirrors the server's rules so a refused change never leaves the editor in an unsavable state.
export function checkProgramEdit(original: ImportDraft, next: ImportDraft, locks: ProgramEditLocks): string | null {
  if (!hasLocks(locks)) return null;
  const edited = new Map(next.workouts.map(day => [day.lineId, day]));
  const known = new Map(original.workouts.map(day => [day.lineId, day]));
  for (const day of original.workouts) {
    const after = edited.get(day.lineId);
    if (locks.lockedDayIds.has(day.lineId)) {
      if (!after) return `${describe(day)} is already past, so it can't be removed.`;
      if (after.week !== day.week || daySignature(after) !== daySignature(day)) return `${describe(day)} is already past, so it can't be changed.`;
    } else if (locks.pinnedDayIds.has(day.lineId)) {
      if (!after) return `${describe(day)} has a workout in progress. Finish or discard it before removing the day.`;
      if (after.week !== day.week) return `${describe(day)} has a workout in progress, so it can't move to another week.`;
    }
  }
  for (const day of next.workouts) {
    if (day.week < locks.currentWeek && !(known.has(day.lineId) && locks.lockedDayIds.has(day.lineId))) {
      return `Weeks before Week ${locks.currentWeek} are already past, so days can't be added or moved into them.`;
    }
  }
  const orderOf = (draft: ImportDraft, week: number) => draft.workouts
    .filter(day => day.week === week && locks.lockedDayIds.has(day.lineId)).map(day => day.lineId).join('|');
  for (const week of locks.historyWeeks) {
    if (orderOf(original, week) !== orderOf(next, week)) return `Days already past in Week ${week} can't be reordered.`;
  }
  if (!next.workouts.some(day => day.week === locks.currentWeek)) {
    return `Week ${locks.currentWeek} is in progress and needs at least one day.`;
  }
  return null;
}

/// Everything the save needs, in the shape the server reads. Days the program already has keep
/// their identity; anything else is sent without an id and becomes a new day.
export function draftToProgramEdit(
  draft: ImportDraft,
  revision: number,
  knownDayIds: ReadonlySet<string>,
  idempotencyId: string
): ProgramEditInput {
  const ordered = [...draft.workouts].sort((left, right) => left.week - right.week);
  return {
    name: draft.programName.trim(),
    revision,
    idempotencyId,
    days: ordered.map(day => ({
      id: knownDayIds.has(day.lineId) ? day.lineId : null,
      week: day.week,
      name: day.name.trim(),
      focus: day.focus?.trim() || null,
      note: day.notes || null,
      block: day.block || null,
      phase: day.phase || null,
      phaseWeek: day.phaseWeek,
      isRestDay: day.isRestDay,
      sourcePage: day.sourcePage ?? null,
      exercises: day.exercises.map(templateExerciseInput)
    }))
  };
}

/// Training exercises of a day the lifter changed or added must come from the library, exactly as
/// when a program is first built. Untouched days are left alone so older data never blocks a save.
export function unmappedExerciseIn(original: ImportDraft, next: ImportDraft): string | null {
  const before = new Map(original.workouts.map(day => [day.lineId, daySignature(day)]));
  for (const day of next.workouts) {
    if (day.isRestDay || before.get(day.lineId) === daySignature(day)) continue;
    const missing = day.exercises.find(exercise => !exercise.exerciseId);
    if (missing) return `Select a library exercise for ${missing.sourceName}.`;
  }
  return null;
}

/// Whether the edited document differs from what was loaded.
export function isEdited(original: ImportDraft, next: ImportDraft): boolean {
  return JSON.stringify(original) !== JSON.stringify(next);
}
