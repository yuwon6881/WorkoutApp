import type { DraftWorkout, ImportDraft, LoggedSet, Session, SetPrescription, TemplateExercise } from '../types';
import { MAX_DAYS_PER_WEEK } from './programLimits';

export function validateName(value: string | null | undefined, label: string, max = 120): string | undefined {
  if (!value?.trim()) return `${label} is required.`;
  if (value.trim().length > max) return `${label} must be ${max} characters or fewer.`;
  return undefined;
}

export function validateText(value: string | null | undefined, label: string, max: number): string | undefined {
  return value !== null && value !== undefined && value.length > max ? `${label} must be ${max} characters or fewer.` : undefined;
}

export function validateNumber(value: number | null, min: number, max: number, label: string): string | undefined {
  return value !== null && (!Number.isFinite(value) || value < min || value > max)
    ? `${label} must be between ${min.toLocaleString()} and ${max.toLocaleString()}.`
    : undefined;
}

export function validateInteger(value: number | null, min: number, max: number, label: string): string | undefined {
  return value !== null && (!Number.isInteger(value) || value < min || value > max)
    ? `${label} must be a whole number between ${min.toLocaleString()} and ${max.toLocaleString()}.`
    : undefined;
}

export function validateExerciseLoads(raw: string, kilograms: number[], list: boolean): string | undefined {
  if (!raw.trim() || kilograms.some(value => !Number.isFinite(value) || value < 0))
    return 'Enter valid, non-negative weights.';
  if (list && (kilograms.length > 200 || new Set(kilograms).size < 2))
    return 'Enter between 2 and 200 different available weights.';
  if (kilograms.some(value => value > (list ? 1000 : 50) + 1e-9))
    return list ? 'Each available weight must be at most 1,000 kg (2,204.62 lb).' : 'The increment must be at most 50 kg (110.23 lb).';
  return undefined;
}

export function validateRpe(value: number | null, label = 'RPE'): string | undefined {
  if (value === null) return undefined;
  if (!Number.isFinite(value) || value < 6 || value > 10) return `${label} must be between 6 and 10.`;
  if (Math.abs(value * 2 - Math.round(value * 2)) >= 1e-9) return `${label} must use whole or half points.`;
  return undefined;
}

export function validateTargetRpe(value: number | null, warmup = false): string | undefined {
  if (warmup && value === null) return undefined;
  if (value === null) return 'Working sets need a target RPE from 6 to 10.';
  if (!Number.isFinite(value) || value < 6 || value > 10) return 'Target RPE must be between 6 and 10.';
  if (Math.abs(value * 2 - Math.round(value * 2)) >= 1e-9) return 'Target RPE must use whole or half points.';
  return undefined;
}

function validateSubstitutions(substitutions: string[] | null | undefined): string | undefined {
  if (!substitutions) return undefined;
  if (substitutions.length > 2) return 'An exercise can have at most 2 substitutions.';
  return substitutions.map(value => validateName(value, 'Substitution', 160)).find(Boolean);
}

type ValidatablePrescription = Pick<SetPrescription, 'repMin' | 'repMax' | 'targetRpe' | 'restSeconds' | 'tempo' | 'loadText' | 'notes' | 'repsText' | 'restText' | 'rir' | 'warmup'>;

