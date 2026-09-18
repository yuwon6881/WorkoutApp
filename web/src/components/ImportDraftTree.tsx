import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise, ImportDraft } from '../types';
import { showReps } from '../lib/training';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { Select } from './ui/Select';

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type Phase = { block: string; phase: string; weeks: { week: number; days: DraftWorkout[] }[] };

/// A ninety-day program down one page is unreadable, so the draft is entered a week at a time:
/// each phase offers its weeks along the top, the chosen week lists its days with what each one
/// prescribes, and a day opens for editing only when a reviewer asks it to.
function groupPhases(draft: ImportDraft): Phase[] {
  const phases: Phase[] = [];
  for (const day of draft.workouts) {
    const block = day.block || 'Program';
    const phase = day.phase || 'General';
    let current = phases.at(-1);
    if (!current || current.block !== block || current.phase !== phase) {
      current = { block, phase, weeks: [] };
      phases.push(current);
    }
    let week = current.weeks.find(entry => entry.week === day.phaseWeek);
    if (!week) { week = { week: day.phaseWeek, days: [] }; current.weeks.push(week); }
    week.days.push(day);
  }
  for (const phase of phases) phase.weeks.sort((left, right) => left.week - right.week);
  return phases;
}

export function DraftOutline({ draft, expandedDay, setExpandedDay, exercises, onDayChange }: { draft: ImportDraft; expandedDay: string | null; setExpandedDay: (id: string | null) => void; exercises: Exercise[]; onDayChange: (day: DraftWorkout) => Promise<void> }) {
  const phases = useMemo(() => groupPhases(draft), [draft]);
  return <div className="import-tree">
    {phases.map(phase => <PhasePanel key={`${phase.block}-${phase.phase}`} phase={phase}
      expandedDay={expandedDay} setExpandedDay={setExpandedDay} exercises={exercises} onDayChange={onDayChange} />)}
  </div>;
}

function PhasePanel({ phase, expandedDay, setExpandedDay, exercises, onDayChange }: {
  phase: Phase; expandedDay: string | null; setExpandedDay: (id: string | null) => void;
  exercises: Exercise[]; onDayChange: (day: DraftWorkout) => Promise<void>;
}) {
  const [selected, setSelected] = useState(phase.weeks[0]?.week ?? 1);
  // A week that disappears under an edit must not leave the panel showing nothing.
  const week = phase.weeks.find(entry => entry.week === selected) ?? phase.weeks[0];
  return <section className="panel">
    <div className="section-heading"><h2>{phase.phase}</h2><span className="tiny-label">{phase.block}</span></div>
    {phase.weeks.length > 1 && <div className="week-tabs" role="tablist" aria-label={`Weeks in ${phase.phase}`}>
      {phase.weeks.map(entry => <Button key={entry.week} presentation="plain" role="tab"
        aria-selected={entry.week === week?.week}
        className={`week-tab ${entry.week === week?.week ? 'selected' : ''}`}
        onClick={() => setSelected(entry.week)}>Week {entry.week}</Button>)}
    </div>}
    {week && <div className="import-week-days" role="tabpanel" aria-label={`Week ${week.week} of ${phase.phase}`}>
      {week.days.map(day => <DayRow key={day.lineId} day={day} expanded={expandedDay === day.lineId}
        onToggle={() => setExpandedDay(expandedDay === day.lineId ? null : day.lineId)}
        exercises={exercises} onChange={onDayChange} />)}
    </div>}
  </section>;
}

