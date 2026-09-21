import { useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { ProgramSummary, ProgramProgressDay } from '../types';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import './ProgramWeekChecklist.css';

export function ProgramWeekChecklist({ program, onStart, onChanged, hasActiveWorkout }: {
  program: ProgramSummary;
  onStart: (templateId: string) => void;
  onChanged: () => Promise<void>;
  hasActiveWorkout: boolean;
}) {
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [error, setError] = useState('');
  const progress = program.progress;
  const days = progress?.days ?? [];
  const canReset = program.active && (progress?.passedDays ?? 0) > 0;

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
    setBusyDay(day.templateId);
    setError('');
    try {
      await api.passProgramRestDay(program.id, day.templateId, actionInput());
      await onChanged();
    } catch (failure) {
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

  async function resetWeek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!progress || !canReset || resetPhrase !== 'RESET' || hasActiveWorkout) return;
    setBusyDay('reset');
    setError('');
    try {
      await api.resetProgramWeek(program.id, { ...actionInput(), confirmation: resetPhrase });
      await onChanged();
      setResetOpen(false);
      setResetPhrase('');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : 'Could not reset this week.');
    } finally { setBusyDay(null); }
  }

  const dayDetails = new Map(program.days.map(day => [day.id, day]));
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
          const passed = day.status !== 'pending';
          const statusLabel = day.status === 'completed' ? 'Completed' : day.status === 'skipped' ? 'Skipped' : day.status === 'rest_passed' ? 'Rest day passed' : day.isRestDay ? 'Rest day' : 'Not passed';
          return <div className={`program-week-day ${passed ? 'passed' : ''} ${day.isRestDay ? 'rest' : ''}`} key={day.templateId} role="listitem">
            <label className="program-week-check">
              <input
                type="checkbox"
                checked={passed}
                disabled={!day.isRestDay || !program.active || passed || busyDay !== null || hasActiveWorkout}
                aria-label={`${info.name}: ${statusLabel}${day.isRestDay && !passed ? ', mark rest day passed' : ''}`}
                onChange={() => void passRest(day)}
              />
              <span className="program-week-name">{info.name}</span>
            </label>
            <span className="program-week-status">{statusLabel}</span>
            {!day.isRestDay && day.status === 'pending' && <div className="program-week-actions">
              {program.active && <>
                <Button variant="primary" disabled={busyDay !== null || hasActiveWorkout} aria-label={`Start ${info.name}`} onClick={() => onStart(info.id)}>
                  <Play size={14} fill="currentColor" />Start
                </Button>
                <Button variant="tertiary" disabled={busyDay !== null || hasActiveWorkout} aria-label={`Skip ${info.name}`} onClick={() => void skipWorkout(day)}>
                  <SkipForward size={15} />Skip
                </Button>
              </>}
            </div>}
            {day.status === 'completed' && <Check className="program-week-complete-icon" size={16} aria-hidden="true" />}
          </div>;
        })}
      </div>
      {!program.active && progress.passedDays === progress.totalDays && <p className="program-week-note">All weeks are complete. Activate this program to start a fresh run.</p>}
      {program.active && <p className="program-week-note">Finish or skip each workout. Tick rest days to pass them. Passed days stay locked until you reset this week.</p>}
      {hasActiveWorkout && program.active && <p className="program-week-note">Finish or discard the active workout before starting, skipping, or resetting a day.</p>}
      {canReset && <Button className="program-week-reset" variant="destructive" disabled={Boolean(busyDay) || hasActiveWorkout} onClick={() => { setError(''); setResetPhrase(''); setResetOpen(true); }}>
        <RotateCcw size={15} />Reset this week
      </Button>}
    </> : <p className="program-week-note">Activate this program to begin its first week.</p>}

    {error && <p className="error-text program-week-error" role="alert">{error}</p>}
    {resetOpen && <Modal title="Reset this week?" onClose={() => { setResetOpen(false); setResetPhrase(''); }}>
      <form className="modal-body program-week-reset-form" noValidate onSubmit={event => void resetWeek(event)}>
        <p>This clears the checkmarks for Week {progress?.currentWeek}. Completed workout history stays saved.</p>
        <label className="field" htmlFor={`reset-program-week-${program.id}`}>
          Type <strong>RESET</strong> to confirm
          <input id={`reset-program-week-${program.id}`} autoComplete="off" value={resetPhrase} onChange={event => setResetPhrase(event.target.value)} aria-describedby={`reset-program-week-hint-${program.id}`} />
        </label>
        <small id={`reset-program-week-hint-${program.id}`}>This cannot be undone. The current week will start again at day one.</small>
        {hasActiveWorkout && <p className="error-text" role="alert">Finish or discard the active workout first.</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions">
          <Button type="button" disabled={busyDay === 'reset'} onClick={() => { setResetOpen(false); setResetPhrase(''); }}>Cancel</Button>
          <Button type="submit" variant="destructive" disabled={resetPhrase !== 'RESET' || busyDay === 'reset' || hasActiveWorkout}>
            <RotateCcw size={15} />{busyDay === 'reset' ? 'Resetting…' : 'Reset week'}
          </Button>
        </div>
      </form>
    </Modal>}
  </section>;
}
