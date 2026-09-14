import type { DraftWorkout, LoggedSet, Session, SetPrescription, TemplateExercise } from '../types';

export type ValidationErrors = Record<string, string>;

const USERNAME_CHARACTERS = /^[A-Za-z0-9_.@-]+$/;

export function validateUsername(value: string, registration: boolean): string | undefined {
  const username = value.trim();
  if (!username) return 'Username is required.';
  if (registration && username.length < 3) return `Username must be at least 3 characters (you are currently using ${username.length}).`;
  if (username.length > 80) return 'Username must be 80 characters or fewer.';
  if (registration && !USERNAME_CHARACTERS.test(username)) return 'Use 3–80 letters, digits, or . _ - @ for your username.';
  return undefined;
}

export function validatePassword(value: string, minimumLength = false): string | undefined {
  if (!value) return 'Password is required.';
  if (minimumLength && value.length < 12) return `Password must be at least 12 characters (you are currently using ${value.length}).`;
  if (value.length > 256) return 'Password must be 256 characters or fewer.';
  return undefined;
}

export function validateAuth(mode: 'login' | 'register', username: string, password: string): ValidationErrors {
  const errors: ValidationErrors = {};
  const usernameError = validateUsername(username, mode === 'register');
  const passwordError = validatePassword(password, mode === 'register');
  if (usernameError) errors.username = usernameError;
  if (passwordError) errors.password = passwordError;
  return errors;
}

export function validatePasswordChange(current: string, next: string): ValidationErrors {
  const errors: ValidationErrors = {};
  const currentError = validatePassword(current);
  const nextError = validatePassword(next, true);
  if (currentError) errors.current = currentError === 'Password is required.' ? 'Current password is required.' : currentError;
  if (nextError) errors.next = nextError;
  return errors;
}

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

export function validateRpe(value: number | null, label = 'RPE'): string | undefined {
  if (value === null) return undefined;
  if (!Number.isFinite(value) || value < 1 || value > 10) return `${label} must be between 1 and 10.`;
  if (Math.abs(value * 2 - Math.round(value * 2)) >= 1e-9) return `${label} must use whole or half points.`;
  return undefined;
}

function validateSubstitutions(substitutions: string[] | null | undefined): string | undefined {
  if (!substitutions) return undefined;
  if (substitutions.length > 2) return 'An exercise can have at most 2 substitutions.';
  return substitutions.map(value => validateName(value, 'Substitution', 160)).find(Boolean);
}

type ValidatablePrescription = Pick<SetPrescription, 'repMin' | 'repMax' | 'targetRpe' | 'restSeconds' | 'tempo' | 'loadText' | 'notes' | 'repsText' | 'restText' | 'percent1Rm' | 'rir'>;

export function validatePrescription(set: ValidatablePrescription): string | undefined {
  const reps = validateInteger(set.repMin, 1, 1000, 'Reps');
  if (reps) return reps;
  const maxReps = validateInteger(set.repMax, 1, 1000, 'Reps');
  if (maxReps) return maxReps;
  if (set.repMin > set.repMax) return 'The lowest rep target cannot exceed the highest.';
  const targetRpe = validateRpe(set.targetRpe, 'Target RPE');
  if (targetRpe) return targetRpe;
  const rest = validateInteger(set.restSeconds, 0, 3600, 'Rest');
  if (rest) return rest;
  for (const [value, label, max] of [
    [set.tempo, 'Tempo', 24], [set.loadText, 'Load', 60], [set.notes, 'Set notes', 400],
    [set.repsText, 'Verbatim reps', 40], [set.restText, 'Verbatim rest', 24], [set.percent1Rm, '%1RM', 24], [set.rir, 'RIR', 16]
  ] as const) {
    const text = validateText(value, label, max);
    if (text) return text;
  }
  return undefined;
}

function validateExercise(exercise: TemplateExercise | {
  sourceName: string; notes: string | null; sequenceGroup: string; substitutions: string[]; sets: ValidatablePrescription[];
}): string | undefined {
  const name = validateName(exercise.sourceName, 'Exercise name', 160);
  if (name) return name;
  const notes = validateText('note' in exercise ? exercise.note : exercise.notes, 'Exercise notes', 1000);
  if (notes) return notes;
  const sequence = validateText(exercise.sequenceGroup, 'Sequence group', 8);
  if (sequence) return sequence;
  const substitutions = validateSubstitutions(exercise.substitutions);
  if (substitutions) return substitutions;
  if (exercise.sets.length === 0) return 'Each exercise needs at least one set.';
  if (exercise.sets.length > 24) return 'An exercise can have at most 24 sets.';
  return exercise.sets.map(validatePrescription).find(Boolean);
}

export function validateTemplateDraft(name: string, focus: string, exercises: TemplateExercise[]): string | undefined {
  const nameError = validateName(name, 'Workout name');
  if (nameError) return nameError;
  const focusError = validateText(focus, 'Focus', 120);
  if (focusError) return focusError;
  if (exercises.length === 0) return 'Add at least one exercise.';
  if (exercises.length > 40) return 'A workout can have at most 40 exercises.';
  return exercises.map(validateExercise).find(Boolean);
}

export function validateImportMetadata(programName: string, description: string | null): string | undefined {
  return validateName(programName, 'Program name') ?? validateText(description, 'Program description', 4000);
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

export function validateLoggedSet(set: LoggedSet): string | undefined {
  const weight = validateNumber(set.weightKg, 0, 1000, 'Weight');
  if (weight) return 'Weight must be between 0 and 1,000 kg.';
  const reps = validateInteger(set.reps, 1, 1000, 'Reps');
  if (reps) return reps;
  const rpe = validateRpe(set.rpe);
  if (rpe) return rpe;
  if (set.done && (set.reps === null || set.rpe === null)) return 'A completed set needs its reps and RPE.';
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