export function validatePrescription(set: ValidatablePrescription, requireWorkingRpe = false): string | undefined {
  // Both bounds empty is a set with no rep target; one empty bound is an unfinished range.
  if ((set.repMin === null) !== (set.repMax === null)) return 'Give both rep bounds or leave both empty.';
  const reps = validateInteger(set.repMin, 1, 1000, 'Reps');
  if (reps) return reps;
  const maxReps = validateInteger(set.repMax, 1, 1000, 'Reps');
  if (maxReps) return maxReps;
  if (set.repMin !== null && set.repMax !== null && set.repMin > set.repMax) return 'The lowest rep target cannot exceed the highest.';
  const targetRpe = validateRpe(set.targetRpe, 'Target RPE');
  if (targetRpe) return targetRpe;
  if (requireWorkingRpe) {
    const targetError = validateTargetRpe(set.targetRpe, set.warmup);
    if (targetError) return targetError;
  }
  const rest = validateInteger(set.restSeconds, 0, 3600, 'Rest');
  if (rest) return rest;
  for (const [value, label, max] of [
    [set.tempo, 'Tempo', 24], [set.loadText, 'Load', 60], [set.notes, 'Set notes', 400],
    [set.repsText, 'Verbatim reps', 40], [set.restText, 'Verbatim rest', 24], [set.rir, 'RIR', 16]
  ] as const) {
    const text = validateText(value, label, max);
    if (text) return text;
  }
  return undefined;
}

export function validateExerciseRestSeconds(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return validateInteger(value, 0, 3600, 'Rest');
}

function validateExercise(exercise: TemplateExercise | {
  sourceName: string; notes: string | null; sequenceGroup: string; substitutions: string[]; sets: ValidatablePrescription[]; restSeconds?: number | null;
}, requireWorkingRpe = false): string | undefined {
  const name = validateName(exercise.sourceName, 'Exercise name', 160);
  if (name) return name;
  const notes = validateText('note' in exercise ? exercise.note : exercise.notes, 'Exercise notes', 1000);
  if (notes) return notes;
  const sequence = validateText(exercise.sequenceGroup, 'Sequence group', 8);
  if (sequence) return sequence;
  const substitutions = validateSubstitutions(exercise.substitutions);
  if (substitutions) return substitutions;
  const restError = validateExerciseRestSeconds(exercise.restSeconds);
  if (restError) return restError;
  if (exercise.sets.length === 0) return 'Each exercise needs at least one set.';
  if (exercise.sets.length > 24) return 'An exercise can have at most 24 sets.';
  return exercise.sets.map(set => validatePrescription(set, requireWorkingRpe)).find(Boolean);
}

export function validateTemplateDraft(name: string, focus: string, exercises: TemplateExercise[]): string | undefined {
  const nameError = validateName(name, 'Workout name');
  if (nameError) return nameError;
  const focusError = validateText(focus, 'Focus', 120);
  if (focusError) return focusError;
  if (exercises.length === 0) return 'Add at least one exercise.';
  if (exercises.length > 40) return 'A workout can have at most 40 exercises.';
  return exercises.map(exercise => validateExercise(exercise, true)).find(Boolean);
}

export function validateDraftWorkout(day: DraftWorkout): string | undefined {
  const name = validateName(day.name, 'Workout name');
  if (name) return name;
  const block = validateText(day.block, 'Block', 80);
  if (block) return block;
  const phase = validateText(day.phase, 'Phase', 120);
  if (phase) return phase;
  const focus = validateText(day.focus, 'Focus', 120);
  if (focus) return focus;
  const notes = validateText(day.notes, 'Workout notes', 2000);
  if (notes) return notes;
  if (day.isRestDay && day.exercises.length > 0) return 'A rest day cannot contain exercises.';
  if (!day.isRestDay && day.exercises.length === 0) return 'Each workout needs at least one exercise.';
  if (day.exercises.length > 40) return 'A workout can have at most 40 exercises.';
  for (const exercise of day.exercises) {
    const error = validateExercise(exercise);
    if (error) return error;
  }
  return undefined;
}

