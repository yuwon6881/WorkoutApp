import type { ProgramDayActionInput, ProgramProgressDay, ProgramSummary } from '../types';

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

/// What every program day action (skip, pass a rest day) sends so the server can reject a stale view.
export function programDayActionInput(program: ProgramSummary): ProgramDayActionInput {
  const progress = program.progress;
  if (!progress) throw new Error('The current program week is not available. Refresh and try again.');
  return {
    revision: program.revision,
    runId: progress.runId,
    week: progress.currentWeek,
    attempt: progress.currentAttempt,
    idempotencyId: crypto.randomUUID()
  };
}

/// The pending rest day the lifter may pass now (the preferred one when it qualifies, else the
/// first), or null when the program is not running, still optimistic, or has none pending.
export function passableRestDayId(program: ProgramSummary | null | undefined, preferredId?: string | null): string | null {
  const progress = program?.progress;
  if (!program?.active || !progress || progress.runId === 'optimistic') return null;
  const pending = progress.days.filter(day => day.isRestDay && day.status === 'pending');
  return (pending.find(day => day.templateId === preferredId) ?? pending[0])?.templateId ?? null;
}

/// All pending rest days that should be passed together from the hero view.
/// When all training days in the current week are completed (or in a rest-only week),
/// passing clears every remaining pending rest day in the week so the week can advance.
/// When earlier training days are still pending, it clears the consecutive pending rest block
/// starting at the preferred or next rest day.
export function passableRestDayIds(program: ProgramSummary | null | undefined, preferredId?: string | null): string[] {
  const progress = program?.progress;
  if (!program?.active || !progress || progress.runId === 'optimistic') return [];
  const currentWeek = progress.currentWeek;
  let weekDays = progress.days;
  if (program.days && program.days.length > 0) {
    const currentWeekTemplateIds = new Set(program.days.filter(d => d.week === currentWeek).map(d => d.id));
    const filtered = weekDays.filter(d => currentWeekTemplateIds.has(d.templateId));
    if (filtered.length > 0) weekDays = filtered;
  }
  const pending = weekDays.filter(day => day.isRestDay && day.status === 'pending');
  if (pending.length === 0) return [];

  const trainingDays = weekDays.filter(day => !day.isRestDay);
  const pendingTrainingCount = trainingDays.filter(day => day.status === 'pending').length;

  if (pendingTrainingCount === 0) {
    return pending.map(day => day.templateId);
  }

  const startIndex = preferredId ? weekDays.findIndex(d => d.templateId === preferredId) : -1;
  const effectiveStart = startIndex >= 0 ? startIndex : weekDays.findIndex(d => d.status === 'pending' && d.isRestDay);
  if (effectiveStart < 0) return [pending[0].templateId];

  const batch: string[] = [];
  for (let i = effectiveStart; i < weekDays.length; i++) {
    const d = weekDays[i];
    if (!d.isRestDay) break;
    if (d.status === 'pending') batch.push(d.templateId);
  }
  return batch.length > 0 ? batch : [pending[0].templateId];
}

/// Passes the given rest days one after another, each against the revision the last pass returned.
/// A failure stops the run but reports how many days the server already saved, so the caller can
/// refresh the view instead of showing a week that no longer matches the server.
export async function passRestDaysInOrder(
  program: ProgramSummary,
  dayIds: readonly string[],
  pass: (program: ProgramSummary, dayId: string) => Promise<ProgramSummary | void>
): Promise<{ passed: number; failure: unknown }> {
  let current = program;
  let passed = 0;
  for (const dayId of dayIds) {
    try {
      const updated = await pass(current, dayId);
      if (updated) current = { ...current, revision: updated.revision, progress: updated.progress ?? current.progress };
      passed++;
    } catch (failure) {
      return { passed, failure };
    }
  }
  return { passed, failure: null };
}
