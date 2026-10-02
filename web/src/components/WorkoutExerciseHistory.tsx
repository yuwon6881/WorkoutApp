import { useEffect, useState } from 'react';
import type { RecentExerciseSession, SessionExercise, Unit } from '../types';
import { api } from '../lib/api';
import { showWeight } from '../lib/training';
import { effortValue } from '../lib/workoutDraft';
import { Button } from './ui/Button';
import { Skeleton } from './ui/Skeleton';
import './WorkoutExerciseHistory.css';
import { showTimedSet } from '../lib/setDuration';
import { useTrackRir } from '../lib/trackRir';

/** History stays in component memory and is fetched from the account-authorized API. */
export function WorkoutExerciseHistory({ exercise, unit }: { exercise: SessionExercise; unit: Unit }) {
  const [sessions, setSessions] = useState<RecentExerciseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const trackRir = useTrackRir();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    async function read() {
      if (!exercise.exerciseId) return [];
      return api.recentExerciseSets(exercise.exerciseId, controller.signal);
    }
    void read().then(rows => {
      if (alive) setSessions(rows);
    }).catch(() => {
      if (alive) setError('Past sets could not be loaded. Reconnect and try again.');
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; controller.abort(); };
  }, [exercise.exerciseId, attempt]);

  return <section className="workout-exercise-history" aria-label={`Past sets for ${exercise.name}`}>
    <div className="workout-history-heading">
      <h3>Past sets</h3>
      <span className="muted">Last 3 sessions</span>
    </div>
    {loading ? <Skeleton className="workout-history-loading" aria-label="Loading past sets" /> : error ? (
      <div role="status"><p>{error}</p><Button variant="tertiary" onClick={() => setAttempt(value => value + 1)}>Retry history</Button></div>
    ) : !sessions.length ? (
      <p className="muted">{exercise.exerciseId ? 'No completed sessions for this exercise yet.' : 'Past sets are available for exercises linked to the library.'}</p>
    ) : sessions.map(session => <details key={session.id} open={session.id === sessions[0]?.id}>
      <summary>
        <span>{new Date(session.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <span>{session.name}</span>
      </summary>
      <ul className="workout-history-sets">
        {session.exercises.filter(item => item.exerciseId === exercise.exerciseId).flatMap(item => item.sets.filter(set => set.done).map((set, index) => {
          const rir = set.rir ?? effortValue(set);
          return <li key={set.id}>
            <span>{set.warmup ? 'Warm-up' : `Set ${index + 1}`}</span>
            <strong>{set.durationSeconds != null ? showTimedSet(set, unit) : <>{set.weightKg === null ? 'Load —' : showWeight(set.weightKg, unit)} × {set.reps ?? '—'}</>}</strong>
            {trackRir && <span>{!set.warmup && rir !== null ? `${rir} RIR` : 'RIR —'}</span>}
          </li>;
        }))}
      </ul>
    </details>)}
  </section>;
}
