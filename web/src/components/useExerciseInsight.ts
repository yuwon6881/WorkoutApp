import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { viewReadCache } from '../lib/viewReadCache';
import { useCachedViewRead } from './useCachedViewRead';

export function useExerciseInsight(exerciseId: string, onChanged?: () => Promise<void> | void) {
  const [range, setRange] = useState('3m');
  const read = useCachedViewRead(`insight:${exerciseId}:${range}`, 1,
    signal => api.exerciseInsight(exerciseId, range, 0, 20, signal));
  const [historyBusy, setHistoryBusy] = useState(false);
  const busy = useRef(false);

  async function historyCleared() {
    // Invalidate every range even before the shell's changed generation arrives.
    viewReadCache.reset();
    read.update(() => undefined);
    await onChanged?.();
    await read.refresh();
  }

  async function moreHistory() {
    const insight = read.value;
    if (!insight || busy.current || insight.history.length >= insight.totalHistoryRows) return;
    busy.current = true;
    setHistoryBusy(true);
    try {
      const next = await api.exerciseInsight(exerciseId, range, insight.page + 1, insight.size);
      read.update(current => current ? { ...current, history: [...current.history, ...next.history], page: next.page } : next);
    } catch (failure) {
      read.setError(failure instanceof Error ? failure.message : 'Could not load more exercise history.');
    } finally { busy.current = false; setHistoryBusy(false); }
  }

  return { insight: read.value ?? null, range, setRange, error: read.error, setError: read.setError,
    historyBusy, moreHistory, historyCleared };
}