/// What a day prescribes, in one line per exercise. A draft is read before it is edited, and a
/// list of day names alone says nothing about whether the PDF was transcribed correctly, so every
/// day shows its exercises without being opened; opening one is for changing it.
function DayLines({ day }: { day: DraftWorkout }) {
  return <ol className="draft-day-lines">
    {day.exercises.map(exercise => {
      const working = exercise.sets.filter(set => !set.warmup);
      const warmups = exercise.sets.length - working.length;
      const shown = working[0] ?? exercise.sets[0];
      const parts = shown ? [`${working.length || exercise.sets.length} × ${showReps(shown)}`] : [];
      if (shown?.targetRpe != null) parts.push(`RPE ${shown.targetRpe}`);
      if (shown?.restText) parts.push(shown.restText);
      else if (shown?.restSeconds != null) parts.push(`${shown.restSeconds}s rest`);
      if (warmups > 0) parts.push(`${warmups} warm-up`);
      return <li key={exercise.lineId}>
        {exercise.sequenceGroup && <span className="draft-line-group">{exercise.sequenceGroup}</span>}
        <span className="draft-line-name">{exercise.sourceName}</span>
        <span className="draft-line-detail">{parts.join(' · ')}</span>
      </li>;
    })}
  </ol>;
}

function DayRow({ day, expanded, onToggle, exercises, onChange }: { day: DraftWorkout; expanded: boolean; onToggle: () => void; exercises: Exercise[]; onChange: (day: DraftWorkout) => Promise<void> }) {
  return <section className={`draft-day ${day.isRestDay ? 'rest-day' : ''}`}>
    <Button presentation="plain" className="draft-day-summary" aria-expanded={expanded} onClick={onToggle}>
      <span><strong>{day.weekday ? `${weekdayNames[day.weekday - 1]} · ` : ''}{day.name}</strong><small>{day.isRestDay ? 'Rest day' : `${day.exercises.length} exercises`}{day.phase?.toLowerCase().includes('deload') ? ' · Deload' : ''}{day.sourcePage ? ` · PDF p.${day.sourcePage}` : ''}</small></span>
      <span className="tiny-label">{day.isRestDay ? 'Rest day' : expanded ? 'Close' : 'Edit'}</span>
    </Button>
    {!expanded && !day.isRestDay && day.exercises.length > 0 && <DayLines day={day} />}
    {expanded && <DayEditor day={day} exercises={exercises} onChange={onChange} />}
  </section>;
}

function DayEditor({ day, exercises, onChange }: { day: DraftWorkout; exercises: Exercise[]; onChange: (day: DraftWorkout) => Promise<void> }) {
  const [draft, setDraft] = useState(day);
  useEffect(() => setDraft(day), [day]);
  const save = (next: DraftWorkout) => { setDraft(next); void onChange(next); };
  const groups: DraftExercise[][] = [];
  for (const exercise of draft.exercises) {
    const prefix = exercise.sequenceGroup?.trim().match(/^[A-Za-z]+/)?.[0] ?? '';
    const previous = groups.at(-1)?.[0]?.sequenceGroup?.match(/^[A-Za-z]+/)?.[0] ?? '';
    if (prefix && prefix === previous) groups.at(-1)!.push(exercise); else groups.push([exercise]);
  }
  return <div className="day-editor">
    {/* The weekday follows the order the document printed its week in, and is set on the
        program's own schedule screen when it is activated rather than asked for a day at a time. */}
    <div className="day-editor-fields">
      <Field label="Day name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} onBlur={() => void onChange(draft)} />
      <TextAreaField label="Notes" value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} onBlur={() => void onChange(draft)} />
    </div>
    {draft.isRestDay ? <div className="rest-callout"><span className="tiny-label">Rest day</span><p>No exercises are scheduled for this slot.</p></div> : groups.map((group, groupIndex) => <div className={group.length > 1 ? 'superset-block' : ''} key={groupIndex}>
      {group.length > 1 && <div className="superset-heading">Superset {group[0].sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? ''}</div>}
      {group.map(exercise => <ExerciseEditor key={exercise.lineId} exercise={exercise} exercises={exercises} onChange={next => save({ ...draft, exercises: draft.exercises.map(item => item.lineId === next.lineId ? next : item) })} />)}
    </div>)}
    {!draft.isRestDay && <Button variant="tertiary" onClick={() => save({ ...draft, exercises: [...draft.exercises, blankExercise()] })}><Plus size={16} />Add exercise</Button>}
  </div>;
}

