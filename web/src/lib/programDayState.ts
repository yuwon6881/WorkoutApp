import type { ProgramProgressDay } from '../types';

/// How one row of the active program's week reads. A day whose workout is open is "in progress"
/// and never "next": Next always names the following day the lifter still has to do.
export type ProgramDayRowState = 'completed' | 'skipped' | 'in-progress' | 'next' | 'upcoming';

type DayInput = Pick<ProgramProgressDay, 'templateId' | 'status' | 'isRestDay'>;

/// The pending training day the open workout was started from, if it is in the shown week.
export function inProgressDayId(
  days: readonly DayInput[],
  activeTemplateId: string | null | undefined,
  hasActiveWorkout: boolean
): string | null {
  if (!hasActiveWorkout || !activeTemplateId) return null;
  const day = days.find(entry => entry.templateId === activeTemplateId);
  return day && !day.isRestDay && day.status === 'pending' ? day.templateId : null;
}

/// The first pending day that is neither already passed (optimistically, while a save is in
/// flight) nor the workout that is currently open.
export function nextDayId(
  days: readonly DayInput[],
  passedOptimistically: ReadonlySet<string>,
  runningId: string | null
): string | undefined {
  return days.find(day => day.status === 'pending'
    && !passedOptimistically.has(day.templateId)
    && day.templateId !== runningId)?.templateId;
}

export function dayRowState(day: DayInput, nextId: string | undefined, runningId: string | null): ProgramDayRowState {
  if (day.status === 'completed') return 'completed';
  if (day.status === 'skipped' || day.status === 'rest_passed') return 'skipped';
  if (day.templateId === runningId) return 'in-progress';
  return day.templateId === nextId ? 'next' : 'upcoming';
}
