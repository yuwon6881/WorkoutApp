import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Dumbbell, FileText, Link2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise } from '../types';
import { rpeOptions, showReps } from '../lib/training';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Field, TextAreaField } from './ui/Field';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';
import { SwipeableRow } from './ui/SwipeableRow';

const weekdayOptions = [
  { value: '', label: 'Choose a weekday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' }
];

const supersetOptions = [
  { value: '', label: 'None (Standalone)' },
  { value: 'A', label: 'Superset A' },
  { value: 'B', label: 'Superset B' },
  { value: 'C', label: 'Superset C' },
  { value: 'D', label: 'Superset D' }
];

export function exerciseSummary(exercise: DraftExercise): string {
  const working = exercise.sets.filter(set => !set.warmup);
  const prescribed = working.length ? working : exercise.sets;
  if (!prescribed.length) return 'No prescription';

  const repLabels = [...new Set(prescribed.map(set => showReps(set)))];
  const rpeLabels = [...new Set(prescribed.map(set => set.targetRpe).filter((rpe): rpe is number => rpe != null))];
  const restLabels = [...new Set(prescribed.map(set => set.restText || (set.restSeconds == null ? '' : `${set.restSeconds}s`)).filter(Boolean))];
  const metrics = [`${working.length || exercise.sets.length} × ${repLabels.join(' / ')}`];
  if (rpeLabels.length) metrics.push(`RPE ${rpeLabels.join(' / ')}`);
  if (restLabels.length) metrics.push(restLabels.join(' / '));
  const warmups = exercise.sets.length - working.length;
  if (warmups > 0) metrics.push(`${warmups} warm-up`);
  return metrics.join(' · ');
}

