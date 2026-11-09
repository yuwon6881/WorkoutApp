import { useMemo } from 'react';
import { api } from '../lib/api';
import type { ExerciseLastPerformed } from '../lib/lastPerformed';
import { useCachedViewRead } from './useCachedViewRead';

/// Each exercise's last top set, for the library's cards. A convenience: until it loads, or if it
/// cannot, the cards simply show no "Last" line. Reused in account-scoped memory between visits.
export function useLastPerformed(enabled: boolean): ReadonlyMap<string, ExerciseLastPerformed> {
  const read = useCachedViewRead('last-performed', 1, signal => api.lastPerformed(signal), enabled);
  return useMemo(() => new Map((read.value ?? []).map(row => [row.exerciseId, row])), [read.value]);
}
