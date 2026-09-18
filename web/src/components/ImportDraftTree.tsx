import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise, ImportDraft } from '../types';
import { showReps } from '../lib/training';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { Select } from './ui/Select';

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const sourceLabel: Record<string, string> = { extracted: 'From the PDF', inferred: 'AI suggestion', userEdited: 'Your edit' };

function Source({ source }: { source: string }) {
  return <span className={`tiny-label provenance ${source}`} title={sourceLabel[source] ?? source}>{sourceLabel[source] ?? source}</span>;
}

/// The reviewable draft: every extracted day stays editable, and each value keeps the provenance
/// the import assigned it so a reviewer can tell a transcription from a suggestion.
export function DraftOutline({ draft, expandedDay, setExpandedDay, exercises, onDayChange }: { draft: ImportDraft; expandedDay: string | null; setExpandedDay: (id: string | null) => void; exercises: Exercise[]; onDayChange: (day: DraftWorkout) => Promise<void> }) {
  const blocks = new Map<string, Map<string, Map<number, DraftWorkout[]>>>();
  for (const day of draft.workouts) {
    const block = day.block || 'Program'; const phase = day.phase || 'General';
    if (!blocks.has(block)) blocks.set(block, new Map());
    const phases = blocks.get(block)!; if (!phases.has(phase)) phases.set(phase, new Map());
    const weeks = phases.get(phase)!; if (!weeks.has(day.phaseWeek)) weeks.set(day.phaseWeek, []); weeks.get(day.phaseWeek)!.push(day);
  }
  return <div className="import-tree">{[...blocks].map(([block, phases]) => <section className="panel" key={block}>
    <div className="section-heading"><h2>{block}</h2><span className="tiny-label">Block</span></div>
    {[...phases].map(([phase, weeks]) => <details className="phase-tree" key={phase} open><summary><ChevronDown size={15} />{phase}</summary>
      {[...weeks].map(([week, days]) => <div className="week-tree" key={week}><div className="tiny-label accent">Week {week}</div>
        {days.map(day => <DayRow key={day.lineId} day={day} expanded={expandedDay === day.lineId} onToggle={() => setExpandedDay(expandedDay === day.lineId ? null : day.lineId)} exercises={exercises} onChange={onDayChange} />)}
      </div>)}
    </details>)}
  </section>)}</div>;
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
      <span><strong>W{day.phaseWeek} · {day.name}</strong><small>{day.isRestDay ? 'Rest day' : `${day.exercises.length} exercises`}{day.phase?.toLowerCase().includes('deload') ? ' · Deload' : ''}{day.sourcePage ? ` · PDF p.${day.sourcePage}` : ''}</small></span>
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
    <Field label="Day name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} onBlur={() => void onChange(draft)} />
    <TextAreaField label="Notes" value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} onBlur={() => void onChange(draft)} />
    <label className="field">Weekday
      <Select
        value={draft.weekday != null ? String(draft.weekday) : ''}
        onChange={value => save({ ...draft, weekday: value ? Number(value) : null })}
        ariaLabel="Workout weekday"
        options={[
          { value: '', label: 'Unspecified — choose when scheduling' },
          ...weekdayNames.map((name, index) => ({ value: String(index + 1), label: name }))
        ]}
      />
    </label>
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
    <div className="section-heading"><div><input className="inline-input" aria-label={`Exercise name as written in the PDF`} value={exercise.sourceName} onChange={e => onChange({ ...exercise, sourceName: e.target.value })} />
      {exercise.sourcePage && <span className="tiny-label">PDF p.{exercise.sourcePage}</span>}
      {!exercise.exerciseId && <span className="tiny-label warn"><AlertTriangle size={12} /> Unmapped · preserved</span>}</div></div>
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
    {exercise.notes && <p className="note-block">{exercise.notes}</p>}
    <div className="set-table import-set-table"><div className="set-table-head"><span>Set</span><span>Reps</span><span>RPE/RIR</span><span>%1RM</span><span>Rest</span><span>Source</span><span /></div>
      {exercise.sets.map((set, i) => <div className={`set-row ${set.warmup ? 'warmup-row' : ''}`} key={i}><span className="set-number">{set.warmup ? `W${i + 1}` : i + 1}</span>
        <div className="set-fields">
          <label className="set-field"><span>Reps</span><input aria-label={`Set ${i + 1} reps text`} value={set.repsText ?? showReps(set)} onChange={e => editSet(i, { repsText: e.target.value, repsSource: 'userEdited' })} /></label>
          <label className="set-field"><span>RPE/RIR</span><input aria-label={`Set ${i + 1} target RPE`} inputMode="decimal" type="number" value={set.targetRpe ?? ''} onChange={e => editSet(i, { targetRpe: e.target.value === '' ? null : Number(e.target.value), rpeSource: 'userEdited' })} /></label>
          <label className="set-field"><span>%1RM</span><input aria-label={`Set ${i + 1} percent 1RM`} value={set.percent1Rm ?? ''} onChange={e => editSet(i, { percent1Rm: e.target.value })} /></label>
          <label className="set-field"><span>Rest</span><input aria-label={`Set ${i + 1} rest text`} value={set.restText ?? (set.restSeconds === null ? '' : `${set.restSeconds}s`)} onChange={e => editSet(i, { restText: e.target.value, restSource: 'userEdited' })} /></label>
        </div>
        <span className="source-cell"><Source source={set.repsSource} />{set.rpeSource !== set.repsSource && <Source source={set.rpeSource} />}</span>
        <div className="set-actions"><Button variant="tertiary" aria-label={`Remove set ${i + 1}`} onClick={() => onChange({ ...exercise, sets: exercise.sets.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button></div>
      </div>)}
    </div>
    <Button variant="tertiary" disabled={exercise.sets.length >= 24} onClick={() => onChange({ ...exercise, sets: [...exercise.sets, { ...exercise.sets.at(-1)!, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }] })}><Plus size={15} />Add set</Button>
  </div>;
}

function blankExercise(): DraftExercise {
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, notes: null, sequenceGroup: '', substitutions: [], sets: [blankSet()] };
}

function blankSet(): DraftSet {
  return { repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, percent1Rm: null, rir: null, warmup: false };
}
