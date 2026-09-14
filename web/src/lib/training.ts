import type { LoggedSet, Session, SetPrescription, Unit } from '../types';

const PER_KG = 2.2046226218;

/// Storage is kilograms. Display converts, and an unknown load stays unknown rather than
/// becoming a zero the user never entered.
export const toDisplay = (kg: number | null, unit: Unit): number | null =>
  kg === null ? null : unit === 'lb' ? Math.round(kg * PER_KG * 100) / 100 : kg;

export const toKg = (value: number | null, unit: Unit): number | null =>
  value === null ? null : unit === 'lb' ? Math.round((value / PER_KG) * 1000) / 1000 : value;

export const showWeight = (kg: number | null, unit: Unit): string => {
  const value = toDisplay(kg, unit);
  return value === null ? '—' : `${Number(value.toFixed(2))} ${unit}`;
};

export const showVolume = (kg: number | null, unit: Unit): string => {
  const value = toDisplay(kg, unit);
  return value === null ? '—' : `${Math.round(value).toLocaleString()} ${unit}`;
};

/// The rep target as the program wrote it: a single number or a range, never flattened.
export const showReps = (set: SetPrescription | { repMin: number; repMax: number }): string =>
  'repsText' in set && set.repsText?.trim() ? set.repsText : set.repMin === set.repMax ? String(set.repMin) : `${set.repMin}–${set.repMax}`;

export const showRpe = (rpe: number | null): string => rpe === null ? '—' : `RPE ${Number(rpe.toFixed(1))}`;

export const completedSets = (session: Session): LoggedSet[] => session.exercises.flatMap(e => e.sets).filter(s => s.done && !s.warmup);

export const plannedSets = (session: Session): number => session.exercises.reduce((total, e) => total + e.sets.filter(s => !s.warmup).length, 0);

export const normalizeExerciseName = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean).join(' ');

export const showTarget = (set: SetPrescription): string => {
  const parts = [showReps(set)];
  if (set.targetRpe !== null) parts.push(`RPE ${set.targetRpe}`);
  if (set.percent1Rm) parts.push(set.percent1Rm);
  if (set.rir) parts.push(`RIR ${set.rir}`);
  return parts.join(' · ');
};

export const duration = (session: Session): number => {
  const end = session.finishedAt ? Date.parse(session.finishedAt) : Date.now();
  return Math.max(1, Math.round((end - Date.parse(session.startedAt)) / 60000));
};

export const localDate = (value: string | number | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export function weekDays(offset = 0): Date[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const day = new Date(start); day.setDate(day.getDate() + i); return day; });
}

/// RPE is recorded in half points from 1 to 10; anything else is a typing error.
export const validRpe = (value: number | null): boolean =>
  value !== null && Number.isFinite(value) && value >= 1 && value <= 10 && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;

export const validReps = (value: number | null): boolean =>
  value !== null && Number.isInteger(value) && value > 0 && value <= 1000;

export const canComplete = (set: LoggedSet): boolean => validReps(set.reps) && validRpe(set.rpe);

export const rpeSteps = Array.from({ length: 19 }, (_, i) => 1 + i * 0.5);
