import { useEffect, useState } from 'react';
import type { Session } from '../types';
import { ApiError } from '../lib/api';
import { isSessionSummary, loadSessionDetail } from '../lib/sessionDetailLoad';

/// The summary opens on the tap from whatever the list already has, then fills in the exercises
/// and sets once the full session arrives.
export function useSessionDetail(initial: Session) {
  const [session, setSession] = useState(initial);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const loading = isSessionSummary(session) && !error;

  useEffect(() => { setSession(initial); setError(''); }, [initial]);

  useEffect(() => {
    if (!isSessionSummary(session)) return;
    let current = true;
    loadSessionDetail(session.id)
      .then(full => { if (current) setSession(full); })
      .catch(failure => {
        if (current) setError(failure instanceof ApiError ? failure.message : 'Could not load this workout’s exercises.');
      });
    return () => { current = false; };
  }, [session.id, attempt]);

  return { session, loading, error, retry: () => { setError(''); setAttempt(value => value + 1); } };
}
