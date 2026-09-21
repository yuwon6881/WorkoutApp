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

/// Mirrors the server's estimate so the app can show one for a set the user is typing, before
/// anything is saved. Epley extended with reps in reserve: the set is rated as if it had been
/// carried to failure. Outside the range the equation holds, there is no estimate to give.
export const estimate1Rm = (weightKg: number | null, reps: number | null, rpe: number | null): number | null => {
  if (weightKg === null || reps === null || rpe === null) return null;
  if (weightKg <= 0 || reps <= 0 || rpe < 6) return null;
  const total = reps + (10 - rpe);
  return total > 12 ? null : weightKg * (1 + total / 30);
};

/// Minutes and seconds, for a clock the user is watching rather than reading.
export const showClock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;

export const completedSets = (session: Session): LoggedSet[] => session.exercises.flatMap(e => e.sets).filter(s => s.done && !s.warmup);

export const plannedSets = (session: Session): number => session.exercises.reduce((total, e) => total + e.sets.filter(s => !s.warmup).length, 0);

export const normalizeExerciseName = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean).join(' ');

export const showTarget = (set: SetPrescription): string => {
  const parts = [showReps(set)];
  if (set.targetRpe !== null) parts.push(`RPE ${set.targetRpe}`);
  else if (!set.warmup) parts.push('app default RPE 8');
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

/// RPE is recorded in half points from 6 to 10; anything else is a typing error.
export const validRpe = (value: number | null): boolean =>
  value !== null && Number.isFinite(value) && value >= 6 && value <= 10 && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;

export const validReps = (value: number | null): boolean =>
  value !== null && Number.isInteger(value) && value > 0 && value <= 1000;

export const canComplete = (set: LoggedSet): boolean => validReps(set.reps);

export const rpeSteps = Array.from({ length: 9 }, (_, i) => 6 + i * 0.5);
export const rpeOptions = rpeSteps.map(value => ({ value, label: String(value) }));

export const formatRest = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined || seconds === 0) return 'No rest';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
};

const STANDARD_REST_SECONDS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];

export const restOptions = (currentSeconds?: number | null): { value: number; label: string }[] => {
  const values = [...STANDARD_REST_SECONDS];
  if (typeof currentSeconds === 'number' && !values.includes(currentSeconds) && currentSeconds >= 0 && currentSeconds <= 3600) {
    values.push(currentSeconds);
    values.sort((a, b) => a - b);
  }
  return values.map(value => ({
    value,
    label: formatRest(value)
  }));
};
