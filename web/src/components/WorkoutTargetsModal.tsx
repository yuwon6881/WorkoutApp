import { Flame, Hash, History, Timer, TrendingUp, Weight } from 'lucide-react';
import type { Preferences, SessionExercise } from '../types';
import { showReps } from '../lib/training';
import { previousSetSummaries } from '../lib/previousSets';
import { setTarget } from '../lib/setTarget';
import { Modal } from './ui/Modal';
import { Skeleton } from './ui/Skeleton';
import { getRirColorClass } from './ui/RpeControl';
import { useRecentExerciseSets, type RecentSetsStatus } from './useRecentExerciseSets';

type TargetsProps = {
  exercise: SessionExercise;
  unit: Preferences['unit'];
  trackRir: boolean;
  onClose: () => void;
};

/// Last time's sets are read only when the targets are opened, so turning through the workout never
/// waits on history. Every set keeps a fixed-height Last time row in the same place, which shimmers
/// while the read is out and then shows the result, "No record", or that history is unavailable, so
/// nothing moves when the read arrives.
export function WorkoutTargetsModal(props: TargetsProps) {
  const recent = useRecentExerciseSets(props.exercise.exerciseId);
  const previousSets = previousSetSummaries(recent.sessions, props.exercise, props.trackRir, props.unit);
  return <WorkoutTargetsView {...props} previousSets={previousSets} previousStatus={recent.status} />;
}

function LastTimeRow({ value, status }: { value: string | null | undefined; status: RecentSetsStatus }) {
  return (
    <div className="plan-prev-row">
      <History size={14} aria-hidden="true" />
      <span className="plan-prev-label">Last time</span>
      {status === 'loading'
        ? <Skeleton className="plan-prev-skeleton" aria-hidden="true" />
        : value
          ? <span className="plan-prev-value">{value}</span>
          : <span className="plan-prev-empty">{status === 'failed' ? 'Unavailable' : 'No record'}</span>}
    </div>
  );
}

/// An exercise's planned sets in full: reps, effort, the progression's target load, tempo, what the
/// same set read last time, and each set's own note, under the progression reason when there is one.
export function WorkoutTargetsView({ exercise, unit, trackRir, previousSets, previousStatus = 'ready', onClose }: TargetsProps & {
  previousSets: Array<string | null | undefined>;
  previousStatus?: RecentSetsStatus;
}) {
  const previousLoading = previousStatus === 'loading';
  // Working sets are listed when there are any; each keeps its own index into the sets, so a
  // leading warm-up never shifts which set's suggestion or last result a row shows.
  const planned = exercise.prescription.map((p, setIndex) => ({ p, setIndex }));
  const shown = planned.some(({ p }) => !p.warmup) ? planned.filter(({ p }) => !p.warmup) : planned;
  return (
    <Modal title={`${exercise.name} targets`} onClose={onClose}>
      <div className="modal-body workout-plan-detail-card" aria-busy={previousLoading}>
        {previousLoading && <span className="sr-only" role="status">Loading last time's sets</span>}
        {exercise.progression && (
          <div className="plan-detail-banner">
            <TrendingUp size={16} className="plan-banner-icon" aria-hidden="true" />
            <div className="plan-banner-text">
              <strong className="plan-banner-title">Progression target</strong>
              <p>{exercise.progression.reason}</p>
            </div>
          </div>
        )}
        <ul className="plan-detail-list">
          {shown.map(({ p, setIndex }, pi) => {
            const rirVal = p.rir && Number.isFinite(Number(p.rir))
              ? Math.round(Number(p.rir))
              : p.targetRpe !== null
                ? Math.round(10 - p.targetRpe)
                : !p.warmup ? 2 : null;
            const rirLabel = rirVal !== null ? `${rirVal} RIR` : null;
            const repsRaw = showReps(p);
            const repsLabel = /^\d+([–-]\d+)?$/.test(repsRaw) ? `${repsRaw} reps` : repsRaw;
            const loggedSet = exercise.sets[setIndex];
            // The same load the set row shows, so the column and this list never disagree.
            const suggestedWeight = loggedSet ? setTarget(loggedSet, p, exercise, unit, trackRir).load : null;

            return (
              <li key={setIndex}>
                <div className="plan-set-header">
                  <span className="plan-set-badge">{p.warmup ? 'Warmup' : `Set ${pi + 1}`}</span>
                  <div className="plan-set-badges">
                    <span className="plan-pill plan-reps-pill">
                      <Hash size={12} aria-hidden="true" />
                      <span>{repsLabel}</span>
                    </span>
                    {trackRir && rirLabel && (
                      <span className={`plan-pill plan-rir-pill ${getRirColorClass(rirVal)}`}>
                        <Flame size={12} aria-hidden="true" />
                        <span>{rirLabel}</span>
                      </span>
                    )}
                    {suggestedWeight && (
                      <span className="plan-pill plan-load-pill">
                        <Weight size={12} aria-hidden="true" />
                        <span>{suggestedWeight}</span>
                      </span>
                    )}
                    {p.loadText && !suggestedWeight && (
                      <span className="plan-pill plan-load-pill">
                        <Weight size={12} aria-hidden="true" />
                        <span>{p.loadText}</span>
                      </span>
                    )}
                    {p.tempo && (
                      <span className="plan-pill plan-tempo-pill">
                        <Timer size={12} aria-hidden="true" />
                        <span>Tempo {p.tempo}</span>
                      </span>
                    )}
                  </div>
                </div>
                <LastTimeRow value={previousSets[setIndex]} status={previousStatus} />
                {p.notes && <p className="plan-set-note">{p.notes}</p>}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
