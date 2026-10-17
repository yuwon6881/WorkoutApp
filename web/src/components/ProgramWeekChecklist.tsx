import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, CirclePlay, ChevronRight, Play, SkipForward } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft, ProgramProgressDay, ProgramSummary } from '../types';
import { ApiError, api } from '../lib/api';
import { dayTitle, isGenericDayTitle } from '../lib/dayTitle';
import { dayRowState, inProgressDayId, nextDayId as findNextDayId, programDayActionInput } from '../lib/programDayState';
import { applyExerciseEdit, countOccurrences, type ExerciseEditing, type UnsavedExercise } from '../lib/exerciseEditScope';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { DayDetailContent } from './ImportDayRow';
import { ReadOnlyDay } from './ReadOnlyDay';
import { DayEditor } from './ImportDayEditor';
import './ProgramWeekChecklist.css';

export function ProgramWeekChecklist({
  program,
  draft,
  exercises,
  onStart,
  onChanged,
  hasActiveWorkout,
  activeTemplateId = null,
  onDayChange,
  onDraftChange,
  actionsBusy = false
}: {
  program: ProgramSummary;
  draft?: ImportDraft | null;
  exercises: Exercise[];
  onStart: (templateId: string) => void;
  onChanged: () => Promise<void>;
  hasActiveWorkout: boolean;
  /** The day the open workout came from; its dialog continues that workout. */
  activeTemplateId?: string | null;
  onDayChange?: (day: DraftWorkout) => Promise<void>;
  onDraftChange?: (draft: ImportDraft) => Promise<void>;
  actionsBusy?: boolean;
}) {
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [optimisticPassed, setOptimisticPassed] = useState<Set<string>>(() => new Set());
  const [openDay, setOpenDay] = useState<ProgramProgressDay | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [localDraft, setLocalDraft] = useState<ImportDraft | null>(draft ?? null);

  const repRangeMemories = useRef(new Map<string, Map<number, number>>());
  const unsaved = useRef(new Map<string, UnsavedExercise>());
  const [discardPrompt, setDiscardPrompt] = useState<string | null>(null);

  const progress = program.progress;
  const days = progress?.days ?? [];
  // The open workout's day reads as in progress; Next moves on to the day after it.
  const runningDayId = inProgressDayId(days, activeTemplateId, hasActiveWorkout);
  const nextDayId = findNextDayId(days, optimisticPassed, runningDayId);
  const dayDetails = useMemo(() => new Map(program.days.map(day => [day.id, day])), [program.days]);
  const currentDays = useMemo(() => progress ? program.days.filter(day => day.week === progress.currentWeek) : program.days, [program.days, progress]);

  useEffect(() => {
    if (draft) setLocalDraft(draft);
  }, [draft]);

  const getRepRangeMemory = useCallback((exerciseLineId: string) => {
    let memory = repRangeMemories.current.get(exerciseLineId);
    if (!memory) {
      memory = new Map<number, number>();
      repRangeMemories.current.set(exerciseLineId, memory);
    }
    return memory;
  }, []);

  const handleDayChange = useCallback(async (updatedDay: DraftWorkout) => {
    setLocalDraft(prev => prev ? {
      ...prev,
      workouts: prev.workouts.map(w => w.lineId === updatedDay.lineId ? updatedDay : w)
    } : null);
    if (onDayChange) {
      await onDayChange(updatedDay);
    }
  }, [onDayChange]);

  const handleDraftChange = useCallback(async (nextDraft: ImportDraft) => {
    if (onDraftChange) {
      await onDraftChange(nextDraft);
    }
    setLocalDraft(nextDraft);
  }, [onDraftChange]);

  // Days already passed, and every day of an earlier week, are history: an edit to the same
  // movement elsewhere never reaches them.
  const frozenDayIds = useMemo(() => {
    const frozen = new Set(days.filter(day => day.status !== 'pending').map(day => day.templateId));
    if (progress) for (const day of program.days) if (day.week < progress.currentWeek) frozen.add(day.id);
    return frozen;
  }, [days, program.days, progress]);

  const editing = useMemo<ExerciseEditing>(() => ({
    save: async (base, edited, scope) => {
      if (!localDraft) return;
      const nextDraft = applyExerciseEdit(localDraft, base, edited, scope, exercises, frozenDayIds);
      await handleDraftChange(nextDraft);
    },
    count: base => localDraft ? countOccurrences(localDraft, base, frozenDayIds) : { block: 1, program: 1 },
    keepWrittenName: false,
    unsaved: unsaved.current
  }), [exercises, frozenDayIds, handleDraftChange, localDraft]);

  const closeModal = useCallback(() => {
    if (unsaved.current.size > 0) {
      setDiscardPrompt(openDay?.templateId ?? null);
      return;
    }
    setOpenDay(null);
    setSelectedMuscle(null);
  }, [openDay]);

  const handleKeepEditing = useCallback(() => {
    setDiscardPrompt(null);
  }, []);

  const handleDiscardChanges = useCallback(() => {
    unsaved.current.clear();
    setDiscardPrompt(null);
    setOpenDay(null);
    setSelectedMuscle(null);
  }, []);

  useEffect(() => {
    setOptimisticPassed(prev => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const id of prev) {
        const d = program.progress?.days.find(x => x.templateId === id);
        if (d && d.status !== 'pending') next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [program.progress]);

  async function passRest(day: ProgramProgressDay) {
    if (!progress || actionsBusy || progress.runId === 'optimistic' || !day.isRestDay || !program.active || day.status !== 'pending' || hasActiveWorkout) return;
    setOptimisticPassed(prev => new Set(prev).add(day.templateId));
    setBusyDay(day.templateId);
    setError('');
    try {
      await api.passProgramRestDay(program.id, day.templateId, programDayActionInput(program));
      await onChanged();
    } catch (failure) {
      setOptimisticPassed(prev => {
        const next = new Set(prev);
        next.delete(day.templateId);
        return next;
      });
      setError(failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : 'Could not update this rest day.');
    } finally { setBusyDay(null); }
  }

  async function skipWorkout(day: ProgramProgressDay) {
    if (!progress || actionsBusy || progress.runId === 'optimistic' || day.isRestDay || !program.active || day.status !== 'pending' || hasActiveWorkout) return;
    setBusyDay(day.templateId);
    setError('');
    try {
      await api.skipProgramWorkout(program.id, day.templateId, programDayActionInput(program));
      await onChanged();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : 'Could not skip this workout.');
    } finally { setBusyDay(null); }
  }

  const openDayWorkout = openDay ? localDraft?.workouts.find(w => w.lineId === openDay.templateId) : null;
  const openDayIndex = openDay ? currentDays.findIndex(d => d.id === openDay.templateId) : -1;
  const openDayInfo = openDay ? dayDetails.get(openDay.templateId) : null;
  const openDayWorkoutName = openDayWorkout?.name || openDayInfo?.name || '';
  const openDayTitle = openDayInfo ? dayTitle(openDayWorkoutName, openDayIndex + 1) : '';
  const modalTitle = openDayInfo
    ? `Day ${openDayIndex + 1}${isGenericDayTitle(openDayTitle) ? '' : ` · ${openDayTitle}`}`
    : '';

  // The week itself is named once, by the meter under the program name.
  return <section className="program-week-checklist" aria-label={program.active ? 'This week' : 'Last run'}>
    {progress && days.length > 0 ? <>
      <div className="program-week-days" role="list" aria-label="Days this week">
        {days.map(day => {
          const info = dayDetails.get(day.templateId);
          if (!info) return null;
          const isRest = day.isRestDay;
          const passed = day.status !== 'pending' || optimisticPassed.has(day.templateId);

          if (isRest) {
            return <div className={`program-week-day rest ${passed ? 'passed' : ''} ${day.templateId === nextDayId ? 'next' : ''}`} key={day.templateId} role="listitem">
              <label className="program-week-check">
                <input
                  id={`program-rest-day-${day.templateId}`}
                  name={`program-rest-day-${day.templateId}`}
                  type="checkbox"
                  checked={passed}
                  readOnly={passed}
                  tabIndex={passed ? -1 : 0}
                  disabled={!program.active || actionsBusy || progress.runId === 'optimistic' || busyDay !== null || hasActiveWorkout}
                  aria-label={`${info.name}: ${passed ? 'Rest day passed' : 'Rest day'}${!passed ? ', mark rest day passed' : ''}`}
                  onClick={passed ? e => e.preventDefault() : undefined}
                  onChange={passed ? undefined : () => void passRest(day)}
                />
                {/* The box is drawn as the workout rows' marker so every row's tick lines up. */}
                <span className={`program-day-marker ${passed ? 'completed' : ''}`.trim()} aria-hidden="true">
                  {passed ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                </span>
                <div className="program-week-info">
                  <span className="program-week-name">{info.name}</span>
                </div>
              </label>
              <div className="program-week-status-col">
                <span className="tiny-label rest-badge">Rest</span>
                <span className="program-week-chevron-slot" aria-hidden="true" />
              </div>
            </div>;
          }

          const state = dayRowState(day, nextDayId, runningDayId);
          return <div
            className={`program-week-day exercise-day ${passed ? 'passed' : ''} ${state === 'next' ? 'next' : ''} ${state === 'in-progress' ? 'in-progress' : ''}`.replace(/\s+/g, ' ').trim()}
            key={day.templateId}
            role="button"
            tabIndex={0}
            aria-label={`View ${info.name}`}
            aria-description={state === 'completed' ? 'Completed' : state === 'skipped' ? 'Skipped' : state === 'in-progress' ? 'Workout in progress' : state === 'next' ? 'Next workout' : 'Upcoming workout'}
            onClick={() => { setSelectedMuscle(null); setOpenDay(day); }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedMuscle(null);
                setOpenDay(day);
              }
            }}
          >
            <div className="program-week-check">
              <span className={`program-day-marker ${state === 'completed' ? 'completed' : ''} ${state === 'in-progress' ? 'in-progress' : ''}`.trim()} aria-hidden="true">
                {state === 'completed' ? <CheckCircle2 size={20} /> : state === 'skipped' ? <SkipForward size={18} /> : state === 'in-progress' ? <CirclePlay size={20} /> : <Circle size={20} />}
              </span>
              <div className="program-week-info">
                <span className="program-week-name">{info.name}</span>
              </div>
            </div>
            <div className="program-week-status-col">
              {state === 'completed' && <span className="program-day-status completed">Done</span>}
              {state === 'skipped' && <span className="program-day-status">Skipped</span>}
              {state === 'in-progress' && <span className="program-day-status in-progress">In progress</span>}
              {state === 'next' && <span className="program-day-status next">Next</span>}
              {day.status === 'pending' && <ChevronRight className="program-week-chevron muted" size={16} aria-hidden="true" />}
            </div>
          </div>;
        })}
      </div>
      {!program.active && progress.passedDays === progress.totalDays && <p className="program-week-note">All weeks are complete. Activate this program to start a fresh run.</p>}
      {hasActiveWorkout && program.active && <p className="program-week-note">Finish or discard the active workout before starting, skipping, or resetting a day.</p>}
    </> : <p className="program-week-note">Activate this program to begin its first week.</p>}

    {error && <p className="error-text program-week-error" role="alert">{error}</p>}

    {openDay && (
      <Modal
        title={modalTitle}
        wide
        onClose={closeModal}
        className="day-detail-modal"
        headerActions={
          openDay.status === 'pending' && program.active ? (
            <MenuButton label={`Actions for ${openDayWorkoutName || 'workout'}`} portal>
              <MenuItem disabled={actionsBusy || progress?.runId === 'optimistic' || hasActiveWorkout || busyDay !== null} onClick={() => {
                const target = openDay;
                closeModal();
                void skipWorkout(target);
              }}>
                <SkipForward size={14} />Skip this workout day
              </MenuItem>
            </MenuButton>
          ) : undefined
        }
      >
        <div className="modal-body day-detail-modal-body draft-day" data-import-day={openDay.templateId}>
          {openDayWorkout && openDay.status !== 'pending' ? (
            <ReadOnlyDay day={openDayWorkout} exercises={exercises} selectedMuscle={selectedMuscle} onMuscleSelect={setSelectedMuscle} />
          ) : openDayWorkout ? (
            <DayDetailContent
              day={openDayWorkout}
              exercises={exercises}
              onChange={handleDayChange}
              editing={editing}
              DayEditorComponent={DayEditor}
              getRepRangeMemory={getRepRangeMemory}
              selectedMuscle={selectedMuscle}
              onMuscleSelect={setSelectedMuscle}
            />
          ) : (
            <p className="muted small-copy" role="status">Loading workout details…</p>
          )}
        </div>
        <div className="modal-actions">
          {openDay.status === 'pending' ? (
            <Button variant="primary" disabled={actionsBusy || progress?.runId === 'optimistic' || (hasActiveWorkout && openDay.templateId !== activeTemplateId)} onClick={() => {
              const targetId = openDay.templateId;
              closeModal();
              onStart(targetId);
            }}>
              <Play size={14} fill="currentColor" />{openDay.templateId === activeTemplateId ? 'Continue workout' : 'Start workout'}
            </Button>
          ) : (
            <Button variant="primary" onClick={closeModal}>Done</Button>
          )}
        </div>
      </Modal>
    )}

    {discardPrompt && (
      <Modal title="Discard unsaved changes?" onClose={handleKeepEditing}>
        <div className="modal-body">
          <p>{unsaved.current.size === 1 ? 'An exercise on this day has' : `${unsaved.current.size} exercises have`} changes that were not saved.</p>
        </div>
        <div className="modal-actions">
          <Button variant="destructive" onClick={handleDiscardChanges}>Discard changes</Button>
          <Button variant="primary" onClick={handleKeepEditing}>Keep editing</Button>
        </div>
      </Modal>
    )}
  </section>;
}
