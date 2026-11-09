import { useCallback, useEffect, useRef, useState } from 'react';
import { viewReadCache } from '../lib/viewReadCache';
import { useViewReadScope } from '../lib/viewReadScope';

/** A changed account/generation cannot render or publish an older request, including one that
 * finishes after cancellation. Responses live only in the bounded, memory-only view cache. */
export function useCachedViewRead<T>(key: string, version: string | number,
  load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const scope = useViewReadScope();
  const cacheKey = `${scope}:${key}`;
  const identity = JSON.stringify([cacheKey, version, enabled]);
  const latest = useRef(identity);
  latest.current = identity;
  const loader = useRef(load);
  loader.current = load;
  const controller = useRef<AbortController | null>(null);
  const cached = scope && enabled ? viewReadCache.get<T>(cacheKey, version) : undefined;
  const [state, setState] = useState<{ identity: string; value?: T; error: string; loading: boolean }>(
    () => ({ identity, value: cached, error: '', loading: enabled && cached === undefined }));
  const current = state.identity === identity ? state : { identity, value: cached, error: '', loading: enabled && cached === undefined };

  const refresh = useCallback(async () => {
    if (!enabled || latest.current !== identity) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setState(previous => ({ identity, value: previous.identity === identity ? previous.value : undefined, error: '', loading: true }));
    try {
      const value = await loader.current(active.signal);
      if (active.signal.aborted || latest.current !== identity) return;
      if (scope) viewReadCache.set(cacheKey, version, value);
      setState({ identity, value, error: '', loading: false });
    } catch (failure) {
      if (active.signal.aborted || latest.current !== identity) return;
      setState(previous => ({ ...previous, loading: false, error: failure instanceof Error ? failure.message : 'Could not load this view.' }));
    }
  }, [identity, enabled, scope, cacheKey, version]);

  useEffect(() => {
    setState({ identity, value: cached, error: '', loading: enabled && cached === undefined });
    if (enabled && (!scope || !viewReadCache.fresh(cacheKey, version))) void refresh();
    return () => controller.current?.abort();
  }, [identity, refresh]);

  const update = (change: (value: T | undefined) => T | undefined) => {
    if (latest.current !== identity) return;
    setState(previous => previous.identity === identity ? { ...previous, value: change(previous.value) } : previous);
  };
  const setError = (error: string) => {
    if (latest.current === identity) setState(previous => ({ ...previous, error }));
  };
  const replace = (value: T) => {
    if (latest.current !== identity) return;
    if (scope) viewReadCache.set(cacheKey, version, value);
    setState({ identity, value, error: '', loading: false });
  };
  return { value: current.value, error: current.error, loading: current.loading, refresh, update, replace, setError };
}