export function DayEditor({ day, exercises, onChange, onPropagateSubstitution, restorableExerciseLineIds, onRestoreExercise }: {
  day: DraftWorkout;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
  onPropagateSubstitution?: (currentName: string, replacementName: string) => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(day);
  useEffect(() => setDraft(day), [day]);

  const save = (next: DraftWorkout) => {
    setDraft(next);
    void onChange(next);
  };

  const groups: DraftExercise[][] = [];
  for (const exercise of draft.exercises) {
    const prefix = exercise.sequenceGroup.trim().match(/^[A-Za-z]+/)?.[0] ?? '';
    const previous = groups.at(-1)?.[0]?.sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? '';
    if (prefix && prefix === previous) groups.at(-1)!.push(exercise);
    else groups.push([exercise]);
  }

  return <div className="day-editor">
    {/* A missing weekday is a review issue, so keep the correction beside the day it affects. */}
    <div className="day-editor-fields">
      <Field name={`day-name-${draft.lineId}`} className="day-name-field" label="Day name" value={draft.name} data-import-field="name"
        onChange={event => setDraft({ ...draft, name: event.target.value })}
        onBlur={() => void onChange(draft)} />
      <label className="field day-weekday-field" data-import-field="weekday"><span>Weekday</span>
        <Select name={`weekday-${draft.lineId}`} ariaLabel={`Weekday for ${draft.name}`} value={draft.weekday == null ? '' : String(draft.weekday)}
          options={weekdayOptions} onChange={value => save({ ...draft, weekday: value === '' ? null : Number(value) })} />
      </label>
    </div>
    {draft.isRestDay
      ? <div className="rest-callout"><span className="tiny-label">Rest day</span><p>No exercises are scheduled for this slot.</p></div>
      : groups.map((group, groupIndex) => <div className={group.length > 1 ? 'superset-block' : ''} key={groupIndex}>
        {group.length > 1 && <div className="superset-heading">Superset {group[0].sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? ''}</div>}
        {group.map(exercise => <ExerciseEditor key={exercise.lineId} exercise={exercise} exercises={exercises} allDayExercises={draft.exercises}
          onChange={next => save({ ...draft, exercises: draft.exercises.map(item => item.lineId === next.lineId ? next : item) })}
          onPropagateSubstitution={onPropagateSubstitution}
          canRestore={restorableExerciseLineIds?.includes(exercise.lineId)}
          onRestore={onRestoreExercise ? () => onRestoreExercise(exercise.lineId) : undefined} />)}
      </div>)}
    {!draft.isRestDay && <Button variant="tertiary" className="day-add-exercise-button" onClick={() => save({ ...draft, exercises: [...draft.exercises, blankExercise()] })}>
      <Plus size={16} />Add exercise
    </Button>}
  </div>;
}

function ExerciseEditor({ exercise, exercises, allDayExercises, onChange, onPropagateSubstitution, canRestore, onRestore }: {
  exercise: DraftExercise;
  exercises: Exercise[];
  allDayExercises: DraftExercise[];
  onChange: (exercise: DraftExercise) => void;
  onPropagateSubstitution?: (currentName: string, replacementName: string) => Promise<void>;
  canRestore?: boolean;
  onRestore?: () => Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newSub, setNewSub] = useState('');
  const editSet = (index: number, patch: Partial<DraftSet>) =>
    onChange({ ...exercise, sets: exercise.sets.map((set, current) => current === index ? { ...set, ...patch } : set) });
  const selected = exercises.find(option => option.id === exercise.exerciseId);
  const select = (exerciseId: string | null) => {
    onChange({ ...exercise, exerciseId });
    setPickerOpen(false);
  };

  const applySubstitution = (subName: string) => {
    const oldName = exercise.sourceName;
    const matched = exercises.find(e => e.name.toLowerCase() === subName.toLowerCase());
    const remainingSubs = [oldName, ...exercise.substitutions.filter(s => s.toLowerCase() !== subName.toLowerCase())].slice(0, 2);
    onChange({
      ...exercise,
      sourceName: subName,
      exerciseId: matched ? matched.id : exercise.exerciseId,
      substitutions: remainingSubs
    });
    void onPropagateSubstitution?.(oldName, subName);
  };

  const handleAddSub = () => {
    const clean = newSub.trim();
    if (!clean || exercise.substitutions.some(s => s.toLowerCase() === clean.toLowerCase())) {
      setNewSub('');
      return;
    }
    onChange({ ...exercise, substitutions: [...exercise.substitutions, clean].slice(0, 2) });
    setNewSub('');
  };

  const currentGroupLetter = exercise.sequenceGroup.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
  const handleSupersetChange = (letter: string) => {
    if (!letter) {
      onChange({ ...exercise, sequenceGroup: '' });
      return;
    }
    const thisIndex = allDayExercises.findIndex(ex => ex.lineId === exercise.lineId);
    const priorCount = allDayExercises.slice(0, thisIndex).filter(ex => ex.sequenceGroup.toUpperCase().startsWith(letter)).length;
    onChange({ ...exercise, sequenceGroup: `${letter}${priorCount + 1}` });
  };

  return <div className={`import-exercise ${exercise.sequenceGroup ? 'exercise-card-superset-active' : ''}`} data-import-exercise={exercise.lineId}>
    <div className="import-exercise-heading">
      <div className="import-exercise-title">
        <span className="import-exercise-icon" aria-hidden="true"><Dumbbell size={17} /></span>
        <input name={`exercise-source-name-${exercise.lineId}`} className="inline-input" aria-label="Exercise name as written in the PDF" value={exercise.sourceName}
          onChange={event => onChange({ ...exercise, sourceName: event.target.value })} />
      </div>
      <span className="import-exercise-tags">
        {exercise.sequenceGroup && <span className="superset-badge"><Link2 size={12} />Superset {exercise.sequenceGroup}</span>}
        {exercise.sourcePage && <span className="tiny-label">PDF p.{exercise.sourcePage}</span>}
        {!exercise.exerciseId && <span className="tiny-label warn"><AlertTriangle size={12} /> Unmapped · preserved</span>}
        {canRestore && onRestore && (
          <Button
            variant="tertiary"
            className="restore-exercise-btn"
            aria-label={`Restore default for ${exercise.sourceName}`}
            onClick={onRestore}
          >
            <RotateCcw size={12} />Restore default
          </Button>
        )}
      </span>
    </div>
    <div className="import-fields">
      <div className="field import-library-field">
        <span>Library exercise</span>
        <Button variant="secondary" className="import-library-trigger" aria-haspopup="dialog" data-import-field="library"
          aria-label={`Library exercise for ${exercise.sourceName}`} onClick={() => setPickerOpen(true)}>
          {selected?.name ?? (exercise.exerciseId ? 'Swap exercise' : 'Map exercise')}
        </Button>
      </div>
      <div className="field import-superset-field">
        <span>Superset group</span>
        <div className="superset-control-wrap">
          <Select
            name={`exercise-superset-${exercise.lineId}`}
            ariaLabel={`Superset group for ${exercise.sourceName}`}
            value={currentGroupLetter}
            options={supersetOptions}
            onChange={handleSupersetChange}
          />
        </div>
      </div>
      <div className="field import-substitutions-field">
        <span>Substitutions (tap to swap slot)</span>
        <div className="substitution-chips-wrap">
          {exercise.substitutions.length > 0 && (
            <div className="substitution-chips-row" role="group" aria-label={`Substitutions for ${exercise.sourceName}`}>
              {exercise.substitutions.map((sub, sIdx) => (
                <div
                  key={sIdx}
                  className="substitution-chip"
                  title={`Swap ${exercise.sourceName} with ${sub} across this block`}
                  onClick={() => applySubstitution(sub)}
                >
                  <ArrowLeftRight size={13} className="swap-icon" />
                  <span>{sub}</span>
                  <Button
                    presentation="plain"
                    className="chip-remove-btn"
                    aria-label={`Remove substitution ${sub}`}
                    onClick={e => {
                      e.stopPropagation();
                      onChange({
                        ...exercise,
                        substitutions: exercise.substitutions.filter((_, idx) => idx !== sIdx)
                      });
                    }}
                  >
                    <X size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {exercise.substitutions.length < 2 && (
            <div className="substitution-add-form">
              <input
                name={`new-sub-${exercise.lineId}`}
                className="substitution-add-input"
                placeholder="Add alternate exercise…"
                value={newSub}
                onChange={e => setNewSub(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSub();
                  }
                }}
              />
              <Button
                variant="secondary"
                className="substitution-add-btn"
                disabled={!newSub.trim()}
                onClick={handleAddSub}
                aria-label="Add substitution"
              >
                <Plus size={13} />Add
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
    {/* The coaching note is what the page said about the movement and is as worth correcting as
        anything else the read got from it, so it is edited here rather than only displayed. */}
    <TextAreaField name={`exercise-notes-${exercise.lineId}`} className="import-exercise-notes" label={<span className="import-note-label"><FileText size={15} />Notes from the PDF</span>}
      value={exercise.notes ?? ''} placeholder="Cues, tempo or coaching notes"
      onChange={event => onChange({ ...exercise, notes: event.target.value })} />

    <ol className="import-sets" aria-label={`Set prescriptions for ${exercise.sourceName}`} data-import-field="sets">
      {exercise.sets.map((set, index) => {
        const remove = <Button variant="destructive" className="import-set-remove" aria-label={`Remove set ${index + 1}`} onClick={() => onChange({ ...exercise, sets: exercise.sets.filter((_, current) => current !== index) })}>
          <Trash2 size={15} /><span>Delete</span>
        </Button>;
        return <li className={`import-set ${set.warmup ? 'warmup-row' : ''}`} key={index}>
          <SwipeableRow className="import-set-swipe-row" actions={remove} desktopActions={remove} actionsWidth={88} actionsLabel={`Actions for ${set.warmup ? 'warm-up' : 'set'} ${index + 1}`}>
            <div className="import-set-content" data-import-set-index={index}>
              <div className="import-set-heading">
                <span className="set-number">
                  <span className="set-number-label">{set.warmup ? 'Warm-up' : 'Set'}</span>
                  <strong>{index + 1}</strong>
                </span>
                <span className="set-prescription-label">Prescription</span>
              </div>
              <div className="import-set-fields">
                <Field name={`rep-min-${exercise.lineId}-${index}`} label="Min reps" inputMode="numeric" type="number" value={set.repMin} data-import-field="repMin" data-import-set-index={index} onChange={event => editSet(index, { repMin: Number(event.target.value), repsText: null, repsSource: 'userEdited' })} />
                <Field name={`rep-max-${exercise.lineId}-${index}`} label="Max reps" inputMode="numeric" type="number" value={set.repMax} data-import-field="repMax" data-import-set-index={index} onChange={event => editSet(index, { repMax: Number(event.target.value), repsText: null, repsSource: 'userEdited' })} />
                <label className="field" data-import-field="targetRpe" data-import-set-index={index}>Target RPE
                  <Select name={`target-rpe-${exercise.lineId}-${index}`} ariaLabel={`Target RPE for ${exercise.sourceName} set ${index + 1}`}
                    value={set.targetRpe ?? ''} options={[{ value: '', label: set.warmup ? 'Not set' : 'Choose RPE' }, ...rpeOptions]}
                    onChange={value => editSet(index, { targetRpe: value === '' ? null : Number(value), rpeSource: 'userEdited' })} />
                </label>
                <Field name={`rest-${exercise.lineId}-${index}`} label="Rest" value={set.restText ?? (set.restSeconds === null ? '' : `${set.restSeconds}s`)} data-import-field="rest" data-import-set-index={index} onChange={event => editSet(index, { restText: event.target.value, restSource: 'userEdited' })} />
              </div>
            </div>
          </SwipeableRow>
        </li>;
      })}
    </ol>
    <div className="import-set-footer">
      <span className="import-set-count">{exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'} in this prescription</span>
      <Button variant="secondary" className="import-add-set" disabled={exercise.sets.length >= 24} onClick={() => {
        const previous = exercise.sets.at(-1) ?? blankSet();
        onChange({ ...exercise, sets: [...exercise.sets, { ...previous, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }] });
      }}>
        <Plus size={15} />Add another set
      </Button>
    </div>

    {pickerOpen && <Modal title={`Choose a library exercise for ${exercise.sourceName}`} wide onClose={() => setPickerOpen(false)}>
      <div className="modal-body import-library-picker">
        <p>Search the catalog by exercise, equipment, muscle, movement pattern, or alias.</p>
        <ExerciseLibrary exercises={exercises} action={exercise.exerciseId ? 'swap' : 'map'} onSelect={id => select(id)} />
      </div>
      <div className="modal-actions">
        <Button variant="tertiary" onClick={() => select(null)}>Clear mapping</Button>
        <Button variant="primary" onClick={() => setPickerOpen(false)}>Done</Button>
      </div>
    </Modal>}
  </div>;
}

function blankExercise(): DraftExercise {
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, notes: null, sequenceGroup: '', substitutions: [], sets: [blankSet()] };
}

function blankSet(): DraftSet {
  return { repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, rir: null, warmup: false };
}
