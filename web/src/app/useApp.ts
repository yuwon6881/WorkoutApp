import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { SaveQueue } from '../lib/queue';
import type { QueueStatus } from '../lib/queue';
import type { Bootstrap, Preferences, Session } from '../types';

export type AppState = {
  data: Bootstrap | null;
  status: QueueStatus;
  loading: boolean;
  error: string;
  signedOut: boolean;
  online: boolean;
  reload: () => Promise<void>;
  queue: SaveQueue;
  setData: (update: (current: Bootstrap) => Bootstrap) => void;
  savePreferences: (preferences: Preferences) => void;
  setActiveWorkout: (session: Session | null) => void;
  signOut: () => Promise<void>;
};

/// Every piece of training data comes from the server on each load. Nothing is read from or
/// written to device storage, so a signed-out or offline app shows its state plainly instead
/// of pretending to have data.
export function useApp(): AppState {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const queue = useMemo(() => new SaveQueue(), []);
  const [status, setStatus] = useState<QueueStatus>(queue.current);
  const loaded = useRef(false);

  useEffect(() => queue.subscribe(next => {
    setStatus(next);
    if (next.state === 'signed-out') { setSignedOut(true); setData(null); }
  }), [queue]);

  const reload = useCallback(async () => {
    setLoading(true);
    queue.set('connecting');
    try {
      const next = await api.bootstrap();
      setData(next); setError(''); setSignedOut(false);
      queue.clear();
    } catch (failure) {
      const problem = failure instanceof ApiError ? failure : new ApiError('Could not load your training.', -1);
      if (problem.signedOut) { setSignedOut(true); setData(null); setError(''); queue.set('signed-out'); }
      else { setError(problem.message); queue.set(problem.offline ? 'offline' : 'failed', problem.message); }
    } finally {
      setLoading(false);
      loaded.current = true;
    }
  }, [queue]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  // Leaving with work still queued would lose it: there is no local copy to come back to.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (queue.unsaved) event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [queue]);

  const patch = useCallback((update: (current: Bootstrap) => Bootstrap) =>
    setData(current => current ? update(current) : current), []);

  const savePreferences = useCallback((preferences: Preferences) => {
    patch(current => ({ ...current, preferences }));
    queue.push('preferences', async () => {
      const saved = await api.preferences(preferences);
      patch(current => ({ ...current, preferences: saved }));
    });
  }, [patch, queue]);

  const setActiveWorkout = useCallback((session: Session | null) =>
    patch(current => ({ ...current, activeWorkout: session })), [patch]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } finally { queue.clear(); setData(null); setSignedOut(true); }
  }, [queue]);

  return { data, status, loading, error, signedOut, online, reload, queue, setData: patch, savePreferences, setActiveWorkout, signOut };
}
