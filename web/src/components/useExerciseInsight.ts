import { useEffect, useRef, useState } from 'react';
import type { ExerciseInsight } from '../types';
import { api } from '../lib/api';
import { viewReadCache } from '../lib/viewReadCache';
import { useCachedViewRead } from './useCachedViewRead';

/// History does not depend on the chart's range, so pages already loaded stay when a new range (or
/// a background refresh) answers with only the first page of the same history.
export function keepLoadedHistory(previous: ExerciseInsight | null, next: ExerciseInsight): ExerciseInsight {
  if (!previous || previous.history.length <= next.history.length) return next;
  if (previous.totalHistoryRows !== next.totalHistoryRows) return next;
  if (previous.history[0]?.sessionId !== next.history[0]?.sessionId) return next;
  return { ...next, history: previous.history, page: previous.page };
}

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
  // The last insight shown for this exercise. A range change keeps it on screen until the new
  // range answers, so the chart, the records and the Range control itself never blank out.
  const held = useRef<{ exerciseId: string; insight: ExerciseInsight } | null>(null);
  const previous = held.current?.exerciseId === exerciseId ? held.current.insight : null;
  const fresh = read.value ?? null;
  const merged = fresh ? keepLoadedHistory(previous, fresh) : null;
  if (merged) held.current = { exerciseId, insight: merged };
  const insight = merged ?? previous;

  useEffect(() => {
    if (fresh && merged && merged !== fresh) read.replace(merged);
  }, [fresh, merged]);

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
    held.current = null;
    // Invalidate every range even before the shell's changed generation arrives.
    viewReadCache.reset();
    read.update(() => undefined);
    await onChanged?.();
    await read.refresh();
  }

  async function moreHistory() {
    // Only the current range's own answer carries the page to continue from.
    const current = merged;
    if (!current || busy.current || current.history.length >= current.totalHistoryRows) return;
    const requestTarget = target;
    const requestEpoch = clearEpoch.current;
    const controller = new AbortController();
    historyController.current = controller;
    busy.current = true;
    setLoadingTarget(requestTarget);
    try {
      const next = await api.exerciseInsight(exerciseId, range, current.page + 1, current.size, controller.signal);
      if (controller.signal.aborted || currentTarget.current !== requestTarget || clearEpoch.current !== requestEpoch) return;
      read.replace({ ...current, history: [...current.history, ...next.history], page: next.page });
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

  return { insight, range, setRange, error: read.error, setError: read.setError,
    /** The shown figures belong to the previous range while the chosen one is still being read. */
    rangeLoading: merged === null && previous !== null && !read.error,
    historyBusy: loadingTarget === target, moreHistory, historyCleared };
}
