import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { viewReadCache } from '../lib/viewReadCache';
import { useCachedViewRead } from './useCachedViewRead';

export function useExerciseInsight(exerciseId: string, onChanged?: () => Promise<void> | void) {
  const [range, setRange] = useState('3m');
  const read = useCachedViewRead(`insight:${exerciseId}:${range}`, 1,
    signal => api.exerciseInsight(exerciseId, range, 0, 20, signal));
  const [loadingTarget, setLoadingTarget] = useState<string | null>(null);
  const busy = useRef(false);
  const target = `${exerciseId}:${range}`;
  const currentTarget = useRef(target);
  currentTarget.current = target;
  const clearEpoch = useRef(0);
  const historyController = useRef<AbortController | null>(null);

  useEffect(() => () => {
    historyController.current?.abort();
    historyController.current = null;
    busy.current = false;
    setLoadingTarget(null);
  }, [exerciseId, range]);

  async function historyCleared() {
    clearEpoch.current++;
    historyController.current?.abort();
    historyController.current = null;
    busy.current = false;
    setLoadingTarget(null);
    // Invalidate every range even before the shell's changed generation arrives.
    viewReadCache.reset();
    read.update(() => undefined);
    await onChanged?.();
    await read.refresh();
  }

  async function moreHistory() {
    const insight = read.value;
    if (!insight || busy.current || insight.history.length >= insight.totalHistoryRows) return;
    const requestTarget = target;
    const requestEpoch = clearEpoch.current;
    const controller = new AbortController();
    historyController.current = controller;
    busy.current = true;
    setLoadingTarget(requestTarget);
    try {
      const next = await api.exerciseInsight(exerciseId, range, insight.page + 1, insight.size, controller.signal);
      if (controller.signal.aborted || currentTarget.current !== requestTarget || clearEpoch.current !== requestEpoch) return;
      read.replace({ ...insight, history: [...insight.history, ...next.history], page: next.page });
    } catch (failure) {
      if (controller.signal.aborted || currentTarget.current !== requestTarget || clearEpoch.current !== requestEpoch) return;
      read.setError(failure instanceof Error ? failure.message : 'Could not load more exercise history.');
    } finally {
      if (historyController.current === controller) {
        historyController.current = null;
        busy.current = false;
        setLoadingTarget(current => current === requestTarget ? null : current);
      }
    }
  }

  return { insight: read.value ?? null, range, setRange, error: read.error, setError: read.setError,
    historyBusy: loadingTarget === target, moreHistory, historyCleared };
}
