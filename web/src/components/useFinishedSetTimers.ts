import { useEffect, useRef, useState } from 'react';
import type { LoggedSet, Session } from '../types';
import { acknowledgeFinishedSetTimers, withFinishedSetTimers } from '../lib/finishedSetTimers';
import { runningStopwatches, subscribeStopwatches } from '../lib/setStopwatch';

/** The workout remains mounted when the timed row is off screen. One writer owns completion. */
export function useFinishedSetTimers(draft: Session,
  change: (next: Session, changedSet: { setId: string; patch: Partial<LoggedSet> }) => Promise<boolean>, enabled: boolean) {
  const [version, setVersion] = useState(0);
  const writing = useRef(false);
  const latestChange = useRef(change);
  latestChange.current = change;
  useEffect(() => subscribeStopwatches(() => setVersion(value => value + 1)), []);
  useEffect(() => {
    if (!enabled || writing.current) return;
    const timers = runningStopwatches();
    const next = withFinishedSetTimers(draft, timers);
    if (next === draft) {
      acknowledgeFinishedSetTimers(draft, timers);
      return;
    }
    const set = next.exercises.flatMap(exercise => exercise.sets).find(set => !set.done && timers[set.id]?.finishedSeconds !== undefined)!;
    writing.current = true;
    void latestChange.current(next, { setId: set.id, patch: { durationSeconds: set.durationSeconds } }).then(saved => {
      if (saved) {
        acknowledgeFinishedSetTimers(next, timers);
        setVersion(value => value + 1);
      }
    }).finally(() => { writing.current = false; });
  }, [draft, version, enabled]);
}
