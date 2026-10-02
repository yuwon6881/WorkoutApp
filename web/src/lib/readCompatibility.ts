import { api } from './api';
import type { RecentExerciseSession } from '../types';

/** Loaded only when a hosted client reaches a server from before the new read endpoints. */
export async function recentSets(id: string, signal?: AbortSignal): Promise<RecentExerciseSession[]> {
  const insight = await api.exerciseInsight(id, 'all', 0, 3, signal);
  const rows = insight.history.filter(row => row.finishedAt).slice(0, 3);
  const sessions = await Promise.all(rows.map(row => api.getWorkout(row.sessionId, signal)));
  return sessions.filter(session => !session.active && session.finishedAt);
}
