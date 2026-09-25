import { useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronUp, Dumbbell, FileText, Play, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import type { Bootstrap, Exercise, ProgramSummary, Template, TemplateExercise } from '../types';
import { ApiError, api } from '../lib/api';
import { getPlannedMuscleCredits } from '../lib/programMuscles';
import { createEmptyProgramDraft } from '../lib/importDraftWeeks';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { Select } from './ui/Select';
import { ExerciseLibrary } from './Exercises';
import { WorkoutEditorModal, type WorkoutDraft } from './WorkoutEditorModal';
import { ProgramBuilderPage } from './ProgramBuilderPage';
import { ProgramWeekChecklist } from './ProgramWeekChecklist';
import { ActiveWorkoutStandby } from './ActiveWorkoutStandby';
import { ProgramMusclePreview } from './ProgramMusclePreview';
import { RoutineCard } from './RoutineCard';

export function Programs({ data, exercises, onStart, onImport, onChanged }: {
  data: Bootstrap; exercises: Exercise[]; onStart: (templateId: string) => void; onImport: () => void; onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);

  const open = (template?: Template) => {
    setDraft(template
      ? { id: template.id, name: template.name, focus: template.focus, revision: template.revision, exercises: structuredClone(template.exercises), canRestore: template.canRestore, isLegacyBaseline: template.isLegacyBaseline }
      : { id: null, name: '', focus: '', revision: null, exercises: [] });
  };

  async function save(savedDraft: WorkoutDraft) {
    setBusy(true);
    const input = {
      name: savedDraft.name.trim(), focus: savedDraft.focus.trim(), note: null, revision: savedDraft.revision, idempotencyId: crypto.randomUUID(),
      exercises: savedDraft.exercises.map(e => ({ exerciseId: e.exerciseId, sourceName: e.sourceName || e.name, note: e.note || null, sets: e.sets,
        sequenceGroup: e.sequenceGroup || null, substitutions: e.substitutions ?? [], sourcePage: e.sourcePage ?? null,
        slotKey: e.slotKey ?? null, restSeconds: e.restSeconds ?? null, demoUrl: e.demoUrl ?? null,
        demoLinks: e.demoLinks ?? null }))
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

  if (building) {
    return <ProgramBuilderPage initialDraft={createEmptyProgramDraft()} exercises={exercises}
      onBack={() => setBuilding(false)}
      onCreated={async () => { await onChanged(); }} />;
  }

  const hasActiveWorkout = Boolean(data.activeWorkout?.active);
  const isActive = (program: ProgramSummary) => (program.lifecycleStatus ?? (program.active ? 'active' : 'standby')) === 'active';
  const activePrograms = data.programs.filter(isActive);
  const libraryPrograms = data.programs.filter(program => !isActive(program));

  return <>
    <div className="page-heading">
      <h1 data-page-heading tabIndex={-1}>Workouts</h1>
      <div className="heading-actions">
        <MenuButton label="Add a workout or program" text="New" variant="primary" icon={<Plus size={17} />}>
          <MenuItem onClick={() => open()}><Dumbbell size={14} />New workout</MenuItem>
          <MenuItem onClick={() => setBuilding(true)}><Plus size={14} />New program</MenuItem>
          <MenuItem onClick={onImport} disabled={hasActiveWorkout}><FileText size={14} />Import a PDF program</MenuItem>
        </MenuButton>
      </div>
    </div>
    {hasActiveWorkout && <p className="program-week-note">Finish or discard the active workout before importing a program.</p>}

    <section className="program-section">
      <div className="section-heading"><h2>Active workout</h2></div>
      {activePrograms.length
        ? activePrograms.map(program => <ProgramCard key={program.id} program={program} exercises={exercises}
          onStart={onStart} onChanged={onChanged} hasActiveWorkout={hasActiveWorkout} />)
        : <ActiveWorkoutStandby
            hasTemplates={Boolean(libraryPrograms.length || data.templates.length)}
            onNewWorkout={() => open()}
            onImport={onImport}
          />}
    </section>

    <section className="program-section">
      <div className="section-heading"><h2>Workout library</h2>
        <span className="muted">{libraryPrograms.length + data.templates.length} saved</span></div>
      {libraryPrograms.map(program => <ProgramCard key={program.id} program={program} exercises={exercises}
        onStart={onStart} onChanged={onChanged} hasActiveWorkout={hasActiveWorkout} />)}
      {data.templates.length ? <div className="program-grid">{data.templates.map(template => (
        <RoutineCard key={template.id} template={template} exercises={exercises} onEdit={() => open(template)} onStart={() => onStart(template.id)} />
      ))}</div>
        : libraryPrograms.length === 0 && <section className="panel"><div className="empty-message"><Dumbbell size={30} /><h3>Your library is empty</h3>
          <p>{exercises.length ? 'Build a workout or a program by hand, or import one from a PDF.' : 'The exercise library is still empty, so a workout cannot be built yet. Importing a PDF will still create a reviewable draft.'}</p></div></section>}
    </section>

    {draft && <WorkoutEditorModal initialDraft={draft} exercises={exercises} busy={busy} onSave={save} onDelete={remove} onClose={() => setDraft(null)} />}
  </>;
}

function ProgramCard({ program, exercises, onStart, onChanged, hasActiveWorkout }: { program: ProgramSummary; exercises: Exercise[]; onStart: (id: string) => void; onChanged: () => Promise<void>; hasActiveWorkout: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Template[] | null>(null);
  const [swapTarget, setSwapTarget] = useState<{ template: Template; exercise: TemplateExercise } | null>(null);
  const [swapScope, setSwapScope] = useState<'slot' | 'phase'>('slot');
  const [swapChoice, setSwapChoice] = useState<Exercise | null>(null);
  const [confirmPhaseSwap, setConfirmPhaseSwap] = useState(false);
  const next = program.days.find(w => w.id === program.nextTemplateId);
  const completedRun = !program.active && !!program.progress && program.progress.passedDays === program.progress.totalDays;
  const visibleDays = program.active && program.progress
    ? program.days.filter(day => day.week === program.progress?.currentWeek)
    : program.days;

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

  return <section className="panel program-card">
    <div className="section-heading">
      <div><h2>{program.name}</h2><p className="muted">{program.weeks} {program.weeks === 1 ? 'week' : 'weeks'} · {program.days.length} days{program.progress ? ` · Week ${program.progress.currentWeek}: ${program.progress.passedDays} of ${program.progress.totalDays} passed` : ''}</p></div>
      <span className={`tiny-label ${program.lifecycleStatus === 'completed' ? '' : 'accent'}`}>{program.lifecycleStatus === 'completed' ? 'Completed' : program.active ? 'Active' : 'Standby'}</span>
    </div>
    {program.lifecycleStatus === 'completed' && program.completedAt && <p className="muted small-copy">Completed {new Date(program.completedAt).toLocaleString()}</p>}
    {!!program.phases?.length && <div className="phase-progress" aria-label="Program phase progress">
      {program.phases.map(phase => <span className="tiny-label" key={phase.id}>{phase.name} · W{phase.currentWeek ?? 1}/{phase.durationWeeks} · {phase.completedWorkouts} completed{phase.skippedWorkouts ? ` · ${phase.skippedWorkouts} skipped` : ''}/{phase.totalWorkouts}{phase.complete ? ' · Done' : ''}{phase.sourcePageFrom ? ` · PDF pp.${phase.sourcePageFrom}${phase.sourcePageTo && phase.sourcePageTo !== phase.sourcePageFrom ? `–${phase.sourcePageTo}` : ''}` : ''}</span>)}
    </div>}
    {program.progress && <ProgramWeekChecklist program={program} onStart={onStart} onChanged={onChanged} hasActiveWorkout={hasActiveWorkout} />}
      <Button variant="tertiary" className="full-width" onClick={() => void toggleDetails()} disabled={busy}>{busy ? 'Loading…' : expanded ? 'Hide details' : 'Show details'}</Button>
    {expanded && <ProgramTree days={visibleDays} completed={program.completedTemplateIds} skipped={program.skippedTemplateIds ?? []} nextId={program.nextTemplateId} detail={detail} exercises={exercises} onStart={onStart} canStart={program.active} onSwap={template => exercise => { setSwapTarget({ template, exercise }); setSwapScope('slot'); setSwapChoice(null); setConfirmPhaseSwap(false); }} />}
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="settings-actions">
      {program.active && next && <Button variant="primary" onClick={() => onStart(next.id)}>Start {next.name}<ArrowRight size={16} /></Button>}
      {program.lifecycleStatus !== 'completed' && <Button disabled={busy} onClick={() => act(() => api.setProgramActive(program.id, !program.active, program.revision))}>{program.active ? 'Move to standby' : 'Make active'}</Button>}
      {program.lifecycleStatus === 'completed' && <Button disabled={busy} onClick={() => act(() => api.setProgramActive(program.id, true, program.revision))}>Start fresh run</Button>}
      {(program.lifecycleStatus === 'completed' || completedRun) && <Button variant="tertiary" disabled={busy} onClick={() => act(() => api.repeatProgram(program.id))}>Repeat as new program</Button>}
      <Button variant="destructive" disabled={busy} onClick={() => act(() => api.deleteProgram(program.id))}>Delete program</Button>
    </div>
    {swapTarget && <Modal title={`Swap ${swapTarget.exercise.name}`} onClose={() => setSwapTarget(null)}>
      <div className="modal-body"><p className="source">Reps, sets, RIR, rest, tempo, warm-ups, notes, and source provenance stay with the slot. Loads are recalculated when the workout starts.</p>
        {swapTarget.template.isLegacyBaseline && <p className="muted small-copy">Restores to current saved version (earlier history unavailable)</p>}
        {program.phases?.some(phase => phase.id === swapTarget.template.phaseId || (phase.name === swapTarget.template.phase && phase.block === swapTarget.template.block)) && <label className="field">Apply to<Select name="swap-scope-select" value={swapScope} onChange={val => { setSwapScope(val as 'slot' | 'phase'); setConfirmPhaseSwap(false); }} ariaLabel="Apply swap scope" options={[{ value: 'slot', label: 'This workout only' }, { value: 'phase', label: 'Remaining workouts in this phase' }]} /></label>}
        {swapScope === 'phase' && <><div className="preview-card"><strong>Preview</strong><p>{detail?.filter(item => (item.phaseId === swapTarget.template.phaseId || (item.phase === swapTarget.template.phase && item.block === swapTarget.template.block)) && !program.completedTemplateIds.includes(item.id) && !(program.skippedTemplateIds ?? []).includes(item.id)).map(item => item.name).join(', ') || 'No remaining workouts in this phase.'}</p></div><label className="checkbox-row"><input id="confirm-phase-swap" name="confirm-phase-swap" type="checkbox" checked={confirmPhaseSwap} onChange={event => setConfirmPhaseSwap(event.target.checked)} />Apply this replacement to the previewed remaining workouts only.</label></>}
        <ExerciseLibrary action="swap" exercises={exercises} exclude={[]}
          currentExerciseId={swapTarget.exercise.exerciseId}
          preferredNames={swapTarget.exercise.substitutions}
          onSelect={id => setSwapChoice(exercises.find(item => item.id === id) ?? null)} />
        {swapChoice && <p className="source">Selected replacement: <strong>{swapChoice.name}</strong></p>}
      </div>
      <div className="modal-actions">
        {swapTarget.exercise.canRestore && <Button variant="tertiary" disabled={busy || (swapScope === 'phase' && !confirmPhaseSwap)} onClick={() => void (async () => {
          await act(async () => {
            await api.restoreTemplateSubstitution(swapTarget.template.id, {
              templateExerciseId: swapTarget.exercise.id,
              slotKey: swapTarget.exercise.slotKey ?? undefined,
              scope: swapScope,
              revision: swapTarget.template.revision,
              idempotencyId: crypto.randomUUID()
            });
            setDetail((await api.getProgram(program.id)).workouts);
            setSwapTarget(null);
          });
        })}><RotateCcw size={14} />Restore default</Button>}
        <Button onClick={() => setSwapTarget(null)}>Cancel</Button>
        <Button variant="primary" disabled={!swapChoice || busy || (swapScope === 'phase' && !confirmPhaseSwap)} onClick={() => void (async () => { if (!swapChoice) return; await act(async () => { await api.substituteTemplateExercise(swapTarget.template.id, { templateExerciseId: swapTarget.exercise.id, slotKey: swapTarget.exercise.slotKey ?? undefined, replacementExerciseId: swapChoice.id, replacementName: swapChoice.name, scope: swapScope, revision: swapTarget.template.revision, idempotencyId: crypto.randomUUID() }); setDetail((await api.getProgram(program.id)).workouts); setSwapTarget(null); }); })()}>Apply swap</Button>
      </div>
    </Modal>}
  </section>;
}

function ProgramTree({ days, completed, skipped, nextId, detail, exercises, onStart, canStart, onSwap }: { days: ProgramSummary['days']; completed: string[]; skipped: string[]; nextId: string | null; detail: Template[] | null; exercises: Exercise[]; onStart: (id: string) => void; canStart: boolean; onSwap: (template: Template) => (exercise: TemplateExercise) => void }) {
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
        const complete = day.progressStatus === 'completed' || completed.includes(day.id);
        const isSkipped = day.progressStatus === 'skipped' || skipped.includes(day.id);
        const restPassed = day.progressStatus === 'rest_passed';
        return <ProgramSlotRow key={day.id} day={day} full={full} complete={complete} isSkipped={isSkipped} restPassed={restPassed} isNext={day.id === nextId} canStart={canStart} exercises={exercises} onStart={onStart} onSwap={full ? onSwap(full) : () => {}} />;
      })}</div>
    </details>)}
  </details>)}</div>;
}