export function validateProgramEditorDocument(document: ImportDraft, requireCatalogExercises = false): string | undefined {
  const name = validateName(document.programName, 'Program name');
  if (name) return name;
  const days = document.workouts;
  if (!days.length) return 'Add a week with at least one day.';
  if (days.length > 400) return 'A program can have at most 400 days.';
  const dayIds = new Set<string>();
  const weeks = new Map<number, DraftWorkout[]>();
  for (const day of days) {
    if (!dayIds.add(day.lineId)) return 'Each day must have a unique identity.';
    if (!day.blockId || !day.weekId) return 'Save the program structure before creating it.';
    if (day.week < 1 || day.week > 104 || !Number.isInteger(day.week)) return 'Program weeks must be between 1 and 104.';
    weeks.set(day.week, [...(weeks.get(day.week) ?? []), day]);
  }
  if (weeks.size > 104) return 'A program can have at most 104 weeks.';
  const orderedWeeks = [...weeks.entries()].sort(([left], [right]) => left - right);
  if (orderedWeeks.some(([week], index) => week !== index + 1)) return 'Program weeks must be in order without gaps.';
  if (orderedWeeks.some(([, weekDays]) => weekDays.length > MAX_DAYS_PER_WEEK)) return `A week can contain at most ${MAX_DAYS_PER_WEEK} days.`;
  if (orderedWeeks.some(([, weekDays]) => weekDays.some(day => day.blockId !== weekDays[0].blockId || day.weekId !== weekDays[0].weekId))) {
    return 'Every week must belong to one block and have one identity.';
  }
  const blockIds = orderedWeeks.map(([, weekDays]) => weekDays[0].blockId!);
  const completedBlocks = new Set<string>();
  const blockNames = new Map<string, string>();
  let previousBlock = '';
  for (const [index, blockId] of blockIds.entries()) {
    if (blockId !== previousBlock && completedBlocks.has(blockId)) return 'Block weeks must remain together.';
    if (previousBlock && blockId !== previousBlock) completedBlocks.add(previousBlock);
    const blockDays = orderedWeeks[index][1];
    const name = (blockDays[0].block ?? '').trim();
    const existingName = blockNames.get(blockId);
    if (existingName !== undefined && existingName !== name) return 'Each block must have one name.';
    blockNames.set(blockId, name);
    previousBlock = blockId;
  }
  const uniqueNames = new Set<string>();
  for (const name of blockNames.values()) {
    const normalized = name.toLocaleLowerCase();
    if (uniqueNames.has(normalized)) return 'Give each block a different name.';
    uniqueNames.add(normalized);
  }
  if (!days.some(day => !day.isRestDay)) return 'A program needs at least one training day.';
  const workoutIds = new Set<string>();
  for (const day of days) {
    const invalid = validateDraftWorkout(day);
    if (invalid) return invalid;
    for (const exercise of day.exercises) {
      if (requireCatalogExercises && !exercise.exerciseId) return `Select a library exercise for ${exercise.sourceName}.`;
      if (workoutIds.has(exercise.lineId)) return 'Each exercise must have a unique identity.';
      workoutIds.add(exercise.lineId);
    }
  }
  return undefined;
}

export function validateLoggedSet(set: LoggedSet): string | undefined {
  const weight = validateNumber(set.weightKg, 0, 1000, 'Weight');
  if (weight) return 'Weight must be between 0 and 1,000 kg.';
  const reps = validateInteger(set.reps, 1, 1000, 'Reps');
  if (reps) return reps;
  const rpe = validateRpe(set.rpe);
  if (rpe) return rpe;
  if (set.done && set.reps === null) return 'A completed set needs its reps.';
  return undefined;
}

export function validateSessionDraft(session: Session): string | undefined {
  const note = validateText(session.note, 'Workout notes', 4000);
  if (note) return note;
  for (const exercise of session.exercises) {
    const name = validateName(exercise.name, 'Exercise name', 160);
    if (name) return name;
    const exerciseNote = validateText(exercise.note, 'Exercise notes', 1000);
    if (exerciseNote) return exerciseNote;
    if (exercise.sets.length > 24) return 'An exercise can have at most 24 sets.';
    for (const set of exercise.sets) {
      const error = validateLoggedSet(set);
      if (error) return error;
    }
  }
  return undefined;
}
