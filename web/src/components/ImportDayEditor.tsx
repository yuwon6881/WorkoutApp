import { useEffect, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise } from '../types';
import { showReps } from '../lib/training';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';

export function exerciseSummary(exercise: DraftExercise): string {
  const working = exercise.sets.filter(set => !set.warmup);
  const shown = working[0] ?? exercise.sets[0];
  if (!shown) return 'No prescription';

  const metrics = [`${working.length || exercise.sets.length} × ${showReps(shown)}`];
  if (shown.targetRpe != null) metrics.push(`RPE ${shown.targetRpe}`);
  if (shown.percent1Rm) metrics.push(shown.percent1Rm);
  if (shown.restText) metrics.push(shown.restText);
  else if (shown.restSeconds != null) metrics.push(`${shown.restSeconds}s rest`);
  const warmups = exercise.sets.length - working.length;
  if (warmups > 0) metrics.push(`${warmups} warm-up`);
  return metrics.join(' · ');
}

export function DayEditor({ day, exercises, onChange }: {
  day: DraftWorkout;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
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
    {/* The weekday follows the order the document printed its week in, and is set on the
        program's own schedule screen when it is activated rather than asked for a day at a time. */}
    <div className="day-editor-fields">
      <Field label="Day name" value={draft.name}
        onChange={event => setDraft({ ...draft, name: event.target.value })}
        onBlur={() => void onChange(draft)} />
      <TextAreaField label="Notes" value={draft.notes ?? ''}
        onChange={event => setDraft({ ...draft, notes: event.target.value })}
        onBlur={() => void onChange(draft)} />
    </div>
    {draft.isRestDay
      ? <div className="rest-callout"><span className="tiny-label">Rest day</span><p>No exercises are scheduled for this slot.</p></div>
      : groups.map((group, groupIndex) => <div className={group.length > 1 ? 'superset-block' : ''} key={groupIndex}>
        {group.length > 1 && <div className="superset-heading">Superset {group[0].sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? ''}</div>}
        {group.map(exercise => <ExerciseEditor key={exercise.lineId} exercise={exercise} exercises={exercises}
          onChange={next => save({ ...draft, exercises: draft.exercises.map(item => item.lineId === next.lineId ? next : item) })} />)}
      </div>)}
    {!draft.isRestDay && <Button variant="tertiary" onClick={() => save({ ...draft, exercises: [...draft.exercises, blankExercise()] })}>
      <Plus size={16} />Add exercise
    </Button>}
  </div>;
}

function ExerciseEditor({ exercise, exercises, onChange }: {
  exercise: DraftExercise;
  exercises: Exercise[];
  onChange: (exercise: DraftExercise) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const editSet = (index: number, patch: Partial<DraftSet>) =>
    onChange({ ...exercise, sets: exercise.sets.map((set, current) => current === index ? { ...set, ...patch } : set) });
  const selected = exercises.find(option => option.id === exercise.exerciseId);
  const select = (exerciseId: string | null) => {
    onChange({ ...exercise, exerciseId });
    setPickerOpen(false);
  };

  return <div className="import-exercise">
    <div className="import-exercise-heading">
      <input className="inline-input" aria-label="Exercise name as written in the PDF" value={exercise.sourceName}
        onChange={event => onChange({ ...exercise, sourceName: event.target.value })} />
      <span className="import-exercise-tags">
        {exercise.sourcePage && <span className="tiny-label">PDF p.{exercise.sourcePage}</span>}
        {!exercise.exerciseId && <span className="tiny-label warn"><AlertTriangle size={12} /> Unmapped · preserved</span>}
      </span>
    </div>
    <div className="import-fields">
      <div className="field">
        <span>Library exercise</span>
        <Button variant="secondary" className="import-library-trigger" aria-haspopup="dialog"
          aria-label={`Library exercise for ${exercise.sourceName}`} onClick={() => setPickerOpen(true)}>
          {selected?.name ?? 'Not mapped'}
        </Button>
      </div>
      <label className="field">Superset group
        <input value={exercise.sequenceGroup} onChange={event => onChange({ ...exercise, sequenceGroup: event.target.value })} placeholder="A1" />
      </label>
      <label className="field">Substitutions
        <input value={exercise.substitutions.join(', ')} onChange={event => onChange({ ...exercise, substitutions: event.target.value.split(',').map(value => value.trim()).filter(Boolean).slice(0, 2) })} placeholder="Optional alternates" />
      </label>
    </div>
    {/* The coaching note is what the page said about the movement and is as worth correcting as
        anything else the read got from it, so it is edited here rather than only displayed. */}
    <TextAreaField label="Notes from the PDF" value={exercise.notes ?? ''} placeholder="Cues, tempo or coaching notes"
      onChange={event => onChange({ ...exercise, notes: event.target.value })} />

    <ol className="import-sets">
      {exercise.sets.map((set, index) => <li className={`import-set ${set.warmup ? 'warmup-row' : ''}`} key={index}>
        <span className="set-number">{set.warmup ? `Warm-up ${index + 1}` : `Set ${index + 1}`}</span>
        <div className="import-set-fields">
          <Field label="Reps" value={set.repsText ?? showReps(set)} onChange={event => editSet(index, { repsText: event.target.value, repsSource: 'userEdited' })} />
          <Field label="RPE" inputMode="decimal" type="number" value={set.targetRpe ?? ''} onChange={event => editSet(index, { targetRpe: event.target.value === '' ? null : Number(event.target.value), rpeSource: 'userEdited' })} />
          <Field label="%1RM" value={set.percent1Rm ?? ''} onChange={event => editSet(index, { percent1Rm: event.target.value })} />
          <Field label="Rest" value={set.restText ?? (set.restSeconds === null ? '' : `${set.restSeconds}s`)} onChange={event => editSet(index, { restText: event.target.value, restSource: 'userEdited' })} />
        </div>
        <Button variant="tertiary" aria-label={`Remove set ${index + 1}`} onClick={() => onChange({ ...exercise, sets: exercise.sets.filter((_, current) => current !== index) })}>
          <Trash2 size={15} />
        </Button>
      </li>)}
    </ol>
    <Button variant="tertiary" disabled={exercise.sets.length >= 24} onClick={() => {
      const previous = exercise.sets.at(-1) ?? blankSet();
      onChange({ ...exercise, sets: [...exercise.sets, { ...previous, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }] });
    }}>
      <Plus size={15} />Add set
    </Button>

    {pickerOpen && <Modal title={`Choose a library exercise for ${exercise.sourceName}`} wide onClose={() => setPickerOpen(false)}>
      <div className="modal-body import-library-picker">
        <p>Search the catalog by exercise, equipment, muscle, movement pattern, or alias.</p>
        <ExerciseLibrary exercises={exercises} onSelect={id => select(id)} />
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
  return { repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, percent1Rm: null, rir: null, warmup: false };
}
