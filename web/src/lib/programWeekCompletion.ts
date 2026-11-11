import type { ProgramSummary } from '../types';

/**
 * Program weeks are sequential training cycles; they need not match Monday–Sunday.
 * A skipped workout is never a completed one, but it is no longer ahead either, so it is counted
 * on its own: `ratio` is the completed share and `skippedRatio` the share passed without training.
 */
export function programWeekCompletion(program: ProgramSummary | null) {
  if (!program) return null;
  if (!program.active && !program.progress) return null;
  const week = program.progress?.currentWeek
    ?? program.days.find(day => day.id === program.nextTemplateId)?.week
    ?? program.days.at(-1)?.week
    ?? 1;
  const days = program.progress
    ? program.progress.days.filter(day => !day.isRestDay)
    : program.days.filter(day => day.week === week && !day.isRestDay).map(day => ({
        status: day.progressStatus ?? (program.completedTemplateIds.includes(day.id) ? 'completed' : 'pending')
      }));
  const completed = days.filter(day => day.status === 'completed').length;
  const skipped = days.filter(day => day.status === 'skipped').length;
  const total = days.length;
  return { week, completed, skipped, total, ratio: total ? completed / total : 0, skippedRatio: total ? skipped / total : 0 };
}

/** "1 of 4 completed, 1 skipped": what is done and what was passed over. The comma keeps a wrapped
 * caption from opening its second line on a separator, and "1 skipped" never splits. */
export function weekCompletionCaption(completion: { completed: number; skipped: number; total: number }): string {
  if (!completion.total) return 'Rest week';
  const done = `${completion.completed} of ${completion.total} completed`;
  return completion.skipped > 0 ? `${done}, ${completion.skipped} skipped` : done;
}
