import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Play, SkipForward } from 'lucide-react';
import type { Exercise, ImportDraft, ProgramProgressDay, ProgramSummary } from '../types';
import { ApiError, api } from '../lib/api';
import { dayTitle, isGenericDayTitle } from '../lib/dayTitle';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { ReadOnlyDay } from './ReadOnlyDay';
import './ProgramWeekChecklist.css';

export function ProgramWeekChecklist({ program, draft, exercises, onStart, onChanged, hasActiveWorkout }: {
  program: ProgramSummary;
  draft?: ImportDraft | null;
  exercises: Exercise[];
  onStart: (templateId: string) => void;
  onChanged: () => Promise<void>;
  hasActiveWorkout: boolean;
}) {
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [optimisticPassed, setOptimisticPassed] = useState<Set<string>>(() => new Set());
  const [openDay, setOpenDay] = useState<ProgramProgressDay | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);

  const progress = program.progress;
  const days = progress?.days ?? [];
  const dayDetails = useMemo(() => new Map(program.days.map(day => [day.id, day])), [program.days]);
  const currentDays = useMemo(() => progress ? program.days.filter(day => day.week === progress.currentWeek) : program.days, [program.days, progress]);

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

  function actionInput() {
    if (!progress) throw new Error('The current program week is not available. Refresh and try again.');
    return {
      revision: program.revision,
      runId: progress.runId,
      week: progress.currentWeek,
      attempt: progress.currentAttempt,
      idempotencyId: crypto.randomUUID()
    };
  }

  async function passRest(day: ProgramProgressDay) {
    if (!progress || !day.isRestDay || !program.active || day.status !== 'pending' || hasActiveWorkout) return;
    setOptimisticPassed(prev => new Set(prev).add(day.templateId));
    setBusyDay(day.templateId);
    setError('');
    try {
      await api.passProgramRestDay(program.id, day.templateId, actionInput());
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
    if (!progress || day.isRestDay || !program.active || day.status !== 'pending' || hasActiveWorkout) return;
    setBusyDay(day.templateId);
    setError('');
    try {
      await api.skipProgramWorkout(program.id, day.templateId, actionInput());
      await onChanged();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : 'Could not skip this workout.');
    } finally { setBusyDay(null); }
  }

  const openDayWorkout = openDay ? draft?.workouts.find(w => w.lineId === openDay.templateId) : null;
  const openDayIndex = openDay ? currentDays.findIndex(d => d.id === openDay.templateId) : -1;
  const openDayInfo = openDay ? dayDetails.get(openDay.templateId) : null;
  const openDayTitle = openDayInfo ? dayTitle(openDayInfo.name, openDayIndex + 1) : '';
  const modalTitle = openDayInfo
    ? `Day ${openDayIndex + 1}${isGenericDayTitle(openDayTitle) ? '' : ` · ${openDayTitle}`}`
    : '';

  return <section className="program-week-checklist" aria-labelledby={`program-week-title-${program.id}`}>
    <div className="program-week-heading">
      <div>
        <span className="program-week-kicker">{program.active ? 'Current week' : progress?.runId ? 'Last run' : 'Program week'}</span>
        <h3 id={`program-week-title-${program.id}`}>{progress ? `Week ${progress.currentWeek} of ${program.weeks}` : 'Ready to start'}</h3>
      </div>
      {progress && <span className="program-week-count" aria-label={`${progress.passedDays} of ${progress.totalDays} days passed`}>
        {progress.passedDays}/{progress.totalDays} passed
      </span>}
    </div>

    {progress && days.length > 0 ? <>
      <div className="program-week-days" role="list" aria-label={`Week ${progress.currentWeek} checklist`}>
        {days.map(day => {
          const info = dayDetails.get(day.templateId);
          if (!info) return null;
          const isRest = day.isRestDay;
          const passed = day.status !== 'pending' || optimisticPassed.has(day.templateId);

          if (isRest) {
            return <div className={`program-week-day rest ${passed ? 'passed' : ''}`} key={day.templateId} role="listitem">
              <label className="program-week-check">
                <input
                  type="checkbox"
                  checked={passed}
                  disabled={!program.active || passed || busyDay !== null || hasActiveWorkout}
                  aria-label={`${info.name}: ${passed ? 'Rest day passed' : 'Rest day'}${!passed ? ', mark rest day passed' : ''}`}
                  onChange={() => void passRest(day)}
                />
                <div className="program-week-info">
                  <span className="program-week-name">{info.name}</span>
                </div>
              </label>
              <div className="program-week-status-col">
                <span className="tiny-label rest-badge">Rest</span>
              </div>
            </div>;
          }

          const draftWorkout = draft?.workouts.find(w => w.lineId === day.templateId);
          const setCount = draftWorkout ? draftWorkout.exercises.reduce((sum, ex) => sum + ex.sets.length, 0) : null;
          const dayMeta = [
            `${info.exerciseCount} ${info.exerciseCount === 1 ? 'exercise' : 'exercises'}`,
            setCount !== null ? `${setCount} sets` : null,
            info.focus || null
          ].filter(Boolean).join(' · ');

          return <div
            className={`program-week-day exercise-day ${passed ? 'passed' : ''}`}
            key={day.templateId}
            role="button"
            tabIndex={0}
            aria-label={`View ${info.name}`}
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
              <input
                type="checkbox"
                checked={passed}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                onClick={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  setSelectedMuscle(null);
                  setOpenDay(day);
                }}
              />
              <div className="program-week-info">
                <span className="program-week-name">{info.name}</span>
                <span className="program-week-meta">{dayMeta}</span>
              </div>
            </div>
            <div className="program-week-status-col">
              {day.status === 'completed' && <Check className="program-week-complete-icon" size={18} aria-label="Completed" />}
              {day.status === 'skipped' && <span className="program-week-skipped-indicator" title="Skipped"><SkipForward size={14} className="muted" /></span>}
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
        onClose={() => { setOpenDay(null); setSelectedMuscle(null); }}
        className="day-detail-modal"
        headerActions={
          openDay.status === 'pending' && program.active ? (
            <MenuButton label={`Actions for ${openDayInfo?.name ?? 'workout'}`} portal>
              <MenuItem disabled={hasActiveWorkout || busyDay !== null} onClick={() => {
                const target = openDay;
                setOpenDay(null);
                setSelectedMuscle(null);
                void skipWorkout(target);
              }}>
                <SkipForward size={14} />Skip this workout day
              </MenuItem>
            </MenuButton>
          ) : undefined
        }
      >
        <div className="modal-body day-detail-modal-body draft-day" data-import-day={openDay.templateId}>
          {openDayWorkout ? (
            <ReadOnlyDay
              day={openDayWorkout}
              exercises={exercises}
              selectedMuscle={selectedMuscle}
              onMuscleSelect={setSelectedMuscle}
            />
          ) : (
            <p className="muted small-copy" role="status">Loading workout details…</p>
          )}
        </div>
        <div className="modal-actions">
          {openDay.status === 'pending' ? (
            <Button variant="primary" disabled={hasActiveWorkout} onClick={() => {
              const targetId = openDay.templateId;
              setOpenDay(null);
              setSelectedMuscle(null);
              onStart(targetId);
            }}>
              <Play size={14} fill="currentColor" />Start workout
            </Button>
          ) : (
            <Button variant="primary" onClick={() => { setOpenDay(null); setSelectedMuscle(null); }}>Done</Button>
          )}
        </div>
      </Modal>
    )}
  </section>;
}
