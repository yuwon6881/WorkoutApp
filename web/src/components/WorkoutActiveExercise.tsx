import { useEffect, useState } from 'react';
import {
  FileText,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Target,
  Trash2,
  TrendingUp
} from 'lucide-react';
import type {
  Exercise,
  LoggedSet,
  Preferences,
  Session,
  SessionExercise,
  SubstitutionCandidate
} from '../types';
import { api } from '../lib/api';
import { showTarget, showWeight } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';
import { WorkoutSetRow } from './WorkoutSetRow';

export function WorkoutActiveExercise({
  exercise,
  index,
  unit,
  draft,
  exercises,
  change,
  editSet,
  toggle,
  onSwap,
  onRestore,
  onRemoveExercise
}: {
  exercise: SessionExercise;
  index: number;
  unit: Preferences['unit'];
  draft: Session;
  exercises: Exercise[];
  change: (s: Session) => void;
  editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void;
  toggle: (ei: number, si: number) => void;
  onSwap: (sessionExerciseId: string, replacementExerciseId: string | null, replacementName: string) => Promise<void>;
  onRestore?: (sessionExerciseId: string) => Promise<void>;
  onRemoveExercise: (index: number) => void;
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [candidates, setCandidates] = useState<SubstitutionCandidate[]>([]);
  const [showTargets, setShowTargets] = useState(false);
  const [showNote, setShowNote] = useState(Boolean(exercise.note));

  const prescription = exercise.prescription;

  useEffect(() => {
    if (!swapOpen) return;
    let alive = true;
    void api
      .substitutionCandidates({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        imported: exercise.substitutions
      })
      .then(rows => {
        if (alive) setCandidates(rows);
      })
      .catch(() => {
        if (alive) setCandidates([]);
      });
    return () => {
      alive = false;
    };
  }, [swapOpen, exercise.exerciseId, exercise.name, exercise.substitutions]);

  const workingSets = exercise.sets.filter(s => !s.warmup);
  const hasCompletedSets = exercise.sets.some(s => s.done);
  const nextUnloggedWorkingIndex = workingSets.findIndex(s => !s.done);
  const currentSetDisplay =
    nextUnloggedWorkingIndex >= 0
      ? `Set ${nextUnloggedWorkingIndex + 1} of ${workingSets.length || exercise.sets.length}`
      : workingSets.length > 0
        ? `All ${workingSets.length} sets completed`
        : `${exercise.sets.length} sets`;

  const progressionBadge = exercise.progression?.suggestedKg != null ? (
    <div className="workout-progression-badge" title={exercise.progression.reason}>
      <TrendingUp size={14} />
      <span className="badge-weight">{showWeight(exercise.progression.suggestedKg, unit)}</span>
      {exercise.progression.trendE1rmKg != null && (
        <span className="badge-sub">e1RM {showWeight(exercise.progression.trendE1rmKg, unit)}</span>
      )}
    </div>
  ) : null;

  return (
    <section className={`workout-active-exercise ${exercise.isReplacement ? 'swap-continuation' : ''}`}>
      <div className="workout-active-header">
        <div className="workout-active-title-group">
          <h2>
            {exercise.isReplacement && exercise.originalName
              ? `Continuation · ${exercise.name}`
              : exercise.name}
          </h2>
          <div className="workout-active-meta">
            <span className="workout-set-progress">{currentSetDisplay}</span>
            {exercise.isReplacement && (
              <span className="tiny-label">Swapped · {exercise.originalName}</span>
            )}
            {!exercise.exerciseId && <span className="tiny-label warn">Not in library</span>}
          </div>
        </div>

        {progressionBadge}
      </div>

      <div className="workout-action-pills" role="toolbar" aria-label="Exercise actions">
        <Button
          variant="tertiary"
          className={`action-pill ${showTargets ? 'active' : ''}`}
          aria-pressed={showTargets}
          onClick={() => setShowTargets(s => !s)}
        >
          <Target size={15} />
          <span>Targets</span>
        </Button>

        <Button
          variant="tertiary"
          className="action-pill"
          aria-label={`Swap ${exercise.name}`}
          disabled={hasCompletedSets}
          title={hasCompletedSets ? 'Swapping is not available after completing sets.' : undefined}
          onClick={() => setSwapOpen(true)}
        >
          <RefreshCw size={15} />
          <span>Swap</span>
        </Button>

        {exercise.canRestore && !hasCompletedSets && (
          <Button
            variant="tertiary"
            className="action-pill"
            aria-label={`Restore default for ${exercise.name}`}
            onClick={() => void onRestore?.(exercise.id)}
          >
            <RotateCcw size={15} />
            <span>Restore default</span>
          </Button>
        )}

        <Button
          variant="tertiary"
          className={`action-pill ${showNote ? 'active' : ''}`}
          aria-pressed={showNote}
          onClick={() => setShowNote(s => !s)}
        >
          <FileText size={15} />
          <span>Note</span>
        </Button>

        {exercise.sequenceGroup && (
          <div className="action-pill pill-static" title="Superset group">
            <Layers size={15} />
            <span>Superset {exercise.sequenceGroup}</span>
          </div>
        )}

        <Button
          variant="tertiary"
          className="action-pill remove-pill"
          aria-label={`Remove ${exercise.name} from workout`}
          onClick={() => onRemoveExercise(index)}
        >
          <Trash2 size={15} />
        </Button>
      </div>

      {showTargets && (
        <div className="workout-plan-detail-card">
          <div className="plan-detail-heading">
            <strong>Prescription & targets</strong>
            {exercise.progression && <span className="muted">{exercise.progression.reason}</span>}
          </div>
          <ul className="plan-detail-list">
            {prescription.map((p, pi) => (
              <li key={pi}>
                <span className="plan-set-number">{p.warmup ? `Warm-up ${pi + 1}` : `Set ${pi + 1}`}:</span>
                <span className="plan-set-target">{showTarget(p)}</span>
                {p.loadText && <span className="plan-set-load">· {p.loadText}</span>}
                {p.tempo && <span className="plan-set-tempo">· tempo {p.tempo}</span>}
                {p.notes && <span className="plan-set-notes">— {p.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showNote && (
        <div className="workout-note-drawer">
          <label className="field">
            Exercise notes
            <input
              name={`note-${exercise.id}`}
              placeholder="Form cues, machine pin setup, seat height…"
              value={exercise.note}
              onChange={e =>
                change({
                  ...draft,
                  exercises: draft.exercises.map((item, i) =>
                    i === index ? { ...item, note: e.target.value } : item
                  )
                })
              }
            />
          </label>
        </div>
      )}

      <div className="workout-set-table-container">
        <div className="workout-set-table-head">
          <span className="col-set">Set</span>
          <span className="col-target">Target ↔</span>
          <span className="col-load">{unit.toUpperCase()}</span>
          <span className="col-reps">Reps</span>
          <span className="col-rpe">RIR</span>
          <span className="col-log">Done</span>
          <span className="col-del" />
        </div>

        <div className="workout-set-rows">
          {exercise.sets.map((set, si) => {
            const plan = prescription[si] ?? prescription.at(-1);
            const warmupNumber = exercise.sets
              .slice(0, si + 1)
              .filter((item, i) => item.warmup || prescription[i]?.warmup).length;
            const workingNumber = exercise.sets
              .slice(0, si + 1)
              .filter((item, i) => !(item.warmup || prescription[i]?.warmup)).length;

            return (
              <WorkoutSetRow
                key={set.id}
                set={set}
                si={si}
                ei={index}
                exercise={exercise}
                plan={plan}
                unit={unit}
                warmupNumber={warmupNumber}
                workingNumber={workingNumber}
                editSet={editSet}
                toggle={toggle}
                onRemoveSet={sidx =>
                  change({
                    ...draft,
                    exercises: draft.exercises.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            sets: item.sets.filter((_, j) => j !== sidx),
                            prescription: item.prescription.filter((_, j) => j !== sidx)
                          }
                        : item
                    )
                  })
                }
              />
            );
          })}
        </div>

        <div className="workout-set-table-footer">
          <Button
            variant="secondary"
            className="add-set-btn"
            disabled={exercise.sets.length >= 24}
            onClick={() =>
              change({
                ...draft,
                exercises: draft.exercises.map((item, i) => {
                  if (i !== index) return item;
                  const prevSet = item.sets.at(-1);
                  const prevPlan = item.prescription.at(-1);
                  const mode = prevSet?.resistanceMode ?? prevPlan?.resistanceMode;
                  return {
                    ...item,
                    sets: [
                      ...item.sets,
                      {
                        id: crypto.randomUUID(),
                        position: item.sets.length,
                        weightKg: prevSet?.weightKg ?? null,
                        reps: prevSet?.reps ?? null,
                        rpe: null,
                        done: false,
                        warmup: false,
                        resistanceMode: mode
                      }
                    ],
                    prescription: [
                      ...item.prescription,
                      {
                        ...prevPlan,
                        repMin: prevPlan?.repMin ?? 8,
                        repMax: prevPlan?.repMax ?? 12,
                        targetRpe: prevPlan?.targetRpe ?? 8,
                        restSeconds: prevPlan?.restSeconds ?? 90,
                        tempo: null,
                        loadText: null,
                        notes: null,
                        repsText: null,
                        restText: null,
                        rir: null,
                        warmup: false,
                        repsSource: 'userEdited',
                        rpeSource: 'userEdited',
                        restSource: 'userEdited',
                        resistanceMode: mode
                      }
                    ]
                  };
                })
              })
            }
          >
            <Plus size={16} />
            Add set
          </Button>
        </div>
      </div>

      {swapOpen && (
        <Modal title={`Swap ${exercise.name}`} onClose={() => setSwapOpen(false)}>
          <div className="modal-body">
            <p className="source">
              Prescribed sets, reps, and targets stay with the slot. Swapping is only available before any sets are completed.
            </p>
            {!!exercise.substitutions.length && !candidates.length && (
              <div className="swap-menu" role="group" aria-label="Imported alternatives">
                <span className="tiny-label">Imported alternatives</span>
                {exercise.substitutions.map(name => (
                  <Button
                    key={name}
                    variant="tertiary"
                    onClick={() =>
                      void onSwap(
                        exercise.id,
                        exercises.find(item => item.name.toLowerCase() === name.toLowerCase())
                          ?.id ?? null,
                        name
                      ).then(() => setSwapOpen(false))
                    }
                  >
                    {name}
                  </Button>
                ))}
              </div>
            )}
            {!!candidates.length && (
              <div className="swap-menu" role="group" aria-label="Suggested substitutions">
                <span className="tiny-label">Suggested first</span>
                {candidates.slice(0, 12).map(candidate => (
                  <Button
                    key={`${candidate.source}-${candidate.name}`}
                    variant="tertiary"
                    onClick={() =>
                      void onSwap(exercise.id, candidate.exerciseId, candidate.name).then(() =>
                        setSwapOpen(false)
                      )
                    }
                  >
                    {candidate.name}
                    <small>
                      {candidate.source === 'imported'
                        ? 'Imported alternative'
                        : candidate.source === 'similar'
                          ? 'Similar movement'
                          : 'Library'}
                    </small>
                  </Button>
                ))}
              </div>
            )}
            <ExerciseLibrary
              exercises={exercises}
              action="swap"
              currentExerciseId={exercise.exerciseId}
              preferredNames={exercise.substitutions}
              onSelect={id => {
                const chosen = exercises.find(item => item.id === id);
                if (chosen)
                  void onSwap(exercise.id, chosen.id, chosen.name).then(() => setSwapOpen(false));
              }}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}
