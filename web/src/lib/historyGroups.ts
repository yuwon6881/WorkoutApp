/** One calendar month of finished workouts, newest first, as the history list shows them. */
export type HistoryMonth<T> = { key: string; label: string; sessions: T[] };

/// Month of the workout in the viewer's own calendar, as its date is shown.
function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Splits a newest-first history page into calendar months by start date, keeping the page's order.
 * A month split across pages stays one group because the pages arrive in the same order.
 */
export function historyMonths<T extends { startedAt: string }>(sessions: T[]): HistoryMonth<T>[] {
  const months: HistoryMonth<T>[] = [];
  for (const session of sessions) {
    const started = new Date(session.startedAt);
    const key = monthKey(started);
    const current = months.at(-1);
    if (current?.key === key) current.sessions.push(session);
    else months.push({ key, label: started.toLocaleDateString('en', { month: 'long', year: 'numeric' }), sessions: [session] });
  }
  return months;
}

/** The short month and day a history row's date tile shows. */
export function historyDay(startedAt: string): { month: string; day: string; full: string } {
  const date = new Date(startedAt);
  return {
    month: date.toLocaleDateString('en', { month: 'short' }),
    day: String(date.getDate()),
    full: date.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  };
}