function ProgramSlotRow({ day, full, complete, isSkipped, restPassed, isNext, canStart, exercises, onStart, onSwap }: {
  day: ProgramSummary['days'][number];
  full: Template | undefined;
  complete: boolean;
  isSkipped: boolean;
  restPassed: boolean;
  isNext: boolean;
  canStart: boolean;
  exercises: Exercise[];
  onStart: (id: string) => void;
  onSwap: (exercise: TemplateExercise) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const muscleSummary = useMemo(
    () => getPlannedMuscleCredits(full?.exercises ?? [], exercises),
    [full, exercises]
  );
  const preview = useMemo(() => {
    if (!full?.exercises?.length) return '';
    const names = full.exercises.map(e => e.name);
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 4).join(', ')}, and ${names.length - 4} more`;
  }, [full]);

  const actionable = canStart && !day.isRestDay && day.progressStatus === 'pending' && !complete && !isSkipped;
  const statusLabel = day.isRestDay ? restPassed ? 'Rest day passed' : 'Rest day' : complete ? 'Done' : isSkipped ? 'Skipped' : isNext ? 'Up next' : `${full?.exercises.length ?? day.exerciseCount} exercises`;

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
        {full && <Button variant="tertiary" aria-label={expanded ? `Hide details for ${day.name}` : `Show details for ${day.name}`} aria-expanded={expanded} onClick={() => setExpanded(e => !e)}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</Button>}
      </div>
    </div>
    {preview && <p className="day-exercise-preview">{preview}</p>}
    {expanded && full && <>
      <ProgramMusclePreview summary={muscleSummary} />
      {full.exercises.length > 0 && <div className="slot-exercises">
        {full.exercises.map(exercise => <Button key={exercise.id} variant="tertiary" aria-label={`Swap ${exercise.name} in ${day.name}`} onClick={() => onSwap(exercise)}><RefreshCw size={14} />{exercise.name}{exercise.canRestore ? ' · Swapped' : ''}</Button>)}
      </div>}
    </>}
  </div>;
}
