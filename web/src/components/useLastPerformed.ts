import { useMemo } from 'react';
import { api } from '../lib/api';
import type { ExerciseLastPerformed } from '../lib/lastPerformed';
import { useCachedViewRead } from './useCachedViewRead';

export type LastPerformedRead = {
  map: ReadonlyMap<string, ExerciseLastPerformed>;
  settled: boolean;
};

/// Each exercise's last top set, for the library's cards, overview plan, and workout preview.
/// Reused in account-scoped memory between visits, defaulting to an empty map if unavailable.
export function useLastPerformedRead(enabled: boolean): LastPerformedRead {
  const read = useCachedViewRead('last-performed', 1, signal => api.lastPerformed(signal), enabled);
  const map = useMemo<ReadonlyMap<string, ExerciseLastPerformed>>(
    () => new Map((read.value ?? []).map(row => [row.exerciseId, row])),
    [read.value]
  );
  const settled = !enabled || !read.loading || read.value !== undefined || Boolean(read.error);
  return { map, settled };
}

/// Convenience selector for callers that display loaded "Last" labels without reserving layout.
export function useLastPerformed(enabled: boolean): ReadonlyMap<string, ExerciseLastPerformed> {
  return useLastPerformedRead(enabled).map;
}
