import { Flame, Sparkles, Target, Timer, Weight } from 'lucide-react';
import type { Preferences, SessionExercise } from '../types';
import { showReps, showWeight } from '../lib/training';
import { Modal } from './ui/Modal';
import { getRirColorClass } from './ui/RpeControl';

/// An exercise's planned sets in full: reps, effort, suggested or printed load, tempo, what the same
/// set read last time, and each set's own note, under the progression reason when there is one.
export function WorkoutTargetsModal({ exercise, unit, trackRir, previousSets, onClose }: {
  exercise: SessionExercise;
  unit: Preferences['unit'];
  trackRir: boolean;
  previousSets: Array<string | null | undefined>;
  onClose: () => void;
}) {
  // Working sets are listed when there are any; each keeps its own index into the sets, so a
  // leading warm-up never shifts which set's suggestion or last result a row shows.
  const planned = exercise.prescription.map((p, setIndex) => ({ p, setIndex }));
  const shown = planned.some(({ p }) => !p.warmup) ? planned.filter(({ p }) => !p.warmup) : planned;
  return (
    <Modal title={`${exercise.name} targets`} onClose={onClose}>
      <div className="modal-body workout-plan-detail-card">
        {exercise.progression && (
          <div className="plan-detail-banner">
            <Sparkles size={16} className="plan-banner-icon" aria-hidden="true" />
            <div className="plan-banner-text">
              <strong className="plan-banner-title">Progression Target</strong>
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
            const repsLabel = /^\d+(–\d+)?$/.test(repsRaw) ? `${repsRaw} reps` : repsRaw;
            const setSuggestion = exercise.sets[setIndex]?.suggestion;
            const suggestedWeight = setSuggestion?.suggestedLoadKg
              ? showWeight(setSuggestion.suggestedLoadKg, unit)
              : null;

            return (
              <li key={setIndex}>
                <div className="plan-set-header">
                  <span className="plan-set-badge">{p.warmup ? 'Warmup' : `Set ${pi + 1}`}</span>
                  <div className="plan-set-badges">
                    <span className="plan-pill plan-reps-pill">
                      <Target size={12} aria-hidden="true" />
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
                    {previousSets[setIndex] && (
                      <span className="plan-pill plan-prev-pill">
                        Last: {previousSets[setIndex]}
                      </span>
                    )}
                  </div>
                </div>
                {p.notes && <p className="plan-set-note">{p.notes}</p>}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
