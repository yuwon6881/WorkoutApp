import { useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronUp, Dumbbell, FileText, Pencil, Play, Plus, RefreshCw } from 'lucide-react';
import type { Bootstrap, Exercise, ProgramSummary, Template, TemplateExercise } from '../types';
import { ApiError, api } from '../lib/api';
import { getWorkoutMuscles } from '../lib/muscles';
import { showReps } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { ExerciseLibrary } from './Exercises';
import { WorkoutEditorModal, type WorkoutDraft } from './WorkoutEditorModal';

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function nextMondayIso() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? 1 : 8 - day));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function defaultWeekdays(days: ProgramSummary['days']) {
  return Object.fromEntries(days.filter(day => !day.isRestDay && day.weekday != null).map(day => [day.id, day.weekday!]));
}

export function Programs({ data, exercises, onStart, onImport, onChanged }: {
  data: Bootstrap; exercises: Exercise[]; onStart: (templateId: string) => void; onImport: () => void; onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (template?: Template) => {
    setDraft(template
      ? { id: template.id, name: template.name, focus: template.focus, revision: template.revision, exercises: structuredClone(template.exercises) }
      : { id: null, name: '', focus: 'Custom workout', revision: null, exercises: [] });
  };

  async function save(savedDraft: WorkoutDraft) {
    setBusy(true);
    const input = {
      name: savedDraft.name.trim(), focus: savedDraft.focus.trim(), note: null, revision: savedDraft.revision, idempotencyId: crypto.randomUUID(),
      exercises: savedDraft.exercises.map(e => ({ exerciseId: e.exerciseId, sourceName: e.sourceName || e.name, note: e.note || null, sets: e.sets,
        sequenceGroup: e.sequenceGroup || null, substitutions: e.substitutions ?? [], sourcePage: e.sourcePage ?? null, slotKey: e.slotKey ?? null }))
    };
    try {
      if (savedDraft.id) await api.updateTemplate(savedDraft.id, input); else await api.createTemplate(input);
      await onChanged();
      setDraft(null);
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try { await api.deleteTemplate(id); await onChanged(); setDraft(null); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-heading">
      <h1>Workouts</h1>
      <div className="heading-actions">
        <Button onClick={onImport}><FileText size={18} />Import a PDF program</Button>
        <Button variant="primary" onClick={() => open()}><Plus size={18} />New workout</Button>
      </div>
    </div>

    {(['active', 'standby', 'completed'] as const).map(status => {
      const programs = data.programs.filter(program => (program.lifecycleStatus ?? (program.active ? 'active' : 'standby')) === status);
      if (!programs.length) return null;
      const title = status === 'active' ? 'Active program' : status === 'standby' ? 'Standby programs' : 'Completed programs';
      return <section key={status} className="program-section"><div className="section-heading"><h2>{title}</h2><span className="muted">{programs.length}</span></div>
        {programs.map(program => <ProgramCard key={program.id} program={program} exercises={exercises} onStart={onStart} onChanged={onChanged} />)}</section>;
    })}

    <section className="panel">
      <div className="section-heading"><h2>Standalone workouts</h2><span className="muted">{data.templates.length} saved</span></div>
      {data.templates.length ? <div className="program-grid">{data.templates.map((template, i) => (
        <StandaloneWorkoutCard key={template.id} template={template} index={i} exercises={exercises} onEdit={() => open(template)} onStart={() => onStart(template.id)} />
      ))}</div>
        : <div className="empty-message"><Dumbbell size={30} /><h3>No standalone workouts yet</h3>
          <p>{exercises.length ? 'Build one by hand, or import a program from a PDF.' : 'The exercise library is still empty, so a workout cannot be built yet. Importing a PDF will still create a reviewable draft.'}</p>
          <Button variant="primary" onClick={() => open()}><Plus size={17} />New workout</Button></div>}
    </section>

    {draft && <WorkoutEditorModal initialDraft={draft} exercises={exercises} busy={busy} onSave={save} onDelete={remove} onClose={() => setDraft(null)} />}
  </>;
}

function StandaloneWorkoutCard({ template, index, exercises, onEdit, onStart }: {
  template: Template; index: number; exercises: Exercise[]; onEdit: () => void; onStart: () => void;
}) {
  const muscles = useMemo(() => getWorkoutMuscles(template.exercises, exercises), [template.exercises, exercises]);
  const preview = useMemo(() => {
    if (!template.exercises.length) return '';
    const names = template.exercises.map(e => e.name);
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')}, and ${names.length - 3} more`;
  }, [template.exercises]);

  return <section className="panel routine-card">
    <div className="section-heading">
      <span className="routine-number">Workout {String(index + 1).padStart(2, '0')}</span>
      <Button variant="tertiary" aria-label={`Edit ${template.name}`} onClick={onEdit}><Pencil size={17} /></Button>
    </div>
    <h2>{template.name}</h2>
    <p>{template.focus}</p>
    {preview && <p className="day-exercise-preview">{preview}</p>}
    {muscles.length > 0 && <div className="day-muscles-row" aria-label="Targeted muscles">
      {muscles.slice(0, 5).map(m => <span key={m} className="muscle-chip">{m}</span>)}
      {muscles.length > 5 && <span className="muscle-chip muscle-chip-overflow" title={muscles.slice(5).join(', ')}>+{muscles.length - 5}</span>}
    </div>}
    <div className="routine-exercises">{template.exercises.slice(0, 4).map(e => <div key={e.id}>
      <span><Dumbbell size={16} />{e.name}</span><small>{e.sets.length} × {showReps(e.sets[0])}</small>
    </div>)}</div>
    <Button className="full-width" onClick={onStart}>Start workout<ArrowRight size={17} /></Button>
  </section>;
}

function ProgramCard({ program, exercises, onStart, onChanged }: { program: ProgramSummary; exercises: Exercise[]; onStart: (id: string) => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Template[] | null>(null);
  const [scheduling, setScheduling] = useState(program.needsSchedule ?? false);
  const [scheduleAnchor, setScheduleAnchor] = useState(program.scheduleAnchor ?? nextMondayIso());
  const [scheduleWeekdays, setScheduleWeekdays] = useState<Record<string, number | undefined>>(() => defaultWeekdays(program.days));
  const [swapTarget, setSwapTarget] = useState<{ template: Template; exercise: TemplateExercise } | null>(null);
  const [swapScope, setSwapScope] = useState<'slot' | 'phase'>('slot');
  const [swapChoice, setSwapChoice] = useState<Exercise | null>(null);
  const [confirmPhaseSwap, setConfirmPhaseSwap] = useState(false);
  const next = program.days.find(w => w.id === program.nextTemplateId);
  const skipped = new Set(program.skippedTemplateIds ?? []);

  async function toggleDetails() {
    if (!expanded && detail === null) {
      setBusy(true); setError('');
      try { setDetail((await api.getProgram(program.id)).workouts); }
      catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load this program.'); }
      finally { setBusy(false); }
    }
    setExpanded(value => !value);
  }

  async function act(run: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await run(); await onChanged(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not update this program.'); }
    finally { setBusy(false); }
  }

  function openSchedule() {
    setScheduleAnchor(program.scheduleAnchor ?? nextMondayIso());
    setScheduleWeekdays(defaultWeekdays(program.days));
    setScheduling(true);
  }

  async function saveSchedule() {
    const slots = program.days.filter(day => !day.isRestDay).map(day => ({ templateId: day.id, weekday: scheduleWeekdays[day.id] ?? 0 }));
    await act(async () => {
      await api.scheduleProgram(program.id, { anchor: scheduleAnchor, slots, revision: program.revision });
      setScheduling(false);
    });
  }

  async function toggleSkip(templateId: string) {
    await act(() => skipped.has(templateId) ? api.unskipProgramWorkout(program.id, templateId) : api.skipProgramWorkout(program.id, templateId));
  }

  return <section className="panel program-card">
    <div className="section-heading">
      <div><h2>{program.name}</h2><p className="muted">{program.weeks} {program.weeks === 1 ? 'week' : 'weeks'} · {program.days.length} days · {program.completedTemplateIds.length} completed{program.skippedTemplateIds?.length ? ` · ${program.skippedTemplateIds.length} skipped` : ''}</p></div>
      <span className={`tiny-label ${program.lifecycleStatus === 'completed' ? '' : 'accent'}`}>{program.lifecycleStatus === 'completed' ? 'Completed' : program.active ? 'Active' : 'Standby'}</span>
    </div>
    {program.lifecycleStatus === 'completed' && program.completedAt && <p className="muted small-copy">Completed {new Date(program.completedAt).toLocaleString()}</p>}
    {!!program.phases?.length && <div className="phase-progress" aria-label="Program phase progress">
      {program.phases.map(phase => <span className="tiny-label" key={phase.id}>{phase.name} · W{phase.currentWeek ?? 1}/{phase.durationWeeks} · {phase.completedWorkouts} completed{phase.skippedWorkouts ? ` · ${phase.skippedWorkouts} skipped` : ''}/{phase.totalWorkouts}{phase.complete ? ' · Done' : ''}{phase.sourcePageFrom ? ` · PDF pp.${phase.sourcePageFrom}${phase.sourcePageTo && phase.sourcePageTo !== phase.sourcePageFrom ? `–${phase.sourcePageTo}` : ''}` : ''}</span>)}
    </div>}
      <Button variant="tertiary" className="full-width" onClick={() => void toggleDetails()} disabled={busy}>{busy ? 'Loading…' : expanded ? 'Hide details' : 'Show details'}</Button>
    {expanded && <ProgramTree days={program.days} completed={program.completedTemplateIds} skipped={program.skippedTemplateIds ?? []} nextId={program.nextTemplateId} detail={detail} exercises={exercises} onStart={onStart} onSkip={toggleSkip} canStart={program.active} onSwap={template => exercise => { setSwapTarget({ template, exercise }); setSwapScope('slot'); setSwapChoice(null); setConfirmPhaseSwap(false); }} />}
    {error && <p className="error-text" role="alert">{error}</p>}
    {program.needsSchedule && !scheduling && <div className="empty-message">
      <strong>Choose when this program happens</strong>
      <p>Set a Monday start and a weekday for each workout before activating the program.</p>
      <Button onClick={openSchedule}>Schedule workouts</Button>
    </div>}
    {!program.needsSchedule && !scheduling && <div className="settings-actions">
      <Button variant="tertiary" onClick={openSchedule}>Edit schedule</Button>
    </div>}
    {scheduling && <div className="schedule-editor" aria-label={`Schedule ${program.name}`}>
      <label className="field">Program week 1 starts on Monday<input type="date" value={scheduleAnchor} onChange={event => setScheduleAnchor(event.target.value)} /></label>
      <div className="schedule-rows">
        {program.days.filter(day => !day.isRestDay).map(day => <label className="field" key={day.id}>{day.name} · week {day.week}
          <Select
            value={scheduleWeekdays[day.id] != null ? String(scheduleWeekdays[day.id]) : ''}
            onChange={value => setScheduleWeekdays(current => ({ ...current, [day.id]: value ? Number(value) : undefined }))}
            ariaLabel={`Weekday for ${day.name}`}
            options={[
              { value: '', label: 'Choose a weekday' },
              ...weekdayNames.map((name, index) => ({ value: String(index + 1), label: name }))
            ]}
          />
        </label>)}
      </div>
      <div className="settings-actions"><Button variant="primary" disabled={busy || !scheduleAnchor || program.days.some(day => !day.isRestDay && scheduleWeekdays[day.id] == null)} onClick={() => void saveSchedule()}>Save schedule</Button><Button disabled={busy} onClick={() => setScheduling(false)}>Cancel</Button></div>
    </div>}
    <div className="settings-actions">
      {program.active && next && <Button variant="primary" onClick={() => onStart(next.id)}>Start {next.name}<ArrowRight size={16} /></Button>}
      {program.lifecycleStatus !== 'completed' && <Button disabled={busy} onClick={() => act(() => api.setProgramActive(program.id, !program.active, program.revision))}>{program.active ? 'Move to standby' : 'Make active'}</Button>}
      {program.lifecycleStatus === 'completed' && <Button disabled={busy} onClick={() => act(() => api.repeatProgram(program.id))}>Repeat program</Button>}
      <Button variant="destructive" disabled={busy} onClick={() => act(() => api.deleteProgram(program.id))}>Delete program</Button>
    </div>
    {swapTarget && <Modal title={`Swap ${swapTarget.exercise.name}`} onClose={() => setSwapTarget(null)}>
      <div className="modal-body"><p className="source">Reps, sets, RPE, rest, tempo, warm-ups, notes, and source provenance stay with the slot. Loads are recalculated when the workout starts.</p>
        {program.phases?.some(phase => phase.id === swapTarget.template.phaseId || (phase.name === swapTarget.template.phase && phase.block === swapTarget.template.block)) && <label className="field">Apply to<Select value={swapScope} onChange={val => { setSwapScope(val as 'slot' | 'phase'); setConfirmPhaseSwap(false); }} ariaLabel="Apply swap scope" options={[{ value: 'slot', label: 'This workout only' }, { value: 'phase', label: 'Remaining workouts in this phase' }]} /></label>}
        {swapScope === 'phase' && <><div className="preview-card"><strong>Preview</strong><p>{detail?.filter(item => (item.phaseId === swapTarget.template.phaseId || (item.phase === swapTarget.template.phase && item.block === swapTarget.template.block)) && !program.completedTemplateIds.includes(item.id) && !(program.skippedTemplateIds ?? []).includes(item.id)).map(item => item.name).join(', ') || 'No remaining workouts in this phase.'}</p></div><label className="checkbox-row"><input type="checkbox" checked={confirmPhaseSwap} onChange={event => setConfirmPhaseSwap(event.target.checked)} />Apply this replacement to the previewed remaining workouts only.</label></>}
        <ExerciseLibrary action="swap" exercises={exercises} exclude={[]} onSelect={id => setSwapChoice(exercises.find(item => item.id === id) ?? null)} />
        {swapChoice && <p className="source">Selected replacement: <strong>{swapChoice.name}</strong></p>}
      </div>
      <div className="modal-actions"><Button onClick={() => setSwapTarget(null)}>Cancel</Button><Button variant="primary" disabled={!swapChoice || busy || swapScope === 'phase' && !confirmPhaseSwap} onClick={() => void (async () => { if (!swapChoice) return; await act(async () => { await api.substituteTemplateExercise(swapTarget.template.id, { templateExerciseId: swapTarget.exercise.id, slotKey: swapTarget.exercise.slotKey ?? undefined, replacementExerciseId: swapChoice.id, replacementName: swapChoice.name, scope: swapScope, revision: swapTarget.template.revision, idempotencyId: crypto.randomUUID() }); setDetail((await api.getProgram(program.id)).workouts); setSwapTarget(null); }); })()}>Apply swap</Button></div>
    </Modal>}
  </section>;
}

function ProgramTree({ days, completed, skipped, nextId, detail, exercises, onStart, onSkip, canStart, onSwap }: { days: ProgramSummary['days']; completed: string[]; skipped: string[]; nextId: string | null; detail: Template[] | null; exercises: Exercise[]; onStart: (id: string) => void; onSkip: (id: string) => Promise<void>; canStart: boolean; onSwap: (template: Template) => (exercise: TemplateExercise) => void }) {
  const blocks = new Map<string, Map<string, typeof days>>();
  for (const day of days) {
    const block = day.block || 'Program';
    const phase = day.phase || 'General';
    if (!blocks.has(block)) blocks.set(block, new Map());
    const phases = blocks.get(block)!;
    if (!phases.has(phase)) phases.set(phase, []);
    phases.get(phase)!.push(day);
  }
  return <div className="program-tree">{[...blocks].map(([block, phases]) => <details key={block} open>
    <summary>{block}</summary>
    {[...phases].map(([phase, phaseDays]) => <details key={phase} className="phase-tree" open>
      <summary>{phase}</summary>
      <div className="routine-list">{phaseDays.map(day => {
        const full = detail?.find(template => template.id === day.id);
        const complete = completed.includes(day.id);
        const isSkipped = skipped.includes(day.id);
        return <ProgramSlotRow key={day.id} day={day} full={full} complete={complete} isSkipped={isSkipped} isNext={day.id === nextId} canStart={canStart} exercises={exercises} onStart={onStart} onSkip={onSkip} onSwap={full ? onSwap(full) : () => {}} />;
      })}</div>
    </details>)}
  </details>)}</div>;
}

function ProgramSlotRow({ day, full, complete, isSkipped, isNext, canStart, exercises, onStart, onSkip, onSwap }: {
  day: ProgramSummary['days'][number];
  full: Template | undefined;
  complete: boolean;
  isSkipped: boolean;
  isNext: boolean;
  canStart: boolean;
  exercises: Exercise[];
  onStart: (id: string) => void;
  onSkip: (id: string) => Promise<void>;
  onSwap: (exercise: TemplateExercise) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const muscles = useMemo(() => full?.exercises ? getWorkoutMuscles(full.exercises, exercises) : [], [full, exercises]);
  const preview = useMemo(() => {
    if (!full?.exercises?.length) return '';
    const names = full.exercises.map(e => e.name);
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 4).join(', ')}, and ${names.length - 4} more`;
  }, [full]);

  const actionable = canStart && !complete && !isSkipped;
  const statusLabel = day.isRestDay ? 'Rest day' : complete ? 'Done' : isSkipped ? 'Skipped' : isNext ? 'Up next' : `${full?.exercises.length ?? day.exerciseCount} exercises`;

  const row = <>
    <span className="routine-number">W{day.phaseWeek}</span>
    <span>{day.name}{day.sourcePage ? <small className="muted"> · PDF p.{day.sourcePage}</small> : null}</span>
    <span className="tiny-label">{statusLabel}</span>
  </>;

  if (day.isRestDay) return <div className="routine-row rest-row" key={day.id}>{row}</div>;

  return <div className={`program-slot-card ${complete ? 'completed-slot' : ''} ${isNext ? 'next-slot' : ''}`} key={day.id}>
    <div className="program-slot-header">
      {actionable
        ? <Button variant="tertiary" className={`routine-row ${isNext ? 'next' : ''}`} onClick={() => onStart(day.id)}>{row}</Button>
        : <div className="routine-row routine-row-static">{row}</div>}
      <div className="program-slot-controls">
        {complete && <span className="slot-complete-badge" title="Workout completed"><Check size={16} /></span>}
        {actionable && <Button variant="primary" className="slot-start-btn" aria-label={`Start ${day.name}`} onClick={() => onStart(day.id)}><Play size={14} fill="currentColor" /><span>Start</span></Button>}
        <Button variant="tertiary" disabled={(!canStart && !isSkipped) || (complete && !isSkipped)} aria-label={`${isSkipped ? 'Unskip' : 'Skip'} ${day.name}`} onClick={() => void onSkip(day.id)}>{isSkipped ? 'Unskip' : 'Skip'}</Button>
        {full && full.exercises.length > 0 && <Button variant="tertiary" aria-label={expanded ? `Hide exercises for ${day.name}` : `Swap exercises in ${day.name}`} onClick={() => setExpanded(e => !e)}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</Button>}
      </div>
    </div>
    {preview && <p className="day-exercise-preview">{preview}</p>}
    {muscles.length > 0 && <div className="day-muscles-row" aria-label="Targeted muscles">
      {muscles.slice(0, 5).map(m => <span key={m} className="muscle-chip">{m}</span>)}
      {muscles.length > 5 && <span className="muscle-chip muscle-chip-overflow" title={muscles.slice(5).join(', ')}>+{muscles.length - 5}</span>}
    </div>}
    {expanded && full && <div className="slot-exercises">
      {full.exercises.map(exercise => <Button key={exercise.id} variant="tertiary" aria-label={`Swap ${exercise.name} in ${day.name}`} onClick={() => onSwap(exercise)}><RefreshCw size={14} />{exercise.name}</Button>)}
    </div>}
  </div>;
}
