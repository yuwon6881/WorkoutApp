import type { ProgramSummary } from '../types';

/** Program weeks are sequential training cycles; they need not match Monday–Sunday. */
export function programWeekCompletion(program: ProgramSummary | null) {
  if (!program?.active) return null;
  const week = program.progress?.currentWeek
    ?? program.days.find(day => day.id === program.nextTemplateId)?.week
    ?? program.days.at(-1)?.week;
  if (week === undefined) return null;
  const days = program.progress
    ? program.progress.days.filter(day => !day.isRestDay)
    : program.days.filter(day => day.week === week && !day.isRestDay).map(day => ({
      status: day.progressStatus ?? (program.completedTemplateIds.includes(day.id) ? 'completed' : 'pending')
    }));
  const completed = days.filter(day => day.status === 'completed').length;
  return { week, completed, total: days.length, ratio: days.length ? completed / days.length : 0 };
}