function ExerciseEditor({ exercise, exercises, onChange }: { exercise: DraftExercise; exercises: Exercise[]; onChange: (exercise: DraftExercise) => void }) {
  const editSet = (index: number, patch: Partial<DraftSet>) => onChange({ ...exercise, sets: exercise.sets.map((set, i) => i === index ? { ...set, ...patch } : set) });
  return <div className="import-exercise">
    <div className="import-exercise-heading">
      <input className="inline-input" aria-label="Exercise name as written in the PDF" value={exercise.sourceName} onChange={e => onChange({ ...exercise, sourceName: e.target.value })} />
      <span className="import-exercise-tags">
        {exercise.sourcePage && <span className="tiny-label">PDF p.{exercise.sourcePage}</span>}
        {!exercise.exerciseId && <span className="tiny-label warn"><AlertTriangle size={12} /> Unmapped · preserved</span>}
      </span>
    </div>
    <div className="import-fields"><label className="field">Library exercise
      <Select
        value={exercise.exerciseId ?? ''}
        onChange={value => onChange({ ...exercise, exerciseId: (value as string) || null })}
        ariaLabel={`Library exercise for ${exercise.sourceName}`}
        options={[
          { value: '', label: 'Not mapped' },
          ...exercises.map(option => ({ value: option.id, label: option.name }))
        ]}
      />
    </label><label className="field">Superset group<input value={exercise.sequenceGroup} onChange={e => onChange({ ...exercise, sequenceGroup: e.target.value })} placeholder="A1" /></label>
      <label className="field">Substitutions<input value={exercise.substitutions.join(', ')} onChange={e => onChange({ ...exercise, substitutions: e.target.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2) })} placeholder="Optional alternates" /></label></div>
    {/* The coaching note is what the page said about the movement and is as worth correcting as
        anything else the read got from it, so it is edited here rather than only displayed. */}
    <TextAreaField label="Notes from the PDF" value={exercise.notes ?? ''} placeholder="Cues, tempo or coaching notes"
      onChange={e => onChange({ ...exercise, notes: e.target.value })} />

    {/* Each set is its own block of labelled fields rather than a row in a table that has to be
        squeezed into a phone. The fields wrap; nothing is hidden at a narrow width. */}
    <ol className="import-sets">
      {exercise.sets.map((set, i) => <li className={`import-set ${set.warmup ? 'warmup-row' : ''}`} key={i}>
        <span className="set-number">{set.warmup ? `Warm-up ${i + 1}` : `Set ${i + 1}`}</span>
        <div className="import-set-fields">
          <Field label="Reps" value={set.repsText ?? showReps(set)} onChange={e => editSet(i, { repsText: e.target.value, repsSource: 'userEdited' })} />
          <Field label="RPE" inputMode="decimal" type="number" value={set.targetRpe ?? ''} onChange={e => editSet(i, { targetRpe: e.target.value === '' ? null : Number(e.target.value), rpeSource: 'userEdited' })} />
          <Field label="%1RM" value={set.percent1Rm ?? ''} onChange={e => editSet(i, { percent1Rm: e.target.value })} />
          <Field label="Rest" value={set.restText ?? (set.restSeconds === null ? '' : `${set.restSeconds}s`)} onChange={e => editSet(i, { restText: e.target.value, restSource: 'userEdited' })} />
        </div>
        <Button variant="tertiary" aria-label={`Remove set ${i + 1}`} onClick={() => onChange({ ...exercise, sets: exercise.sets.filter((_, j) => j !== i) })}><Trash2 size={15} /></Button>
      </li>)}
    </ol>
    <Button variant="tertiary" disabled={exercise.sets.length >= 24} onClick={() => onChange({ ...exercise, sets: [...exercise.sets, { ...exercise.sets.at(-1)!, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }] })}><Plus size={15} />Add set</Button>
  </div>;
}

function blankExercise(): DraftExercise {
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, notes: null, sequenceGroup: '', substitutions: [], sets: [blankSet()] };
}

function blankSet(): DraftSet {
  return { repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, percent1Rm: null, rir: null, warmup: false };
}
